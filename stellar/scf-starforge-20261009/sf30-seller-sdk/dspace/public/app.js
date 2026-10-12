// MIT. Browser operator for original DSpace captures and saved dataset editions.
'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,sourcePage={offset:0,limit:20,total:0,items:[]},edition,comparisonPage=0,queryCursor=null,queryInput=null;
let selection=new Map(),selectedFields=new Set(),pending=null,saving=false;
const scopeFields=['operatorId','instanceId','projectKey','workspaceId'];
function scopeOf(value=state){
 if(!value)return null;
 const result={operatorId:value.operator?.id,instanceId:value.operator?.instanceId,projectKey:value.operator?.selected,workspaceId:value.id};
 if(scopeFields.some(key=>typeof result[key]!=='string'||!result[key]))throw new Error('The operator did not return its complete original workspace identity.');
 return result;
}
const sameTarget=(left,right)=>!!left&&!!right&&['operatorId','projectKey','workspaceId'].every(key=>left[key]===right[key]);
const sameScope=(left,right)=>sameTarget(left,right)&&left.instanceId===right.instanceId;
const draftKey=()=> 'dspace.draft.'+[state?.operator.id,state?.id,state?.operator.selected].join('.');
function scopedOptions(options={}){
 const {scope=scopeOf(),...init}=options,headers=new Headers(init.headers);
 if(scope){
  for(const [name,key] of [['operator','operatorId'],['instance','instanceId'],['project','projectKey'],['workspace','workspaceId']]){
   if(typeof scope[key]!=='string'||!scope[key])throw new Error('Recover the original saved workspace identity before continuing.');
   headers.set('x-dspace-'+name,scope[key]);
  }
 }
 return {...init,headers};
}
function requirePendingScope(){
 if(!pending?.scope)throw new Error('Review the older saved request with Reconnect original workspace before retrying it.');
 const current=scopeOf();
 if(!sameTarget(pending.scope,current))throw new Error('This request belongs to its saved operator, project and workspace. Use Reconnect original workspace before retrying.');
 if(!sameScope(pending.scope,current))throw new Error('The original operator restarted. Use Reconnect original workspace to review its new process before retrying the same request.');
 return {...pending.scope};
}
const pendingFacts=document.createElement('p');pendingFacts.id='pending-scope';$('pending').append(pendingFacts);
const reconnectButton=document.createElement('button');reconnectButton.id='reconnect-request';reconnectButton.type='button';reconnectButton.textContent='Reconnect original workspace';$('pending').append(reconnectButton);
function renderPending(){
 $('pending').hidden=!pending;
 pendingFacts.textContent=!pending?'':pending.scope
  ?'Saved operator '+pending.scope.operatorId+' · project '+pending.scope.projectKey+' · workspace '+pending.scope.workspaceId+' · process '+pending.scope.instanceId
  :'This older request retained project '+(pending.project??'unknown')+' without the operator and workspace identities. Review its destination before reconnecting.';
}
const say=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
const facts=rows=>rows.map(([label,value,small])=>'<div><span>'+esc(label)+'</span><'+(small?'code':'strong')+'>'+esc(value)+'</'+(small?'code':'strong')+'></div>').join('');
function show(page){document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!=='page-'+page);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));}
async function request(url,options={}){
 const response=await fetch(url,scopedOptions(options));
 const type=response.headers.get('content-type')??'';
 const value=type.includes('json')?await response.json():await response.text();
 if(!response.ok)throw Object.assign(new Error(value.message??'The operation could not complete.'),{status:response.status,details:value});
 return value;
}
const post=(url,value,scope)=>request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value),...(scope===undefined?{}:{scope})});
const idb=new Promise((resolve,reject)=>{
 const opening=indexedDB.open('starforge-dspace',1);opening.onupgradeneeded=()=>opening.result.createObjectStore('requests');
 opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);
});
const pendingId=value=>value?.kind==='receive'?value.operationId:value?.value?.operationId;
async function savedRequest(value,expectedId){
 const db=await idb;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('requests',value===undefined?'readonly':'readwrite'),store=tx.objectStore('requests');
  const reading=store.get('pending');let result=null,conflict=null;
  reading.onsuccess=()=>{
   const prior=reading.result??null;
   if(value===undefined){result=prior;return;}
   // One original saved browser request spans all tabs on this origin. A
   // second tab must recover it before replacing it, and can only clear the
   // exact request it read. The native operation ID remains unchanged.
   const incoming=value===null?expectedId:pendingId(value);
   if((value!==null&&!incoming)||(prior&&pendingId(prior)!==incoming)){
    conflict=new Error('Another saved browser request is already awaiting recovery. Its original input has been retained; review that request before starting another change.');
    tx.abort();return;
   }
   if(value===null)store.delete('pending');else store.put(value,'pending');
   result=value;
  };
  tx.oncomplete=()=>resolve(result);
  tx.onabort=()=>reject(conflict??tx.error??new Error('The original saved request could not be retained.'));
  tx.onerror=()=>reject(conflict??tx.error);
 });
}
async function setPending(value){
 try{await savedRequest(value,pendingId(pending));pending=value;}
 catch(error){pending=await savedRequest();renderPending();throw error;}
 renderPending();
}
function saveDraft(){
 if(!state)return;
 localStorage.setItem(draftKey(),JSON.stringify({selection:[...selection],fields:[...selectedFields],name:$('dataset-name').value,mode:$('mode').value,attribution:$('attribution').value,basis:$('basis').value,reference:$('reference').value}));
}
function loadDraft(){
 let d={};try{d=JSON.parse(localStorage.getItem(draftKey())??'{}');}catch{}
 selection=new Map(d.selection??[]);selectedFields=new Set(d.fields??[]);
 for(const [id,key] of [['dataset-name','name'],['mode','mode'],['attribution','attribution'],['basis','basis'],['reference','reference']])$(id).value=d[key]??(key==='mode'?'items':'');
 renderSelection();
}
function fill(id,rows,valueKey,label,empty){
 const element=$(id),previous=element.value;
 element.innerHTML=(empty?'<option value="">'+esc(empty)+'</option>':'')+rows.map(row=>'<option value="'+esc(row[valueKey])+'">'+esc(label(row))+'</option>').join('');
 if([...element.options].some(o=>o.value===previous))element.value=previous;
}
async function refresh(){
 state=await request('/api/state',{scope:null});
 scopeOf();renderPending();
 $('revision').textContent='Revision '+state.revision+' · '+state.operation_count+' saved requests';
 $('workspace-summary').innerHTML='<strong>'+esc(state.id)+'</strong><p>'+state.sources.length+' sources<br>'+state.editions.length+' editions<br>'+state.reviews.length+' reviews</p>';
 fill('project',state.operator.projects,'key',p=>p.name);$('project').value=state.operator.selected;
 fill('source',state.sources,'id',s=>s.name+' · '+s.item_count+' records','Choose a source');
 const label=e=>e.name+' · '+e.row_count+' rows';
 for(const id of ['edition','previous-edition','compare-before','compare-after'])fill(id,state.editions,'id',label,id==='previous-edition'?'First edition':null);
 if(!$('edition').value&&state.selected_edition_id)$('edition').value=state.selected_edition_id;
 fill('comparison',state.comparisons,'id',c=>c.counts.changed+' changed · '+c.id);
 $('publications').innerHTML=state.publications.length?state.publications.map(p=>'<details><summary>'+esc(p.edition_id)+' · '+esc(p.created_at)+'</summary><pre>'+esc(JSON.stringify(p.publication,null,2))+'</pre></details>').join(''):'<p>The merchant command records published dataset snapshots here.</p>';
 const selected=state.editions.find(e=>e.id===state.selected_edition_id);
 $('delivery-edition').innerHTML=selected?'<div class="facts">'+facts([['Dataset',selected.name],['Rows',selected.row_count],['Snapshot',selected.snapshot,true]])+'</div>':'<p>Select a reviewed edition to prepare its native merchant package.</p>';
 if($('source').value)await renderSource();
 if($('edition').value)await renderEdition();
 if($('comparison').value)await renderComparison();
 renderSelection();
}
async function action(name,input){
 if(pending||saving)throw new Error('Recover the saved request before starting another change.');
 saving=true;
 try{
 const value={action:name,operationId:crypto.randomUUID(),actor:$('actor').value.trim(),expectedRevision:state.revision,...input};
 await setPending({version:2,kind:'action',project:state.operator.selected,scope:scopeOf(),value});
 return await resume();
 }finally{saving=false;}
}
async function resume(){
 if(!pending)return;
 const scope=requirePendingScope();
 let result;
 if(pending.kind==='receive'){
  result=await request('/api/receive',{method:'POST',headers:{'content-type':'application/vnd.sqlite3','x-operation-id':pending.operationId},body:pending.file,scope});
 }else result=await post('/api/action',pending.value,scope);
 // Scope or revision errors retain the exact request for readback and review.
 // Receiving deliberately selects the returned original project.
 if(result.state)state=result.state;
 await setPending(null);await refresh();
 say(result.replayed?'Recovered the original saved result.':'Saved successfully at revision '+state.revision+'.');
 return result;
}
async function reconnectPending(){
 if(!pending)return;
 let current=await request('/api/state',{scope:null}),scope=scopeOf(current);
 const original=pending.scope;
 if(original){
  if(scope.operatorId!==original.operatorId)throw new Error('Open the saved operator '+original.operatorId+' to recover this request. The current operator is different.');
  if(scope.projectKey!==original.projectKey){
   current=await post('/api/select-project',{key:original.projectKey},scope);scope=scopeOf(current);
  }
  if(!sameTarget(original,scope)){
   state=current;await refresh();
   throw new Error('The saved project now points to a different workspace. The original request is retained and has not been sent there.');
  }
 }else{
  // Older browser records have no owner binding. Never infer it from a reused
  // port or the common "original" project key; require an explicit review.
  if(pending.project!==scope.projectKey)throw new Error('Select the older request’s recorded project '+pending.project+' before reviewing its workspace binding.');
  const accepted=window.confirm('This older saved request has no retained operator or workspace identity. Bind its unchanged request to operator '+scope.operatorId+', project '+scope.projectKey+', workspace '+scope.workspaceId+'? Choose OK only after checking this is its intended original workspace.');
  if(!accepted)return;
 }
 const updated={...pending,version:2,scope,project:scope.projectKey,
  previousScope:original??null,reconnectedAt:new Date().toISOString(),
  ...(original?{}:{legacyBindingReviewed:true})};
 await setPending(updated);state=current;await refresh();loadDraft();
 say('Reconnected the saved request to its reviewed workspace. Retry saved request now uses this operator process and the original request ID.');
}
async function download(kind,id){
 const response=await fetch('/api/download?'+new URLSearchParams({kind,...(id?{id}:{})}),scopedOptions());
 if(!response.ok){const value=await response.json();throw new Error(value.message);}
 const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??'repository-download';
 document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
 say('Downloaded '+a.download+' · '+blob.size.toLocaleString()+' bytes.');
}
async function renderSource(){
 const id=$('source').value;if(!id){$('items').replaceChildren();return;}
 const source=state.sources.find(s=>s.id===id);
 $('source-facts').innerHTML=facts([['Repository',source.base_url,true],['Captured records',source.item_count],['Collection',source.scope.observed_items+' records · '+(source.scope.complete?'complete':'partial')],['Original requests',source.request_count],['Source SHA256',source.sha256,true]]);
 sourcePage=await request('/api/items?'+new URLSearchParams({id,scope:$('scope').value,offset:String(sourcePage.offset),limit:'20',search:$('search').value}));
 $('items').innerHTML=sourcePage.items.map((item,index)=>'<tr><td><input type="checkbox" aria-label="Select '+esc(item.name)+'" data-item="'+index+'" '+(selection.get(item.uuid)?.objectSha256===item.objectSha256?'checked':'')+'></td><td>'+esc(item.name)+'<small>'+esc(item.uuid)+'</small></td><td>'+esc(item.entity_type??'Unspecified')+'</td><td>'+item.metadata_count+'</td><td><code>'+esc(item.objectSha256.slice(0,10))+'</code></td><td><button data-inspect="'+index+'">Details</button></td></tr>').join('');
 $('source-page').textContent=(sourcePage.total?sourcePage.offset+1:0)+'–'+Math.min(sourcePage.total,sourcePage.offset+sourcePage.items.length)+' of '+sourcePage.total;
 $('previous-source').disabled=sourcePage.offset===0;$('next-source').disabled=sourcePage.offset+20>=sourcePage.total;
 $('selection-count').textContent=selection.size+' selected records';
}
function selectItem(item,checked){
 if(checked)selection.set(item.uuid,{sourceId:$('source').value,uuid:item.uuid,objectSha256:item.objectSha256,name:item.name,fields:item.fields});
 else selection.delete(item.uuid);
 renderSelection();saveDraft();
}
function renderSelection(){
 const fields=[...new Set([...selection.values()].flatMap(i=>i.fields))].sort();
 selectedFields=new Set([...selectedFields].filter(f=>fields.includes(f)));
 $('selection-count').textContent=selection.size+' selected records';
 $('draft-selection').innerHTML='<div class="facts">'+facts([['Selected records',selection.size],['Sources',new Set([...selection.values()].map(i=>i.sourceId)).size],['Available fields',fields.length]])+'</div><details><summary>Selected record versions</summary>'+[...selection.values()].map(i=>'<div class="record-card"><strong>'+esc(i.name)+'</strong><small><code>'+esc(i.uuid)+' · '+esc(i.objectSha256)+'</code></small></div>').join('')+'</details>';
 $('fields').innerHTML=fields.map(f=>'<label><input type="checkbox" data-field="'+esc(f)+'" '+(selectedFields.has(f)?'checked':'')+'>'+esc(f)+'</label>').join('');
}
async function renderEdition(){
 const id=$('edition').value;if(!id)return;
 edition=await request('/api/record?'+new URLSearchParams({kind:'editions',id,limit:'20'}));
 $('edition-facts').innerHTML=facts([['Dataset',edition.name],['Record selection',edition.item_count],['Customer rows',edition.row_count],['Form',edition.mode],['Edition SHA256',edition.sha256,true],['Native snapshot',edition.snapshot,true]]);
 $('edition-lineage').textContent=JSON.stringify({rights:edition.rights,metadataFields:edition.metadataFields,selection:edition.selection,source_ids:edition.source_ids},null,2);
 const reviews=state.reviews.filter(r=>r.edition_id===id);
 $('reviews').innerHTML=reviews.map(r=>'<div class="record-card"><strong>'+esc(r.decision==='approved'?'Approved':'Changes requested')+'</strong> · '+esc(r.actor)+' · '+esc(r.created_at)+'<p>'+esc(r.comment)+'</p></div>').join('')||'<p>This edition has no saved review.</p>';
 const latest=reviews.at(-1);$('select-edition').disabled=latest?.decision!=='approved';
 queryCursor=null;queryInput=null;$('next-query').disabled=true;$('query-result').innerHTML='';
}
async function query(next=false){
 const query=next?{...queryInput,cursor:queryCursor}:{limit:$('query-limit').value,...($('query-uuid').value?{where_item_uuid:$('query-uuid').value.trim()}:{}),...($('query-sort').value?{sort:$('query-sort').value}:{})};
 const response=await post('/api/query',{editionId:$('edition').value,query});
 queryInput=next?queryInput:query;queryCursor=response.page.nextCursor;$('next-query').disabled=!queryCursor;
 $('query-result').innerHTML='<p>'+response.page.returned+' rows on this page · '+response.page.total+' matching rows</p>'+response.rows.map(row=>'<details><summary>'+esc(row.item_name)+' · '+esc(row.item_uuid)+(row.field?' · '+esc(row.field):'')+'</summary><pre>'+esc(JSON.stringify(row,null,2))+'</pre></details>').join('');
 say('Read the original native dataset page.');
}
async function renderComparison(){
 const id=$('comparison').value;if(!id)return;
 const comparison=await request('/api/record?'+new URLSearchParams({kind:'comparisons',id,offset:String(comparisonPage),limit:'20'}));
 $('comparison-facts').innerHTML=facts(Object.entries(comparison.counts));
 $('comparison-rows').innerHTML=comparison.changes.map(change=>'<details><summary>'+esc(change.kind)+' · '+esc(change.before?.item_name??change.after?.item_name??change.key)+'</summary><div class="two"><pre>'+esc(JSON.stringify(change.before,null,2))+'</pre><pre>'+esc(JSON.stringify(change.after,null,2))+'</pre></div></details>').join('')||'<p>No record content changes on this page.</p>';
 if(comparison.source_changes.length)$('comparison-rows').insertAdjacentHTML('beforeend','<details><summary>Source provenance changes on this page</summary><pre>'+esc(JSON.stringify(comparison.source_changes,null,2))+'</pre></details>');
 const total=Math.max(comparison.total,comparison.source_total);
 $('comparison-page').textContent=(total?comparisonPage+1:0)+'–'+Math.min(total,comparisonPage+20)+' of '+total;
 $('previous-comparison').disabled=comparisonPage===0;$('next-comparison').disabled=comparisonPage+20>=total;
}
function on(id,event,fn){$(id).addEventListener(event,async e=>{
 if(event==='submit')e.preventDefault();
 const button=e.currentTarget.tagName==='BUTTON'?e.currentTarget:null;if(button)button.disabled=true;
 try{await fn(e);}catch(error){say(error.message,true);}finally{if(button&&!['next-query','select-edition','next-source','previous-source','next-comparison','previous-comparison'].includes(id))button.disabled=false;}
});}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>show(b.dataset.page)));
on('refresh','click',refresh);
on('project','change',async()=>{saveDraft();await post('/api/select-project',{key:$('project').value});await refresh();loadDraft();say('Opened the selected saved workspace.');});
on('actor','change',()=>localStorage.setItem('dspace.actor',$('actor').value));
$('actor').value=localStorage.getItem('dspace.actor')??'Repository operator';
for(const id of ['source','scope'])on(id,'change',async()=>{sourcePage.offset=0;await renderSource();});
let searchTimer;$('search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{sourcePage.offset=0;renderSource().catch(e=>say(e.message,true));},250);});
on('previous-source','click',async()=>{sourcePage.offset=Math.max(0,sourcePage.offset-20);await renderSource();});
on('next-source','click',async()=>{sourcePage.offset+=20;await renderSource();});
on('items','change',e=>{if(e.target.dataset.item!==undefined)selectItem(sourcePage.items[Number(e.target.dataset.item)],e.target.checked);});
on('items','click',async e=>{
 const index=e.target.dataset.inspect;if(index===undefined)return;
 const item=sourcePage.items[Number(index)];
 const original=await request('/api/item?'+new URLSearchParams({source:$('source').value,uuid:item.uuid,variant:item.objectSha256}));
 $('item-json').textContent=JSON.stringify(original,null,2);$('item-detail').open=true;
});
on('select-page','click',async()=>{sourcePage.items.forEach(i=>selectItem(i,true));await renderSource();});
on('select-collection','click',async()=>{
 if(!$('source').value)throw new Error('Choose a source first.');
 let offset=0;const variants=new Map();
 for(;;){const page=await request('/api/items?'+new URLSearchParams({id:$('source').value,scope:'collection',offset:String(offset),limit:'100'}));for(const item of page.items)if(!variants.has(item.uuid))variants.set(item.uuid,item);offset+=page.items.length;if(offset>=page.total)break;}
 for(const item of variants.values())selectItem(item,true);
 await renderSource();say('Selected '+variants.size+' collection records with the displayed source versions.');
});
on('source-download','click',()=>download('source',$('source').value));
on('source-file','change',async e=>{
 const file=e.target.files[0];if(!file)return;
 const bytes=new Uint8Array(await file.arrayBuffer());let binary='';
 for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));
 const result=await action('import-source',{sourceBase64:btoa(binary),filename:file.name});
 $('source').value=result.source.id;sourcePage.offset=0;await renderSource();e.target.value='';
});
on('clear-selection','click',()=>{selection.clear();selectedFields.clear();renderSelection();saveDraft();});
on('fields','change',e=>{const field=e.target.dataset.field;if(!field)return;e.target.checked?selectedFields.add(field):selectedFields.delete(field);saveDraft();});
on('all-fields','click',()=>{selectedFields=new Set([...selection.values()].flatMap(i=>i.fields));renderSelection();saveDraft();});
on('no-fields','click',()=>{selectedFields.clear();renderSelection();saveDraft();});
for(const id of ['dataset-name','mode','attribution','basis','reference'])on(id,'change',saveDraft);
on('draft-form','submit',async()=>{
 const result=await action('save-edition',{name:$('dataset-name').value.trim(),mode:$('mode').value,selection:[...selection.values()].map(({sourceId,uuid,objectSha256})=>({sourceId,uuid,objectSha256})),metadataFields:[...selectedFields],rights:{attribution:$('attribution').value,basis:$('basis').value,...($('reference').value?{reference:$('reference').value}:{})},...($('previous-edition').value?{previousEditionId:$('previous-edition').value}:{})});
 $('edition').value=result.edition.id;await renderEdition();show('editions');
});
on('edition','change',renderEdition);
on('edition-records','click',()=>download('editions',$('edition').value));
on('edition-csv','click',()=>download('dataset',$('edition').value));
on('edition-config','click',()=>download('config',$('edition').value));
on('reuse-edition','click',async()=>{
 selection.clear();
 for(const choice of edition.selection){
  const item=await request('/api/item?'+new URLSearchParams({source:choice.sourceId,uuid:choice.uuid,variant:choice.objectSha256}));
  selection.set(item.uuid,{...choice,name:item.name,fields:item.fields});
 }
 selectedFields=new Set(edition.metadataFields);$('dataset-name').value=edition.name;$('mode').value=edition.mode;
 $('attribution').value=edition.rights.attribution;$('basis').value=edition.rights.basis;$('reference').value=edition.rights.reference??'';$('previous-edition').value=edition.id;
 renderSelection();saveDraft();show('draft');
});
on('review-form','submit',async()=>{await action('review-edition',{editionId:edition.id,editionSha256:edition.sha256,decision:$('decision').value,comment:$('review-comment').value});await renderEdition();});
on('select-edition','click',async()=>{const review=state.reviews.filter(r=>r.edition_id===edition.id).at(-1);await action('select-edition',{editionId:edition.id,reviewId:review.id});});
on('query-form','submit',()=>query());
on('next-query','click',()=>query(true));
on('compare-form','submit',async()=>{
 const result=await action('compare-editions',{beforeId:$('compare-before').value,afterId:$('compare-after').value});
 $('comparison').value=result.comparison.id;comparisonPage=0;await renderComparison();
});
on('comparison','change',async()=>{comparisonPage=0;await renderComparison();});
on('comparison-download','click',()=>download('comparison',$('comparison').value));
on('previous-comparison','click',async()=>{comparisonPage=Math.max(0,comparisonPage-20);await renderComparison();});
on('next-comparison','click',async()=>{comparisonPage+=20;await renderComparison();});
on('project-download','click',()=>download('project'));
on('project-file','change',async e=>{
 const file=e.target.files[0];if(!file)return;
 if(pending||saving)throw new Error('Recover the saved request before receiving another project.');
 saving=true;try{
 await setPending({version:2,kind:'receive',project:state.operator.selected,scope:scopeOf(),operationId:crypto.randomUUID(),file});
 await resume();loadDraft();e.target.value='';show('delivery');
 }finally{saving=false;}
});
on('retry','click',resume);
on('reconnect-request','click',reconnectPending);
on('discard','click',async()=>{
 if(!pending)return;
 if(pending.kind==='receive')throw new Error('Retry this complete project to recover its original receiving result.');
 const scope=requirePendingScope();
 try{const saved=await request('/api/operation?id='+encodeURIComponent(pending.value.operationId),{scope});await setPending(null);await refresh();say('Recovered saved request '+saved.result.operationId+'.');}
 catch(error){if(error.status!==404)throw error;await setPending(null);say('Cleared the unsent request.');}
});
(async()=>{await refresh();loadDraft();pending=await savedRequest();renderPending();say('Opened the saved repository workspace.');})().catch(e=>say(e.message,true));
