/* MIT. Subscription collection UI; original source attributes render as text. */
'use strict';
const $=id=>document.getElementById(id), tokenKey='sf30-feed-token';
if(location.hash.length>1){sessionStorage.setItem(tokenKey,location.hash.slice(1));history.replaceState(null,'',location.pathname+location.search);}
const token=sessionStorage.getItem(tokenKey)||'', pendingKey='sf30-collection-pending', draftKey='sf30-collection-draft';
let library={collections:[],sources:[]}, native={feeds:[],fields:[],defaultFields:[]}, members=[], documents={};
let selected='', savedView=null, selectedRun='', runView=null, running=false;
const op=()=> 'collection-'+crypto.randomUUID(), short=s=>s?s.slice(0,12):'';
const e=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
function notify(message,bad=false){$('notice').textContent=message;$('notice').classList.toggle('error',bad);}
function safe(fn){return async event=>{if(event?.type==='submit')event.preventDefault();try{await fn(event);}catch(error){notify(error.message,true);}};}
function button(label,fn){const n=e('button',label);n.type='button';n.addEventListener('click',safe(fn));return n;}
function url(path,values){return path+'?'+new URLSearchParams(values);}
function link(label,target){const n=e('a',label);n.href=target;return n;}
function table(names,rows){const wrap=e('div',undefined,'table-scroll'),t=e('table'),head=e('thead'),tr=e('tr'),body=e('tbody');for(const n of names)tr.append(e('th',n));head.append(tr);for(const row of rows){const tr=e('tr');for(const item of row){const td=e('td');if(item instanceof Node)td.append(item);else td.textContent=item??'';tr.append(td);}body.append(tr);}t.append(head,body);wrap.append(t);return wrap;}
function options(node,items,value){node.replaceChildren(...items.map(([v,label])=>{const n=e('option',label);n.value=v;return n;}));if(items.some(x=>x[0]===value))node.value=value;}
function readStored(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}}
function pending(value){if(value)sessionStorage.setItem(pendingKey,JSON.stringify(value));else sessionStorage.removeItem(pendingKey);$('pending').hidden=!value;$('pending-text').textContent=value?.kind==='upload'?'Select '+value.name+' again to resume its original upload action.':'The original action is retained in this browser.';}
function draft(){sessionStorage.setItem(draftKey,JSON.stringify({id:$('collection-id').value,title:$('collection-title').value,revision:Number($('collection-revision').value),members}));renderCount();}
async function api(path,init={}){const response=await fetch(path,{...init,headers:{Authorization:'Bearer '+token,...init.headers}});const result=await response.json();if(!response.ok)throw new Error(result.error||'Workspace returned HTTP '+response.status);return result;}
async function watch(job){running=true;$('activity').hidden=false;try{while(job.state==='RUNNING'){$('activity-title').textContent=job.action;$('activity-detail').textContent=job.collection?Object.entries(job.collection.counts||{}).map(([k,v])=>k+': '+v).join(' · ')+(job.collection.feedId?' · '+job.collection.feedId:''):job.capture?.url||'Retaining original workspace operation';await new Promise(resolve=>setTimeout(resolve,700));job=await api('/api/activity');}if(job.state==='FAILED')throw new Error(job.error||'Workspace operation failed');return job.result;}finally{running=false;$('activity').hidden=true;}}
async function submit(body){if(running)throw new Error('Follow the running action before starting another.');pending({kind:'action',body});const result=await watch(await api('/api/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}));pending(null);return result;}
async function upload(kind,file){if(!file)throw new Error('Choose the original file.');if(running)throw new Error('Follow the running action first.');const retained=readStored(pendingKey);const same=retained?.kind==='upload'&&retained.action===kind&&retained.name===file.name&&retained.bytes===file.size&&retained.lastModified===file.lastModified;const operationId=same?retained.operationId:op();pending({kind:'upload',action:kind,name:file.name,bytes:file.size,lastModified:file.lastModified,operationId});const result=await watch(await api(url('/api/subscriptions/'+kind,{operation:operationId}),{method:'POST',headers:{'Content-Type':'application/octet-stream'},body:file}));pending(null);return result;}
async function download(path,name){
 const file=window.showSaveFilePicker?await window.showSaveFilePicker({suggestedName:name}):null;
 const response=await fetch(path,{headers:{Authorization:'Bearer '+token}});if(!response.ok){let error=await response.json();throw new Error(error.error||'Download failed');}
 if(file){const writer=await file.createWritable();try{await response.body.pipeTo(writer);}catch(error){await writer.abort().catch(()=>{});throw error;}}
 else{const blob=await response.blob(),object=URL.createObjectURL(blob),a=link(name,object);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);}
}
function saveJSON(value,name){const object=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'})),a=link(name,object);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);}
function renderCount(){const enabled=members.filter(x=>x.enabled),ids=new Set(enabled.map(x=>x.feedId));$('selection-count').textContent=members.length+' outline entries · '+enabled.length+' enabled entries · '+ids.size+' selected feeds';}
function visibleMembers(){const q=$('entry-filter').value.toLowerCase();return members.filter(m=>!q||[m.label,m.url,...(m.folders||[])].join(' ').toLowerCase().includes(q));}
function renderMembers(){
 const rows=visibleMembers().map(member=>{
  const check=e('input');check.type='checkbox';check.checked=member.enabled;check.disabled=!!member.error;check.setAttribute('aria-label','Enable '+member.label);check.onchange=()=>{member.enabled=check.checked;draft();};
  const title=e('div',undefined,'subscription-label');title.append(e('strong',member.label||member.feedId||'Subscription'),e('p',(member.folders||[]).join(' / '),'muted'),e('p',member.url||'Invalid source URL','mono'));if(member.attributes?.category)title.append(e('p','Categories: '+member.attributes.category,'muted'));if(member.commented)title.append(e('p','Commented in original OPML; enable explicitly to select.','muted'));if(member.error)title.append(e('p',member.error,'error'));
  const id=e('input');id.className='subscription-id';id.value=member.feedId||'';id.maxLength=80;id.setAttribute('aria-label','Feed ID for '+member.label);id.oninput=()=>{member.feedId=id.value||null;draft();};
  const controls=e('div');controls.append(id,e('p',native.feeds.some(f=>f.id===member.feedId)?'Existing registered feed':savedView?.collection.feeds.some(f=>f.id===member.feedId)?'Missing registration — saving restores the retained complete configuration':'New feed at the exact displayed URL','muted'),button('Remove entry',()=>{members=members.filter(x=>x!==member);draft();renderMembers();}));
  return [check,title,controls];
 });$('member-list').replaceChildren(rows.length?table(['Use','Original subscription','Feed mapping'],rows):e('p','Import an OPML document or add an existing registered feed.','muted'));renderCount();
}
async function loadLibrary(){
 const values=await Promise.all([api('/api/subscriptions'),api('/api/state')]);library=values[0];native=values[1];
 $('collection-list').replaceChildren(...library.collections.map(c=>button(c.title+' · r'+c.revision+' · '+c.feeds+' feeds',()=>chooseCollection(c.id))));
 options($('manual-feed'),[['','Choose a registered feed'],...native.feeds.map(f=>[f.id,f.config.label+' · '+f.id])],$('manual-feed').value);
 $('sources').replaceChildren(...library.sources.map(s=>{const row=e('div',undefined,'source-row');row.append(e('p',s.title),e('p',s.subscriptions+' subscriptions · '+short(s.id),'muted'),button('Add entries to selection',()=>addSource(s.id)),button('Original OPML',()=>download(url('/api/subscriptions/original',{source:s.id}),short(s.id)+'.opml')));return row;}));
 if(!$('edition-fields').children.length)for(const field of native.fields){const label=e('label'),input=e('input');input.type='checkbox';input.value=field;input.checked=native.defaultFields.includes(field);if(field==='key')input.disabled=true;label.append(input,document.createTextNode(field));$('edition-fields').append(label);}
}
async function addSource(sourceId){
 const plan=await api(url('/api/subscriptions/plan',{source:sourceId}));documents[sourceId]=plan.source;
 const keys=new Set(members.map(m=>m.sourceId+':'+m.entryId));
 for(const row of plan.entries)if(!keys.has(sourceId+':'+row.entryId))members.push({...row,feedId:row.error?null:row.suggestedFeedId,enabled:row.selected});
 if(!$('collection-title').value)$('collection-title').value=plan.source.head.title||'Subscription collection';
 draft();renderMembers();notify('Original folder structure and '+plan.entries.length+' subscription entries are ready for selection.');
}
function actionBody(){
 const newFeeds={},configs=new Map(native.feeds.map(f=>[f.id,f.config])),retainedConfigs=new Map((savedView?.collection.feeds||[]).map(f=>[f.id,f.config]));
 const normalized=members.map(m=>{
  let feedId=m.feedId||null;
  if(!m.enabled&&feedId&&!configs.has(feedId)&&!retainedConfigs.has(feedId))feedId=null;
  if(feedId&&!configs.has(feedId)){
   if(!m.url)throw new Error('Choose a valid source URL for '+m.label);
   const parsed=new URL(m.url),config=retainedConfigs.get(feedId)||{url:m.url,label:(m.label||feedId).slice(0,160),rssIdentity:'guid-or-link',allowedOrigins:[parsed.origin]};
   if(newFeeds[feedId]&&newFeeds[feedId].url!==m.url)throw new Error('Two original URLs use the same new feed ID: '+feedId);
   newFeeds[feedId] ||= config;
  }
  return {sourceId:m.sourceId||null,entryId:m.entryId||null,feedId,enabled:!!m.enabled};
 });
 return {action:'collection-save',collectionId:$('collection-id').value,title:$('collection-title').value,members:normalized,newFeeds,expectedRevision:Number($('collection-revision').value),operationId:op()};
}
async function chooseCollection(id,requestedRun=''){
 const view=await api(url('/api/subscriptions/collection',{id}));
 const nextRun=requestedRun||(id===selected?selectedRun:'');
 if(nextRun&&!view.runs.some(r=>r.id===nextRun))throw new Error('The selected acquisition belongs to another collection.');
 selected=id;savedView=view;selectedRun=nextRun;runView=null;$('run-review').replaceChildren();
 const docs=await Promise.all(view.collection.sources.map(async s=>[s,await api(url('/api/subscriptions/plan',{source:s}))]));
 documents=Object.fromEntries(docs.map(([s,p])=>[s,p.source]));const configs=new Map(view.collection.feeds.map(f=>[f.id,f.config]));
 members=view.collection.members.map(m=>{const original=m.sourceId?docs.find(([s])=>s===m.sourceId)[1].entries.find(x=>x.entryId===m.entryId):null,config=configs.get(m.feedId);return {...original,...m,feedId:m.feedId||original?.suggestedFeedId||null,label:original?.label||config?.label||m.feedId,url:original?.url||config?.url,folders:original?.folders||[]};});
 $('collection-id').value=id;$('collection-id').readOnly=true;$('collection-title').value=view.collection.title;$('collection-revision').value=view.collection.revision;
 $('edition-name').value=view.collection.title+' edition';draft();renderMembers();renderSaved();history.replaceState(null,'',url('/subscriptions',{collection:id,...(selectedRun?{run:selectedRun}:{})}));notify('Opened saved collection revision '+view.collection.revision+'.');
}
async function refreshSaved(){if(!selected)return;savedView=await api(url('/api/subscriptions/collection',{id:selected}));renderSaved();if(selectedRun)await chooseRun(selectedRun);}
function renderSaved(){
 $('saved-panel').hidden=!savedView;if(!savedView)return;const view=savedView,c=view.collection;
 $('saved-title').textContent=c.title;$('saved-meta').textContent=c.id+' · revision '+c.revision+' · '+short(c.digest);
 $('feed-status').replaceChildren(table(['Feed','Current revision','Selected source'],view.feeds.map(f=>[f.id,f.revision??'Missing',f.configurationChanged?'Configuration changed; revise collection selection':f.config.url])));
 const missing=view.registrations.filter(f=>f.missing);
 if(missing.length)$('feed-status').append(e('p','Retained registrations to restore on save: '+missing.map(f=>f.id+' ('+(f.enabled?'enabled':'disabled')+')').join(', ')+'. Their full source origins and RSS identity settings are retained.','muted'));
 $('capture').disabled=view.feeds.some(f=>f.configurationChanged||f.missing);
 options($('run-select'),[['','Choose a retained acquisition'],...view.runs.map(r=>[r.id,new Date(r.createdAt*1000).toLocaleString()+' · '+r.state+' · '+r.items.length+' feeds'])],selectedRun);
 $('binding-list').replaceChildren(...view.editions.map(b=>{
  const row=e('div',undefined,'binding');row.append(e('p','Collection r'+b.collectionRevision+' · native edition '+short(b.editionId),'mono'));
  const controls=e('div',undefined,'actions');controls.append(link('Query native edition',url('/',{edition:b.editionId})),button('Complete collection project',()=>download(url('/api/subscriptions/project',{binding:b.id}),'feed-collection-'+short(b.id)+'.zip')),button('Original dataset export',()=>download(url('/api/export',{edition:b.editionId}),'feed-dataset-'+short(b.editionId)+'.zip')));row.append(controls);return row;
 }));if(!view.editions.length)$('binding-list').append(e('p','Create an edition after reviewing the retained acquisition.','muted'));
}
async function chooseRun(id){
 if(!id){selectedRun='';runView=null;$('run-review').replaceChildren();return;}
 const reviewed=await api(url('/api/subscriptions/run',{id}));
 if(reviewed.run.collectionId!==selected)throw new Error('The selected acquisition belongs to another collection.');
 runView=reviewed;selectedRun=id;$('run-select').value=id;history.replaceState(null,'',url('/subscriptions',{collection:selected,run:id}));
 $('run-resume').disabled=runView.run.state==='CAPTURED';
 const rows=runView.items.map(item=>{
  const summary=e('div');summary.append(e('p',item.state+(item.application?' · applied r'+item.application.revision:'')));
  if(item.counts)summary.append(e('p',Object.entries(item.counts).map(([k,v])=>k+': '+v).join(' · '),'muted'));if(item.error)summary.append(e('p',item.error,'run-error'));
  const controls=e('div',undefined,'actions');
  if(item.captureId)controls.append(link('Review original capture',url('/',{feed:item.feedId,capture:item.captureId,collection:selected,run:id})));
  if(item.state==='CAPTURED'&&!item.application&&!item.counts?.CONFLICT&&!item.feedIdentityChanged)controls.append(button('Apply these changes',async()=>{await submit({action:'apply',captureId:item.captureId,expectedRevision:item.feed.revision,operationId:op(),decisions:{},acceptIdentity:false});await loadLibrary();await refreshSaved();notify('Original capture applied for '+item.feedId+'.');}));
  return [item.feedId,summary,controls];
 });
 $('run-review').replaceChildren(e('p','Acquisition '+short(id)+' · collection r'+runView.run.collectionRevision,'mono'),table(['Feed','Retained result','Review and recovery'],rows));
}
$('collection-form').onsubmit=safe(async()=>{const result=await submit(actionBody());await loadLibrary();await chooseCollection(result.id);notify('Saved collection revision '+result.revision+'.');});
$('collection-id').oninput=draft;$('collection-title').oninput=draft;$('entry-filter').oninput=renderMembers;
$('select-visible').onclick=()=>{for(const m of visibleMembers())if(!m.error)m.enabled=true;draft();renderMembers();};
$('clear-visible').onclick=()=>{for(const m of visibleMembers())m.enabled=false;draft();renderMembers();};
$('new').onclick=()=>{selected='';savedView=null;selectedRun='';runView=null;members=[];documents={};$('collection-id').readOnly=false;$('collection-id').value='';$('collection-title').value='';$('collection-revision').value='0';$('saved-panel').hidden=true;draft();renderMembers();history.replaceState(null,'','/subscriptions');notify('Choose an original document or registered feeds for the new collection.');};
$('add-manual').onclick=safe(()=>{const f=native.feeds.find(f=>f.id===$('manual-feed').value);if(!f)throw new Error('Choose a registered feed.');if(members.some(m=>!m.sourceId&&m.feedId===f.id))throw new Error('This registered feed is already selected.');members.push({sourceId:null,entryId:null,feedId:f.id,enabled:true,label:f.config.label,url:f.config.url,folders:[]});draft();renderMembers();});
$('import-form').onsubmit=safe(async()=>{const result=await upload('import',$('opml-file').files[0]);await loadLibrary();await addSource(result.sourceId);});
$('receive-form').onsubmit=safe(async()=>{const result=await upload('receive',$('packet-file').files[0]);await loadLibrary();await chooseCollection(result.collectionId,result.runId);await chooseRun(result.runId);notify('Received original collection and native edition '+short(result.editionId)+'.');});
$('save-action').onclick=safe(()=>saveJSON(actionBody(),'collection-selection.json'));
$('selected-opml').onclick=safe(()=>{if(!selected)throw new Error('Save the collection first.');return download(url('/api/subscriptions/opml',{collection:selected}),'subscriptions.opml');});
$('capture-form').onsubmit=safe(async()=>{
 if(!savedView)throw new Error('Open a saved collection.');const expectedRevisions=Object.fromEntries(savedView.feeds.map(f=>[f.id,f.revision]));
 const result=await submit({action:'collection-capture',collectionId:selected,expectedRevision:savedView.collection.revision,expectedRevisions,pageLimit:Number($('pages').value),force:$('force').checked,operationId:op()});
 selectedRun=result.id;await refreshSaved();notify('Retained acquisition: '+result.state+'.');
});
$('run-select').onchange=safe(()=>chooseRun($('run-select').value));$('run-refresh').onclick=safe(()=>refreshSaved());
$('run-resume').onclick=safe(async()=>{if(!selectedRun)throw new Error('Choose an acquisition.');const result=await submit({action:'collection-resume',runId:selectedRun});await refreshSaved();notify('Retained acquisition: '+result.state+'.');});
$('edition-form').onsubmit=safe(async()=>{
 if(!runView)throw new Error('Choose an acquired collection.');const expectedRevisions={};for(const item of runView.items){if(!item.application)throw new Error('Review and apply '+item.feedId+' first.');expectedRevisions[item.feedId]=item.application.revision;}
 const fields=[...$('edition-fields').querySelectorAll('input:checked')].map(n=>n.value);
 const result=await submit({action:'collection-edition',runId:selectedRun,name:$('edition-name').value,fields,expectedRevisions,operationId:op()});
 await loadLibrary();await refreshSaved();notify('Created native collection edition with '+result.edition.rowCount+' rows.');
});
$('cancel').onclick=safe(async()=>{await api('/api/cancel',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});notify('Acquisition cancellation requested; completed feed captures stay retained.');});
$('retry').onclick=safe(async()=>{const retained=readStored(pendingKey);if(retained?.kind==='action'){await submit(retained.body);await loadLibrary();await refreshSaved();notify('Original action recovered.');}else notify('Choose '+retained?.name+' in its original file form.');});
$('forget').onclick=()=>{pending(null);notify('Browser action selection cleared.');};
$('refresh').onclick=safe(async()=>{await loadLibrary();await refreshSaved();renderMembers();notify('Retained library and acquisition state refreshed.');});
async function boot(){
 pending(readStored(pendingKey));const current=await api('/api/activity');if(current.state==='RUNNING')await watch(current);await loadLibrary();
 const query=new URLSearchParams(location.search),retained=readStored(draftKey);
 if(query.get('collection')){
  await chooseCollection(query.get('collection'),query.get('run')||'');if(selectedRun)await chooseRun(selectedRun);
  if(retained?.id===query.get('collection')){
   $('collection-title').value=retained.title;$('collection-revision').value=retained.revision;members=retained.members||[];
   draft();renderMembers();notify('Restored unsaved selection based on revision '+retained.revision+'. Current saved revision: '+savedView.collection.revision+'.');
  }
 }
 else if(retained){$('collection-id').value=retained.id;$('collection-title').value=retained.title;$('collection-revision').value=retained.revision;members=retained.members||[];if(retained.revision&&library.collections.some(c=>c.id===retained.id)){selected=retained.id;$('collection-id').readOnly=true;await refreshSaved();}renderMembers();notify('Restored browser collection selection.');}
 else{renderMembers();notify(library.collections.length+' saved collections · '+library.sources.length+' original OPML documents.');}
}
void boot().catch(error=>notify(error.message,true));
