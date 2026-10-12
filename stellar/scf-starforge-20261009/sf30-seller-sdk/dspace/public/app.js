// MIT. Browser operator for original DSpace captures and saved dataset editions.
'use strict';
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state,sourcePage={offset:0,limit:20,total:0,items:[]},edition,comparisonPage=0,queryCursor=null,queryInput=null;
let selection=new Map(),selectedFields=new Set(),pending=null,saving=false;
const draftKey=()=> 'dspace.draft.'+(state?.operator.selected??'original');
const say=(text,error=false)=>{$('message').textContent=text;$('message').classList.toggle('error',error);};
const facts=rows=>rows.map(([label,value,small])=>'<div><span>'+esc(label)+'</span><'+(small?'code':'strong')+'>'+esc(value)+'</'+(small?'code':'strong')+'></div>').join('');
function show(page){document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!=='page-'+page);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.page===page));}
async function request(url,options={}){
 const response=await fetch(url,options);
 const type=response.headers.get('content-type')??'';
 const value=type.includes('json')?await response.json():await response.text();
 if(!response.ok)throw Object.assign(new Error(value.message??'The operation could not complete.'),{status:response.status,details:value});
 return value;
}
const post=(url,value)=>request(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});
const idb=new Promise((resolve,reject)=>{
 const opening=indexedDB.open('starforge-dspace',1);opening.onupgradeneeded=()=>opening.result.createObjectStore('requests');
 opening.onsuccess=()=>resolve(opening.result);opening.onerror=()=>reject(opening.error);
});
async function savedRequest(value){
 const db=await idb;
 return new Promise((resolve,reject)=>{
  const tx=db.transaction('requests',value===undefined?'readonly':'readwrite'),store=tx.objectStore('requests');
  const req=value===undefined?store.get('pending'):value===null?store.delete('pending'):store.put(value,'pending');
  tx.oncomplete=()=>resolve(req.result??null);tx.onerror=()=>reject(tx.error);
 });
}
async function setPending(value){await savedRequest(value);pending=value;$('pending').hidden=!pending;}
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
 state=await request('/api/state');
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
 await setPending({kind:'action',project:state.operator.selected,value});
 return await resume();
 }finally{saving=false;}
}
async function resume(){
 if(!pending)return;
 if(pending.project!==state.operator.selected){await post('/api/select-project',{key:pending.project});await refresh();loadDraft();}
 let result;
 try{
  if(pending.kind==='receive'){
   result=await request('/api/receive',{method:'POST',headers:{'content-type':'application/vnd.sqlite3','x-operation-id':pending.operationId},body:pending.file});
  }else result=await post('/api/action',pending.value);
 }catch(error){
  if([400,404,409,413].includes(error.status))await setPending(null);
  throw error;
 }
 await setPending(null);await refresh();
 say(result.replayed?'Recovered the original saved result.':'Saved successfully at revision '+state.revision+'.');
 return result;
}
async function download(kind,id){
 const response=await fetch('/api/download?'+new URLSearchParams({kind,...(id?{id}:{})}));
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
 await setPending({kind:'receive',project:state.operator.selected,operationId:crypto.randomUUID(),file});
 await resume();loadDraft();e.target.value='';show('delivery');
 }finally{saving=false;}
});
on('retry','click',resume);
on('discard','click',async()=>{
 if(!pending)return;
 if(pending.kind==='receive')throw new Error('Retry this complete project to recover its original receiving result.');
 if(pending.project!==state.operator.selected){await post('/api/select-project',{key:pending.project});await refresh();loadDraft();}
 try{const saved=await request('/api/operation?id='+encodeURIComponent(pending.value.operationId));await setPending(null);await refresh();say('Recovered saved request '+saved.result.operationId+'.');}
 catch(error){if(error.status!==404)throw error;await setPending(null);say('Cleared the unsent request.');}
});
(async()=>{await refresh();loadDraft();pending=await savedRequest();$('pending').hidden=!pending;say('Opened the saved repository workspace.');})().catch(e=>say(e.message,true));
