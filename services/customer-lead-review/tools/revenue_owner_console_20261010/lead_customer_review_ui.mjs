/** Recipient review controls for the original public customer package. */
export function mountPortableLeadCustomerReview({container,model,readDocument,utf8ByteLength,initialStates={},saveEditablePage}){
 const MAX_DRAFT_BYTES=64*1024*1024,VERSION='commons.lead-customer-review-draft.v1',copy=value=>JSON.parse(JSON.stringify(value));
 const decisions=[['','Not reviewed'],['keep','Keep'],['question','Question'],['duplicate','Duplicate'],['unavailable','Unavailable'],['outside_brief','Outside the brief'],['incorrect_contact','Incorrect contact'],['incorrect_source','Incorrect source'],['other','Other']];
 const states=Object.assign(Object.create(null),initialStates),downloads=new Set(),storageSeen=new Map();let source=null,state=null,pack=null,notice='',problem='',storageNotice='',selectedKey='',filter='',page=0,disposed=false;
 const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const draftDocument=(original,value)=>({version:VERSION,source:copy(original),review:copy(value.review),form:copy(value.form),parked:copy(value.parked||[])});
 function checkedText(value){const text=JSON.stringify(value,null,2)+'\n';if(utf8ByteLength(text)>MAX_DRAFT_BYTES)throw new Error('This complete working copy exceeds 64 MiB. Your current text remains open; retain smaller complete working copies before adding more history.');return text;}
 const emptyForm=()=>({author:'',note:'',rows:{}});
 const formFrom=review=>({author:review.draft.author,note:review.draft.note,rows:Object.fromEntries(review.draft.items.map(row=>[row.key,{decision:row.decision,statement:row.statement,requested_remedy:row.requested_remedy}]))});
 const fresh=original=>({version:VERSION,source_sha256:original.sha256,review:model.newReview(original,{id:'review-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2),created_at:new Date().toISOString()}),form:emptyForm(),parked:[]});
 function checkForm(value,original){
  if(!value||typeof value!=='object'||Array.isArray(value)||typeof value.author!=='string'||value.author.length>500||typeof value.note!=='string'||value.note.length>12000||!value.rows||typeof value.rows!=='object'||Array.isArray(value.rows))throw new Error('Open a complete recipient draft.');
  if(Object.keys(value).sort().join(',')!=='author,note,rows')throw new Error('The saved draft contains unknown fields.');
  for(const [key,row]of Object.entries(value.rows)){
   const match=/^lead-([1-9][0-9]*)$/.exec(key);
   if(!match||Number(match[1])>original.document.leads.length||!row||typeof row!=='object'||Object.keys(row).sort().join(',')!=='decision,requested_remedy,statement'||!decisions.some(([id])=>id===row.decision)||typeof row.statement!=='string'||row.statement.length>8000||typeof row.requested_remedy!=='string'||row.requested_remedy.length>4000)throw new Error('The saved draft has an invalid original lead selection.');
  }
  return copy(value);
 }
 function checkState(value,original){
  if(!value||value.version!==VERSION||value.source_sha256!==original.sha256)throw new Error('Open this review with its exact original customer selection.');
  const result={version:VERSION,source_sha256:original.sha256,review:model.validateReview(original,value.review),form:checkForm(value.form,original),parked:[]};
  if(value.parked!==undefined&&!Array.isArray(value.parked))throw new Error('Keep complete retained review drafts.');
  for(const row of value.parked||[]){if(!row||typeof row.retained_at!=='string')throw new Error('Keep the retained draft date.');result.parked.push({retained_at:row.retained_at,review:model.validateReview(original,row.review),form:checkForm(row.form,original)});}
  checkedText(draftDocument(original,result));return result;
 }
 const fingerprint=value=>JSON.stringify({review:value.review,form:value.form});
 function park(value){
  const snapshot={retained_at:new Date().toISOString(),review:copy(value.review),form:copy(value.form)};
  if(!state.parked.some(row=>fingerprint(row)===fingerprint(snapshot)))state.parked.push(snapshot);
 }
 function persist(){
  if(!state||!source)return;states[source.sha256]=state;
  try{const key='commons-customer-review:'+source.sha256,raw=localStorage.getItem(key);if(raw&&raw!==storageSeen.get(source.sha256)){const other=checkState(JSON.parse(raw),source);for(const retained of other.parked)if(fingerprint(retained)!==fingerprint(state))park(retained);if(fingerprint(other)!==fingerprint(state))park(other);}const rawNext=JSON.stringify(state);localStorage.setItem(key,rawNext);storageSeen.set(source.sha256,rawNext);storageNotice='';}
  catch{storageNotice='Browser storage is unavailable or full. Save the editable package or draft JSON to retain all your work.';}
  const status=container.querySelector('[data-storage]');if(status){status.hidden=!storageNotice;status.textContent=storageNotice;}
 }
 function draft(){
  const items=[];
  for(const [key,row]of Object.entries(state.form.rows)){
   if(!row.decision){if(row.statement.trim()||row.requested_remedy.trim())throw new Error('Choose a decision for '+source.document.leads[Number(key.slice(5))-1].organization+', or clear its unfinished text.');continue;}
   items.push({key,...row});
  }
  return {author:state.form.author,note:state.form.note,items};
 }
 function savedState(){return model.setDraft(source,state.review,draft());}
 function statusText(){
  if(!state)return '';
  const last=state.review.history.at(-1);
  if(!last)return 'Working draft · no saved review edition';
  try{const r=savedState();model.prepareReturn(source,r);return 'Saved review '+last.revision+' · ready to download';}catch{return 'Working draft · changes since saved review '+last.revision;}
 }
 function setStatus(){const node=container.querySelector('[data-review-state]');if(node)node.textContent=statusText();}
 function safeLink(url,label){
  try{const parsed=new URL(url);if(!['https:','http:','mailto:','tel:'].includes(parsed.protocol))return escape(label||url);return '<a href="'+escape(parsed.href)+'" target="_blank" rel="noopener noreferrer">'+escape(label||url)+'</a>';}catch{return escape(label||url);}
 }
 function download(name,content,type='application/json'){
  const url=URL.createObjectURL(new Blob([content],{type}));downloads.add(url);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();
  setTimeout(()=>{URL.revokeObjectURL(url);downloads.delete(url);},60000);
 }
 function exportDraft(){return draftDocument(source,state);}
 function summaryRow(row){const label=decisions.find(([key])=>key===row.decision)?.[1]||row.decision,lead=source.document.leads[Number(row.key.slice(5))-1];return '<li><strong>'+escape(lead.organization)+' — '+escape(label)+'</strong><p>'+escape(row.statement)+'</p>'+(row.requested_remedy?'<p>Requested next step: '+escape(row.requested_remedy)+'</p>':'')+'</li>';}
 function printReview(){
  const reviewed=Object.entries(state.form.rows).filter(([,row])=>row.decision||row.statement||row.requested_remedy);
  return '<h2>'+escape(source.document.customer)+' — prospect review</h2><p>'+escape(state.form.author)+'</p><p>'+escape(state.form.note)+'</p><p>'+escape(statusText())+'</p>'+reviewed.map(([key,row])=>{const lead=source.document.leads[Number(key.slice(5))-1];return '<section><h3>'+escape(lead.organization)+'</h3><p>'+escape(lead.business_need)+'</p><p>Original source: '+safeLink(lead.source_url)+'</p><p>Contact: '+safeLink(lead.contact_route)+'</p><h4>'+escape(decisions.find(([id])=>id===row.decision)?.[1]||'Unfinished response')+'</h4><p>'+escape(row.statement)+'</p><p>'+escape(row.requested_remedy)+'</p></section>';}).join('')+'<p>Original edition '+escape(source.edition_id)+' · package '+escape(source.package_id)+'</p>';
 }
 function preparePrint(){if(!state)return;const node=container.querySelector('[data-print]');if(node)node.innerHTML=printReview();}
 function finishPrint(){delete document.body.dataset.leadReviewPrinting;}
 function render(){
  if(disposed)return;
  if(!source||!state){container.innerHTML='<section class="customer-review"><h2>Review this selection</h2><p>'+escape(problem||'Choose a saved package to review its original prospects.')+'</p></section>';return;}
  const matches=source.document.leads.map((lead,index)=>({lead,key:'lead-'+(index+1)})).filter(({lead})=>!filter||(lead.organization+' '+lead.person+' '+lead.business_need).toLowerCase().includes(filter.toLowerCase()));
  const pageSize=20;page=Math.min(page,Math.max(0,Math.ceil(matches.length/pageSize)-1));const visible=matches.slice(page*pageSize,(page+1)*pageSize);
  if(!visible.some(row=>row.key===selectedKey))selectedKey=visible[0]?.key||'';
  const current=selectedKey?source.document.leads[Number(selectedKey.slice(5))-1]:null,row=state.form.rows[selectedKey]||{decision:'',statement:'',requested_remedy:''};
  container.innerHTML='<section class="customer-review" aria-labelledby="customer-review-title"><header><h2 id="customer-review-title">Review this selection</h2><p>Keep the original prospect details alongside your observations. Saving a review records your feedback; returning it lets the sender review the requested next steps.</p><p data-review-state role="status">'+escape(statusText())+'</p></header>'+
  '<div class="review-message" role="status" aria-live="polite">'+escape(notice)+'</div><p class="review-error" role="alert" '+(problem?'':'hidden')+'>'+escape(problem)+'</p><p class="review-storage" data-storage '+(storageNotice?'':'hidden')+'>'+escape(storageNotice)+'</p>'+
  '<div class="review-person"><label>Reviewer name<input data-field="author" maxlength="500" value="'+escape(state.form.author)+'" autocomplete="name"></label><label>Overall note<textarea data-field="note" maxlength="12000" rows="3">'+escape(state.form.note)+'</textarea></label></div>'+
  '<div class="review-actions"><button type="button" data-action="save">Save review edition</button><button type="button" data-action="return">Download return JSON</button><button type="button" data-action="draft">Download draft JSON</button><button type="button" data-action="html">Save editable package</button><button type="button" data-action="import">Open saved review</button><button type="button" data-action="print">Print review</button><input type="file" data-import accept=".json,application/json" hidden></div>'+
  '<div class="review-layout"><nav aria-label="Prospects in this review"><label>Find a prospect<input type="search" data-search value="'+escape(filter)+'"></label><p>'+matches.length+' '+(matches.length===1?'prospect':'prospects')+'</p><ol start="'+(page*pageSize+1)+'">'+visible.map(({lead,key})=>'<li><button type="button" data-select="'+key+'" '+(key===selectedKey?'aria-current="true"':'')+'>'+escape(lead.organization)+'<small>'+escape(decisions.find(([id])=>id===(state.form.rows[key]?.decision||''))?.[1]||'Not reviewed')+'</small></button></li>').join('')+'</ol><div class="review-pages"><button type="button" data-page="-1" '+(page===0?'disabled':'')+'>Previous</button><span>Page '+(page+1)+' of '+Math.max(1,Math.ceil(matches.length/pageSize))+'</span><button type="button" data-page="1" '+((page+1)*pageSize>=matches.length?'disabled':'')+'>Next</button></div></nav>'+
  '<div class="review-prospect">'+(current?'<h3 tabindex="-1" data-prospect-heading>'+escape(current.organization)+'</h3><p>'+escape(current.person)+'</p><dl><dt>Website</dt><dd>'+safeLink(current.company_url)+'</dd><dt>Published workflow or need</dt><dd>'+escape(current.business_need)+'</dd><dt>Why it fits</dt><dd>'+escape(current.why_it_fits)+'</dd><dt>Source</dt><dd>'+safeLink(current.source_url)+'</dd><dt>Source checked</dt><dd>'+escape(current.source_checked_at)+'</dd><dt>Source context</dt><dd>'+escape(current.status_note)+'</dd><dt>Contact route</dt><dd>'+safeLink(current.contact_route)+'</dd><dt>Contact instructions</dt><dd>'+escape(current.contact_instructions)+'</dd></dl>'+
  '<label>Decision<select data-row="decision">'+decisions.map(([key,label])=>'<option value="'+key+'" '+(key===row.decision?'selected':'')+'>'+label+'</option>').join('')+'</select></label><label>Your observation<textarea data-row="statement" maxlength="7900" rows="5" aria-describedby="review-observation-help">'+escape(row.statement)+'</textarea></label><p id="review-observation-help">State what you found. A saved decision needs an observation; unchanged, unreviewed prospects are left out of the return.</p><label>Requested next step (optional)<textarea data-row="requested_remedy" maxlength="4000" rows="3">'+escape(row.requested_remedy)+'</textarea></label><button type="button" data-action="clear">Clear this prospect’s draft response</button>':'<p>No prospects match this search. Clear or change the search to continue.</p>')+'</div></div>'+
  '<details><summary>Saved review history ('+state.review.history.length+')</summary>'+state.review.history.slice().reverse().map(item=>'<section><h3>Review '+item.revision+' · '+escape(item.reviewed_at)+'</h3><p>'+escape(item.author||'Reviewer name not provided')+'</p><p>'+escape(item.note)+'</p><ol>'+item.items.map(summaryRow).join('')+'</ol></section>').join('')+'</details>'+
  '<details><summary>Retained working copies ('+state.parked.length+')</summary>'+state.parked.map((item,index)=>'<p>Retained '+escape(item.retained_at)+' · '+item.review.history.length+' saved editions <button type="button" data-resume="'+index+'">Resume this working copy</button></p>').join('')+'</details>'+
  '<div class="review-print" data-print></div><details><summary>Original selection identity</summary><dl><dt>Customer</dt><dd>'+escape(source.document.customer)+'</dd><dt>Edition</dt><dd>'+escape(source.edition_id)+'</dd><dt>Package</dt><dd>'+escape(source.package_id)+'</dd><dt>Source SHA-256</dt><dd>'+source.sha256+'</dd></dl></details></section>';
 }
 function selectPackage(value){
  pack=value;source=null;state=null;problem='';notice='';storageNotice='';filter='';page=0;selectedKey='';
  try{
   const document=readDocument(value);if(!document)throw new Error('This package has no structured lead selection. Its original documents and ZIP remain available above.');
   source=model.source({edition_id:value.edition_id,package_id:value.id,package_sha256:value.package_sha256,document});
   let saved=states[source.sha256]||initialStates[source.sha256],local=null;
   try{const raw=localStorage.getItem('commons-customer-review:'+source.sha256);storageSeen.set(source.sha256,raw);if(raw)local=checkState(JSON.parse(raw),source);}catch{storageNotice='Saved browser data could not be opened. Your original package remains available; use a saved editable package or review file to restore your work.';}
   if(saved)state=checkState(saved,source);else if(local)state=local;else state=fresh(source);
   if(saved&&local&&fingerprint(local)!==fingerprint(state)){for(const retained of local.parked)park(retained);park(local);notice='This page’s saved review is open. A different browser working copy is retained below.';}
   states[source.sha256]=state;
  }catch(e){source=null;state=null;problem=e.message||String(e);}
  render();
 }
 function stateSnapshot(){if(state){persist();checkState(state,source);}checkedText(states);return copy(states);}
 async function openFile(file){
  if(!file)return;if(file.size>MAX_DRAFT_BYTES)throw new Error('Open a complete draft JSON file of at most 64 MiB. Saved return JSON keeps the original 1 MiB intake limit.');
  const original=source,selected=state,raw=await file.text();
  if(disposed||source!==original||state!==selected)throw new Error('Return to the original package before opening this review.');
  let value;try{value=JSON.parse(raw.replace(/^\uFEFF/,''));}catch{throw new Error('Choose the complete saved review JSON.');}
  let incoming;
  if(value.version===model.RETURN){const returned=model.readReturn(raw);if(returned.source.sha256!==source.sha256)throw new Error('Choose the package that matches this returned review.');incoming={version:VERSION,source_sha256:source.sha256,review:returned.review,form:formFrom(returned.review),parked:[]};}
  else{if(value.version!==VERSION||!['form,review,source,version','form,parked,review,source,version'].includes(Object.keys(value).sort().join(',')))throw new Error('Choose a saved draft JSON or return JSON from this package.');const selectedSource=model.validateSource(value.source);if(selectedSource.sha256!==source.sha256)throw new Error('Choose the package that matches this saved draft.');incoming=checkState({version:VERSION,source_sha256:source.sha256,review:value.review,form:value.form,parked:value.parked||[]},source);}
  if(fingerprint(incoming)!==fingerprint(state)){const previous=state;state=incoming;for(const retained of previous.parked)park(retained);park(previous);states[source.sha256]=state;}else for(const retained of incoming.parked)park(retained);
  notice='Opened the complete saved review. Earlier working copies remain available below.';problem='';persist();render();
 }
 function input(event){
  if(!state)return;const el=event.target;
  if(el.matches('[data-field]'))state.form[el.dataset.field]=el.value;
  else if(el.matches('[data-row]')){const value=state.form.rows[selectedKey]||(state.form.rows[selectedKey]={decision:'',statement:'',requested_remedy:''});value[el.dataset.row]=el.value;if(el.dataset.row==='decision'){const label=container.querySelector('[data-select="'+selectedKey+'"] small');if(label)label.textContent=decisions.find(([id])=>id===el.value)?.[1]||'Not reviewed';}}
  else if(el.matches('[data-search]')){const start=el.selectionStart,end=el.selectionEnd;filter=el.value;page=0;render();const next=container.querySelector('[data-search]');next.focus();next.setSelectionRange(start,end);return;}
  else return;
  persist();setStatus();
 }
 async function click(event){
  const button=event.target.closest('button');if(!button||!container.contains(button)||!state)return;
  problem='';
  try{
   if(button.dataset.select){selectedKey=button.dataset.select;render();container.querySelector('[data-prospect-heading]')?.focus();return;}
   if(button.dataset.page){page+=Number(button.dataset.page);render();return;}
   if(button.dataset.resume!==undefined){const selected=state.parked[Number(button.dataset.resume)];if(!selected)throw new Error('Choose a retained working copy.');const next=copy(selected);park(state);state.review=next.review;state.form=next.form;notice='Resumed the retained working copy; the previous one is also retained.';persist();render();return;}
   switch(button.dataset.action){
    case 'save':{const value=draft();state.review=model.updateReview(source,state.review,{...value,at:new Date().toISOString()});notice='Saved review edition '+state.review.history.at(-1).revision+'.';persist();break;}
    case 'return':{const returned=model.prepareReturn(source,savedState()),content=JSON.stringify(returned);model.readReturn(content);download('lead-review-'+state.review.id+'-return.json',content);notice='Downloaded the complete saved return. Send this JSON to the original sender.';break;}
    case 'draft':download('lead-review-'+state.review.id+'-draft.json',checkedText(exportDraft()));notice='Downloaded the complete unfinished draft and saved history.';break;
    case 'html':persist();saveEditablePage(stateSnapshot());notice='Downloaded the complete editable package with every retained review and unfinished field.';break;
    case 'import':container.querySelector('[data-import]').click();return;
    case 'print':preparePrint();document.body.dataset.leadReviewPrinting='true';try{window.print();}catch(e){finishPrint();throw e;}return;
    case 'clear':delete state.form.rows[selectedKey];notice='Cleared this prospect’s current draft response. Saved review history stays intact.';persist();break;
    default:return;
   }
  }catch(e){problem=e.message||String(e);}
  render();
 }
 function change(event){if(event.target.matches('[data-import]'))openFile(event.target.files?.[0]).catch(e=>{problem=e.message||String(e);render();});}
 container.addEventListener('input',input);container.addEventListener('click',click);container.addEventListener('change',change);window.addEventListener('beforeprint',preparePrint);window.addEventListener('afterprint',finishPrint);
 render();
 return {selectPackage,stateSnapshot,dispose(){disposed=true;window.removeEventListener('beforeprint',preparePrint);window.removeEventListener('afterprint',finishPrint);finishPrint();container.removeEventListener('input',input);container.removeEventListener('click',click);container.removeEventListener('change',change);for(const url of downloads)URL.revokeObjectURL(url);}};
}
export const CUSTOMER_REVIEW_STYLE='.customer-review{color-scheme:light;color:#202020;background:#fff;border:1px solid #aaa;padding:22px;margin:22px 0;font:16px/1.5 system-ui,sans-serif;text-align:left}.customer-review,.customer-review *{box-sizing:border-box;min-width:0}.customer-review h2,.customer-review h3,.customer-review p,.customer-review label,.customer-review dt,.customer-review dd,.customer-review summary,.customer-review li{color:#202020}.customer-review h2{font-size:23px}.customer-review h3{font-size:19px}.customer-review p,.customer-review dd{white-space:pre-wrap;overflow-wrap:anywhere}.customer-review a{color:#222;text-decoration:underline;overflow-wrap:anywhere}.customer-review label{display:block;font-weight:600;margin:12px 0}.customer-review input,.customer-review textarea,.customer-review select,.customer-review button{color:#202020;background:#fff;font:inherit;border:1px solid #777;border-radius:2px;padding:9px 10px;max-width:100%}.customer-review input,.customer-review textarea,.customer-review select{display:block;width:100%;margin-top:5px}.customer-review textarea{resize:vertical}.customer-review button{cursor:pointer}.customer-review button:disabled{color:#666;background:#eee;cursor:default}.customer-review :is(input,textarea,select,button,a,summary):focus-visible{outline:3px solid #333;outline-offset:3px}.customer-review select option{color:#202020;background:#fff}.customer-review .review-actions,.customer-review .review-pages{display:flex;flex-wrap:wrap;align-items:center;gap:9px}.customer-review .review-person{display:grid;grid-template-columns:minmax(180px,1fr) minmax(260px,2fr);gap:16px}.customer-review .review-layout{display:grid;grid-template-columns:minmax(200px,1fr) minmax(300px,2fr);gap:24px;margin-top:25px}.customer-review nav{border-right:1px solid #bbb;padding-right:18px}.customer-review nav ol{padding-left:24px}.customer-review nav li{margin:8px 0}.customer-review nav button{width:100%;text-align:left}.customer-review nav button[aria-current]{border:2px solid #333;font-weight:600}.customer-review small{display:block;font-size:13px;font-weight:400}.customer-review dl{display:grid;grid-template-columns:minmax(105px,1fr) minmax(0,3fr);gap:8px 16px}.customer-review dt{font-weight:600}.customer-review dd{margin:0}.customer-review details{border-top:1px solid #bbb;padding:16px 0}.customer-review details section{padding:10px 0;border-bottom:1px solid #ddd}.customer-review .review-error,.customer-review .review-storage{background:#f5f5f5;color:#202020;border:2px solid #555;padding:12px}.customer-review [hidden]{display:none!important}.customer-review .review-print{display:none}@media(max-width:700px){.customer-review{padding:16px 12px}.customer-review .review-person,.customer-review .review-layout{display:block}.customer-review nav{border-right:0;border-bottom:1px solid #bbb;padding:0 0 18px;margin-bottom:18px}.customer-review dl{display:block}.customer-review dt{margin-top:10px}.customer-review .review-actions button{flex:1 1 155px}}@media print{body[data-lead-review-printing] .lead-package-viewer>:not(#customer-review){display:none!important}body[data-lead-review-printing] .customer-review>*:not(.review-print){display:none!important}body[data-lead-review-printing] .customer-review .review-print{display:block}body[data-lead-review-printing] .customer-review .review-print section{break-inside:auto;border-top:1px solid #bbb;padding:12px 0}body[data-lead-review-printing] .customer-review .review-print h3{break-after:avoid}.customer-review{border:0;padding:0}.customer-review .review-actions,.customer-review nav,.customer-review input[type=file]{display:none}.customer-review .review-layout,.customer-review .review-person{display:block}.customer-review textarea{overflow:visible;max-height:none}.customer-review details{break-inside:avoid}}';
