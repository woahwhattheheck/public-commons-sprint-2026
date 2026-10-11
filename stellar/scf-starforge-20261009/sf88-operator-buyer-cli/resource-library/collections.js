// MIT — Collection decisions render as text; the original session owns every action.
const $=id=>document.getElementById(id);
const sessionKey='sf-resource-session';
const token=location.hash.slice(1)||sessionStorage.getItem(sessionKey)||'';
if(location.hash){sessionStorage.setItem(sessionKey,token);history.replaceState(null,'',location.pathname);}
const uid=()=>crypto.randomUUID?.()??Array.from(crypto.getRandomValues(new Uint8Array(24)),b=>b.toString(16).padStart(2,'0')).join('');
const message=text=>{$('message').textContent=text;};
const node=(tag,text,className)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(className)e.className=className;return e;};
const button=(text,action)=>{const e=node('button',text);e.type='button';e.addEventListener('click',()=>run(action));return e;};
const run=task=>Promise.resolve().then(task).catch(e=>message(e.message));
async function api(path,method='GET',payload){
  const response=await fetch('/api'+path,{method,headers:{Authorization:'Bearer '+token,
    ...(payload===undefined?{}:{'Content-Type':'application/json'})},body:payload===undefined?undefined:JSON.stringify(payload)});
  const value=await response.json();if(!response.ok)throw new Error(value.error??`HTTP_${response.status}`);return value;
}
let draft,storageKey,viewed=null,saving=false,downloading=false,reviewed=null,loadEpoch=0;
let listOffset=0,resultOffset=0,memberOffset=0,historyOffset=0,query='',searchEpoch=0;
const pageSize=20;
function persist(){
  if(!draft||!storageKey)return;
  try{sessionStorage.setItem(storageKey,JSON.stringify(draft));$('draft-status').textContent=draft.dirty?'Draft retained in this browser session.':'Saved edition loaded.';}
  catch{$('draft-status').textContent='Draft is active in this tab; browser storage is full.';}
  $('download').disabled=!viewed||draft.dirty||downloading;
}
function edited(){draft.name=$('name').value;draft.note=$('note').value;draft.dirty=true;persist();}
function resetDraft(){
  loadEpoch++;viewed=null;draft={id:'collection-'+uid(),revision:0,name:'',note:'',members:[],dirty:true,pending:null};
  memberOffset=0;renderEditor();persist();message('New collection. Add resources from the original library.');
}
function renderEditor(){
  $('name').value=draft.name;$('note').value=draft.note;
  $('collection-id').textContent=draft.id;
  $('edition').textContent=draft.revision?`Edition ${draft.revision}`:'Unsaved selection';
  $('load-latest').disabled=!draft.revision;
  $('download').textContent=viewed?`Download saved r${viewed.revision}`:'Download saved edition';
  renderMembers();persist();
}
function selectedCard(record,mode,index){
  const card=node('div',undefined,'card');
  const title=button(record.name,()=>review(record,mode));title.className='card-title';card.append(title);
  card.append(node('p',`${record.bytes.toLocaleString()} bytes · ${record.contentType??'unknown type'}`,'small'));
  card.append(node('p',record.intentId??record.id,'meta'));
  const tools=node('div',undefined,'tools');
  tools.append(button('Remove',()=>{draft.members.splice(index,1);draft.dirty=true;renderMembers();persist();}));
  if(index>0)tools.append(button('Move up',()=>{[draft.members[index-1],draft.members[index]]=[draft.members[index],draft.members[index-1]];draft.dirty=true;renderMembers();persist();}));
  tools.append(button('Use current review',async()=>{
    const target=draft,entry=draft.members[index];
    const current=await api('/resources/'+record.id);if(current.status!=='VERIFIED')throw new Error('Refresh and verify this resource in the library first.');
    if(draft!==target||draft.members[index]!==entry)throw new Error('Selection changed during review. Choose the resource again.');
    draft.members[index]={record:current,mode:'current'};draft.dirty=true;renderMembers();persist();
    message('Current source and analyst note selected. Save a new edition to retain them.');
  }));
  card.append(node('p',`${mode==='retain'?'Retained':'Current'} analyst revision ${record.annotation.revision}`,'small'),tools);return card;
}
function renderMembers(){
  if(memberOffset>=draft.members.length)memberOffset=Math.max(0,Math.floor((draft.members.length-1)/pageSize)*pageSize);
  const box=$('members');box.replaceChildren();
  const bytes=draft.members.reduce((n,m)=>n+BigInt(m.record.bytes),0n);
  $('selection-total').textContent=`${draft.members.length} files · ${bytes.toLocaleString()} bytes`;
  if(!draft.members.length)box.append(node('p','Add delivered resources, then save a named edition.','empty'));
  draft.members.slice(memberOffset,memberOffset+pageSize).forEach((m,i)=>box.append(selectedCard(m.record,m.mode,memberOffset+i)));
  $('member-prev').disabled=memberOffset===0;$('member-next').disabled=memberOffset+pageSize>=draft.members.length;
  $('member-page').textContent=draft.members.length?`${memberOffset+1}–${Math.min(memberOffset+pageSize,draft.members.length)}`:'0 selected';
}
async function loadCollection(id,revision){
  const epoch=++loadEpoch;
  const value=await api('/collections/'+encodeURIComponent(id)+(revision?'?revision='+revision:''));
  if(epoch!==loadEpoch)return;
  viewed=value;draft={id:value.id,revision:value.revision,name:value.name,note:value.note,
    members:value.members.map(record=>({record,mode:'retain'})),dirty:false,pending:null};
  memberOffset=0;historyOffset=0;renderEditor();await historyPage();await listPage();
  message(`Loaded saved edition ${value.revision}. Its source and note snapshots remain fixed.`);
}
async function listPage(){
  const data=await api('/collections?offset='+listOffset+'&limit='+pageSize);const box=$('collections');box.replaceChildren();
  for(const c of data.items){const card=node('div',undefined,'card'+(draft?.id===c.id?' active':''));
    const b=button(c.name,()=>loadCollection(c.id));b.className='card-title';card.append(b,node('p',`${c.memberCount} files · edition ${c.revision}`,'small'));box.append(card);}
  if(!data.items.length)box.append(node('p','No saved collections yet.','empty'));
  $('list-page').textContent=`${data.total} total`;$('list-prev').disabled=listOffset===0;$('list-next').disabled=listOffset+pageSize>=data.total;
}
async function historyPage(){
  const box=$('history-items');if(historyOffset===0)box.replaceChildren();if(!draft.revision){$('history-more').hidden=true;return;}
  const data=await api('/collections/'+draft.id+'/history?offset='+historyOffset+'&limit='+pageSize);
  for(const item of data.items){const line=node('div',undefined,'card');line.append(button(`Edition ${item.revision} · ${item.name}`,()=>loadCollection(item.id,item.revision)),node('p',`${item.memberCount} files · ${item.updatedAt}`,'small'));box.append(line);}
  $('history-more').hidden=historyOffset+pageSize>=data.total;
}
function add(records){
  const seen=new Set(draft.members.map(m=>m.record.id)), additions=[];let added=0;
  for(const record of records)if(!seen.has(record.id)){additions.push({record,mode:'current'});seen.add(record.id);}
  if(draft.members.length+additions.length>10000)throw new Error('The original library supports at most 10,000 selected resources.');
  draft.members.push(...additions);added=additions.length;
  if(added){draft.dirty=true;renderMembers();persist();}return added;
}
async function resultsPage(){
  const epoch=++searchEpoch;
  const data=await api('/resources?q='+encodeURIComponent(query)+'&status=VERIFIED&offset='+resultOffset+'&limit='+pageSize);
  if(epoch!==searchEpoch)return;
  const box=$('results');box.replaceChildren();
  for(const r of data.items){const card=node('div',undefined,'card');const title=button(r.name,()=>review(r,'current'));title.className='card-title';
    card.append(title,node('p',r.intentId,'meta'),node('p',`${r.bytes.toLocaleString()} bytes · note r${r.annotation.revision}`,'small'));
    const b=button(draft.members.some(m=>m.record.id===r.id)?'Selected':'Add resource',()=>{add([r]);return resultsPage();});
    b.disabled=draft.members.some(m=>m.record.id===r.id);card.append(b);box.append(card);}
  if(!data.items.length)box.append(node('p','No matching verified resources. Refresh the original resource library to read current files.','empty'));
  $('results-total').textContent=`${data.total} matching resources`;$('add-results').disabled=data.total===0;
  $('result-prev').disabled=resultOffset===0;$('result-next').disabled=resultOffset+pageSize>=data.total;
  $('result-page').textContent=data.total?`${resultOffset+1}–${Math.min(resultOffset+pageSize,data.total)}`:'0 results';
}
async function addAll(){
  $('add-results').disabled=true;const records=[],target=draft,selectedQuery=query;let offset=0,generation,total;
  try{do{
    const page=await api('/resources?q='+encodeURIComponent(query)+'&status=VERIFIED&offset='+offset+'&limit=200');
    if(generation&&page.scan?.generation!==generation)throw new Error('Library refresh changed during selection. Search again.');
    generation=page.scan?.generation;total=page.total;records.push(...page.items);offset+=page.items.length;
    if(!page.items.length&&offset<total)throw new Error('Library changed during selection. Search again.');
  }while(offset<total);
  if(target!==draft||selectedQuery!==query)throw new Error('Selection changed during search. Add matching resources again.');
  message(`Added ${add(records)} complete resource selections.`);await resultsPage();
  }finally{$('add-results').disabled=false;}
}
async function save(){
  if(saving)return;if(!$('save-form').reportValidity())return;
  saving=true;$('save').disabled=true;
  try{
    const request={id:draft.id,name:$('name').value,note:$('note').value,expectedRevision:draft.revision,
      members:draft.members.map(({record:r,mode})=>({id:r.id,mode,sha256:r.sha256,annotationRevision:r.annotation.revision}))};
    const target=draft,serialized=JSON.stringify(request);
    const pending=draft.pending?.serialized===serialized?draft.pending:{serialized,operationId:uid()};
    draft.pending=pending;persist();
    const value=await api('/collections','PUT',{...request,operationId:pending.operationId});
    if(draft===target){
      const latest=JSON.stringify({id:draft.id,name:$('name').value,note:$('note').value,expectedRevision:draft.revision,
        members:draft.members.map(({record:r,mode})=>({id:r.id,mode,sha256:r.sha256,annotationRevision:r.annotation.revision}))});
      if(latest===serialized)await loadCollection(value.id,value.revision);
      else{draft.revision=value.revision;draft.pending=null;viewed=value;renderEditor();await listPage();}
    }else await listPage();
    await resultsPage();message(`Saved edition ${value.revision}: ${value.members.length} selected files.${draft===target&&draft.dirty?' Later edits remain in the draft.':''}`);
  }finally{saving=false;$('save').disabled=false;}
}
async function download(){
  if(!viewed||draft.dirty||downloading)return;
  downloading=true;persist();message(`Preparing the complete saved edition ${viewed.revision}…`);
  try{const result=await api('/collections/'+viewed.id+'/download','POST',{revision:viewed.revision});
    const anchor=document.createElement('a');anchor.href=result.url;anchor.download='';document.body.append(anchor);anchor.click();anchor.remove();
    message(`Complete archive: ${result.bytes.toLocaleString()} bytes · SHA-256 ${result.sha256}`);
  }finally{downloading=false;persist();}
}
function review(record,mode){
  reviewed={record,mode,collection:viewed};$('review').hidden=false;$('review-title').textContent=record.name;
  $('review-source').textContent=`${record.bytes.toLocaleString()} bytes · ${record.contentType??'unknown type'}`;
  $('review-identity').textContent=JSON.stringify({resourceId:record.id,sha256:record.sha256,
    originalRequest:record.intentId,source:record.source,path:record.path,paymentTerms:record.paymentTerms,
    ...(record.origin?{origin:record.origin}:{})},null,2);
  $('review-note').textContent=record.annotation.note||'No saved analyst note.';
  $('preview-status').textContent='The selected resource will be checked against its exact size and SHA-256.';
  $('preview-content').textContent='';$('review').scrollIntoView({behavior:'smooth',block:'start'});
}
async function preview(){
  const selection=reviewed;if(!selection)return;
  const path=selection.mode==='retain'&&selection.collection
    ?`/collections/${selection.collection.id}/preview?revision=${selection.collection.revision}&resource=${selection.record.id}`
    :`/resources/${selection.record.id}/preview`;
  const data=await api(path);if(reviewed!==selection)return;
  $('preview-status').textContent=`${data.coverage} text preview · ${data.bytes.toLocaleString()} complete bytes verified`;
  $('preview-content').textContent=data.text??'Binary resource. The handoff contains all original bytes.';
}
$('new').onclick=()=>run(async()=>{resetDraft();await historyPage();await resultsPage();});
$('name').oninput=edited;$('note').oninput=edited;
$('save-form').onsubmit=e=>{e.preventDefault();run(save);};
$('load-latest').onclick=()=>run(()=>loadCollection(draft.id));$('reload-list').onclick=()=>run(listPage);
$('download').onclick=()=>run(download);$('preview').onclick=()=>run(preview);$('review-close').onclick=()=>{$('review').hidden=true;};
$('search-form').onsubmit=e=>{e.preventDefault();query=$('query').value;resultOffset=0;run(resultsPage);};
$('add-results').onclick=()=>run(addAll);
$('list-prev').onclick=()=>run(()=>{listOffset=Math.max(0,listOffset-pageSize);return listPage();});
$('list-next').onclick=()=>run(()=>{listOffset+=pageSize;return listPage();});
$('result-prev').onclick=()=>run(()=>{resultOffset=Math.max(0,resultOffset-pageSize);return resultsPage();});
$('result-next').onclick=()=>run(()=>{resultOffset+=pageSize;return resultsPage();});
$('member-prev').onclick=()=>{memberOffset=Math.max(0,memberOffset-pageSize);renderMembers();};
$('member-next').onclick=()=>{memberOffset+=pageSize;renderMembers();};
$('history-more').onclick=()=>run(()=>{historyOffset+=pageSize;return historyPage();});
run(async()=>{
 const status=await api('/status');storageKey='sf-collection-draft:'+status.config.kind+':'+status.config.source;
 try{draft=JSON.parse(sessionStorage.getItem(storageKey));}catch{}
 if(draft?.id&&Array.isArray(draft.members)){
   if(draft.revision)viewed=await api('/collections/'+draft.id+'?revision='+draft.revision);
   renderEditor();message('Restored the retained browser draft.');
 }else resetDraft();
 await listPage();await resultsPage();await historyPage();
});
