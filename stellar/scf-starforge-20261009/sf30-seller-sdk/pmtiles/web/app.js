const $=id=>document.getElementById(id),copy=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const eq=(a,b)=>canonical(a)===canonical(b);
let token='',state=null,resources=[],resourceOffset=0,draft=null,savedDraft=null,pending=null,uploads=[],inspection=null,review=null,map=null,mapPath=null,mapOpeningPath=null,mapGeneration=0,mapAbort=null,refreshing=false,workspaceKey=null,closedRequests=[],lastPackage=null;
const fields={editionId:'editionId',expectedVersion:'expectedVersion',name:'editionName',notes:'editionNotes',style:'styleResource',archivesText:'archives',spriteText:'sprite',glyphsText:'glyphs',decisionsText:'decisions',viewText:'view'};
function message(text,error=false){$('notice').textContent=text;$('notice').className=error?'error':'success';}
function uuid(prefix){return prefix+'-'+crypto.randomUUID().replaceAll('-','');}
function currentDraft(){const value={};for(const [key,id] of Object.entries(fields))value[key]=$(id).value;value.expectedVersion=Number(value.expectedVersion);return value;}
function applyDraft(value){draft=copy(value);ensureStyleOption(value.style);for(const [key,id] of Object.entries(fields))$(id).value=String(value[key]??'');}
function persist(){
  if(!workspaceKey)return;
  draft=currentDraft();
  try{localStorage.setItem(workspaceKey,JSON.stringify({schema:'pmtiles.browser.v1',workspaceId:state.id,draft,savedDraft,pending,uploads,inspection,review,closedRequests,
    reviewer:$('reviewer').value,reviewNote:$('reviewNote').value,exportDirectory:$('exportDirectory').value,packageDirectory:$('packageDirectory').value,packageDestination:$('packageDestination').value,lastPackage}));}
  catch(error){message('Browser storage could not retain these edits. Download the edition draft before closing this tab. '+error.message,true);}
  $('draftStatus').textContent=savedDraft&&eq(draft,savedDraft)?'Saved version '+draft.expectedVersion:'Unsaved edits';
  $('pending').textContent=pending?'Retained request '+pending.input.requestId+' · '+pending.action:'';
}
async function api(path,{method='GET',body,binary,raw=false}={}){
  const headers={Authorization:'Bearer '+token};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(binary!==undefined)headers['Content-Type']='application/octet-stream';
  const response=await fetch(path,{method,headers,body:binary!==undefined?binary:body===undefined?undefined:JSON.stringify(body),cache:'no-store'});
  if(response.status===401){$('connection').hidden=false;throw Error('Reconnect using the current workspace access token. Your saved draft is retained.');}
  if(!response.ok){let value;try{value=await response.json();}catch{}throw Object.assign(new Error(value?.error?.message??'HTTP '+response.status),{code:value?.error?.code,status:response.status});}
  return raw?response:response.json();
}
function ensureStyleOption(id){
  if(id&&!Array.from($('styleResource').options).some(option=>option.value===id)){
    const option=document.createElement('option');option.value=id;option.textContent=id;$('styleResource').append(option);
  }
}
function option(select,value,label){const node=document.createElement('option');node.value=value;node.textContent=label;select.append(node);}
function item(container,title,details,actions=[]){
  const row=document.createElement('div');row.className='item';const heading=document.createElement('strong');heading.textContent=title;row.append(heading);
  const meta=document.createElement('div');meta.className='meta';meta.textContent=details;row.append(meta);
  for(const action of actions){const button=document.createElement('button');button.type='button';button.textContent=action.label;
    button.onclick=()=>Promise.resolve().then(action.run).catch(error=>message(error.message,true));row.append(button);}
  container.append(row);return row;
}
async function loadResources(reset=false){
  if(reset){resources=[];resourceOffset=0;}
  const page=await api('/api/resources?offset='+resourceOffset+'&limit=200');
  for(const row of page.items)if(!resources.some(old=>old.id===row.id))resources.push(row);
  resourceOffset=page.nextOffset;$('moreResources').disabled=!page.hasMore;renderResources();
}
function renderResources(){
  const selected=$('styleResource').value;$('styleResource').replaceChildren();option($('styleResource'),'','Select an original style');
  for(const row of resources.filter(row=>row.kind==='style'))option($('styleResource'),row.id,row.name+' · '+row.id.slice(-8));
  ensureStyleOption(selected);$('styleResource').value=selected;$('resources').replaceChildren();
  for(const row of resources)item($('resources'),row.name,row.kind+' · '+row.bytes.toLocaleString()+' bytes · '+row.id,[
    {label:'Copy ID',run:()=>navigator.clipboard.writeText(row.id)},
    {label:'Download',run:async()=>{const response=await api('/api/resources/'+row.id+'/download',{raw:true});downloadBlob(await response.blob(),row.name);}}
  ]);
  $('sourceStatus').textContent=state?state.counts.resources+' retained sources; '+resources.length+' loaded.':'';
}
function fromEdition(value){return {editionId:value.id,expectedVersion:value.version,name:value.name,notes:value.notes,style:value.style,
  archivesText:JSON.stringify(value.archives,null,2),spriteText:JSON.stringify(value.sprite,null,2),glyphsText:JSON.stringify(value.glyphs,null,2),
  decisionsText:JSON.stringify(value.layerDecisions,null,2),viewText:JSON.stringify(value.view,null,2)};}
async function loadEdition(id,version){
  persist();if(draft&&!eq(draft,savedDraft))localStorage.setItem(workspaceKey+':draft:'+draft.editionId,JSON.stringify(draft));
  const value=await api('/api/editions/'+encodeURIComponent(id)+'/'+version);
  const recalled=localStorage.getItem(workspaceKey+':draft:'+id);
  savedDraft=fromEdition(value);
  if(recalled){const old=JSON.parse(recalled);if(old.expectedVersion===version){applyDraft(old);message('Reopened the retained draft for '+id+'.');}
    else{applyDraft(savedDraft);message('Opened saved version '+version+'. Its older local draft remains retained.');}}
  else applyDraft(savedDraft);
  inspection=null;review=null;persist();renderReview();
}
function renderState(){
  $('identity').textContent=state.title+' · '+state.id+' · revision '+state.revision;
  $('currentRelease').textContent=state.currentRelease?'Published release: '+state.currentRelease:'No published release selected.';
  $('editions').replaceChildren();for(const edition of state.editions)item($('editions'),edition.name,
    edition.id+' · version '+edition.version,[{label:'Open',run:()=>loadEdition(edition.id,edition.version)}]);
  const selected=$('release').value;$('release').replaceChildren();option($('release'),'','Select a prepared release');
  for(const release of state.releases)option($('release'),release.id,release.editionId+' v'+release.editionVersion+' · '+release.id.slice(-8));
  if(selected&&state.releases.some(row=>row.id===selected))$('release').value=selected;
  else if(state.currentRelease){if(!state.releases.some(row=>row.id===state.currentRelease))option($('release'),state.currentRelease,state.currentRelease);$('release').value=state.currentRelease;}
  $('operations').replaceChildren();
  for(const row of state.operations)item($('operations'),row.kind+' · '+row.status,row.id+(row.error?' · '+row.error.message:''),[
    {label:'Open result',run:async()=>{const result=await api('/api/requests/'+row.id);showJson($('inspection'),result);}}
  ]);
  renderReview();updateMap().catch(error=>message(error.message,true));
}
function renderReview(){
  if(inspection){const r=inspection.result;$('inspection').replaceChildren();
    item($('inspection'),'Original archive inspection complete',
      'Edition '+r.editionId+' v'+r.version+' · '+r.inspections.length+' archive(s) · request '+inspection.requestId);
    for(const row of r.inspections)item($('inspection'),row.nativeVersion,
      row.bytes.toLocaleString()+' bytes · zoom '+row.header.minZoom+'–'+row.header.maxZoom+' · SHA256 '+row.resourceSha256);
  }
  $('reviewStatus').textContent=review?'Saved review '+review.id+' · '+review.reviewer+' · '+review.edition.id+' v'+review.edition.version:'Record a review after inspecting the saved edition.';
}
function showJson(container,value){container.replaceChildren();const pre=document.createElement('pre');pre.textContent=JSON.stringify(value,null,2);container.append(pre);}
function editionInput(){
  const d=currentDraft();return {schema:'starforge.pmtiles-edition.v1',name:d.name,notes:d.notes,style:d.style,
    archives:JSON.parse(d.archivesText),sprite:JSON.parse(d.spriteText),glyphs:JSON.parse(d.glyphsText),
    layerDecisions:JSON.parse(d.decisionsText),view:JSON.parse(d.viewText)};
}
function unchangedSaved(){const d=currentDraft();if(!savedDraft||!eq(d,savedDraft))throw Error('Save the current edition before inspecting or reviewing it.');return d;}
async function applyResult(job,result){
  if(job.action==='save-edition'){
    const current=currentDraft(),submitted=job.draft;
    if(current.editionId===job.input.editionId&&current.expectedVersion===job.input.expectedVersion&&
      result.id===job.input.editionId&&result.version===job.input.expectedVersion+1){
      savedDraft=fromEdition(result);
      if(eq(current,submitted))applyDraft(savedDraft);
      else{current.expectedVersion=result.version;applyDraft(current);}
    }
    inspection=null;review=null;
  }
  if(job.action==='inspect')inspection={requestId:job.input.requestId,result};
  if(job.action==='review')review=result;
  if(job.action==='prepare-release'){$('release').value=result.id;state.releases.unshift(result);renderState();$('release').value=result.id;}
  if(job.action==='export')showJson($('exportResult'),result);
  if(job.action==='package'){
    lastPackage={stagingDirectory:job.input.stagingDirectory,requestId:job.input.requestId,expectedWorkspaceId:state.id,archiveSha256:result.archive.sha256,
      bytes:result.archive.bytes,packageId:result.packageId,sourceFiles:result.sourceFiles,logicalFiles:result.logicalFiles};
    renderPackage();
  }
  if(job.action==='publish'||job.action==='restore'){if(result.previewError)message('The release selection is saved. Native preview needs reopening: '+result.previewError.message,true);}
  if(pending?.input.requestId===job.input.requestId)pending=null;persist();
}
async function dispatch(action,input){
  if(pending)throw Error('Resume the retained request before starting another action.');
  input={...input,requestId:uuid(action),expectedWorkspaceId:state.id};
  const job={action,input,draft:currentDraft()};pending=copy(job);persist();
  try{const result=await api('/api/actions/'+action,{method:'POST',body:input});await applyResult(job,result);await refresh();return result;}
  catch(error){if(pending?.input.requestId===job.input.requestId){pending.lastError={message:error.message,code:error.code??null,status:error.status??null,at:new Date().toISOString()};}persist();throw error;}
}
function completedResult(job,operation){
  for(const [key,value] of Object.entries(job.input))if(!eq(operation.input[key],value))throw Error('The original saved request has different inputs.');
  if(job.action==='publish')return {publication:operation.result,preview:state.preview,previewError:null};
  if(job.action==='restore')return {restoration:operation.result,preview:state.preview,previewError:null};
  return operation.result;
}
async function resume(){
  if(!pending){message('There is no unresolved browser request.');return;}
  const job=copy(pending);
  try{
    const operation=await api('/api/requests/'+job.input.requestId);
    if(operation.status==='COMPLETE'){
      await applyResult(job,completedResult(job,operation));await refresh();message('Recovered the original completed request.');return;
    }
    // The saved row may outlive its process. Reuse the original request; the native workspace lease decides whether it is active.
  }catch(error){if(error.status!==404)throw error;}
  try{const result=await api('/api/actions/'+job.action,{method:'POST',body:job.input});await applyResult(job,result);await refresh();}
  catch(error){if(pending?.input.requestId===job.input.requestId)pending.lastError={message:error.message,code:error.code??null,status:error.status??null,at:new Date().toISOString()};persist();throw error;}
}
async function closeFailedRequest(){
  if(!pending){message('There is no unresolved browser request.');return;}
  const job=copy(pending);let operation=null;
  try{operation=await api('/api/requests/'+job.input.requestId);}
  catch(error){if(error.status!==404)throw error;}
  if(operation?.status==='COMPLETE'){await resume();return;}
  if(operation?.status==='RUNNING')throw Error('Resume this original native request to recover its outcome before closing it.');
  if(operation&&operation.status!=='INTERRUPTED')throw Error('This request has no reviewed failed outcome.');
  if(!operation&&!Number.isInteger(job.lastError?.status))throw Error('The response is still uncertain. Resume the original request before closing it.');
  closedRequests.push({job,operation,closedAt:new Date().toISOString()});closedRequests=closedRequests.slice(-25);
  if(pending?.input.requestId===job.input.requestId)pending=null;persist();await refresh();
  message('The failed request and its result remain recorded. Reopen the current saved edition before changing its inputs.');
}
async function refresh(){
  if(!token||refreshing)return;refreshing=true;
  try{const oldCount=state?.counts.resources;state=await api('/api/state');
    if(oldCount!==state.counts.resources)await loadResources(true);
    const selected=pending;
    if(selected){
      const original=await api('/api/requests/'+selected.input.requestId).catch(error=>{if(error.status===404)return null;throw error;});
      if(pending===selected&&original?.status==='COMPLETE')await applyResult(copy(selected),completedResult(selected,original));
    }
    renderState();}
  finally{refreshing=false;}
}
async function connect(){
  token=$('token').value.trim()||token;if(!token)throw Error('Enter the current access token from the workspace link.');
  const value=await api('/api/bootstrap');state=value;workspaceKey='pmtiles.browser.v1:'+location.origin+':'+value.id;
  const saved=localStorage.getItem(workspaceKey);
  if(saved){const prior=JSON.parse(saved);if(prior.workspaceId===value.id){
    pending=prior.pending??null;uploads=prior.uploads??[];inspection=prior.inspection??null;review=prior.review??null;closedRequests=prior.closedRequests??[];
    savedDraft=prior.savedDraft??null;applyDraft(prior.draft);$('reviewer').value=prior.reviewer??'';$('reviewNote').value=prior.reviewNote??'';
    $('exportDirectory').value=prior.exportDirectory??'';$('packageDirectory').value=prior.packageDirectory??'';$('packageDestination').value=prior.packageDestination??'';lastPackage=prior.lastPackage??null;
  }}
  else{savedDraft=null;pending=null;uploads=[];inspection=null;review=null;closedRequests=[];lastPackage=null;draft=currentDraft();}
  $('connection').hidden=true;$('workspace').hidden=false;sessionStorage.setItem('pmtiles.token:'+location.origin,token);
  await loadResources(true);renderState();renderPackage();persist();message('Connected to the saved workspace.');
  if(pending)await resume().catch(error=>message('Retained request: '+error.message,true));
}
async function readStyle(){
  const id=$('styleResource').value;if(!id)throw Error('Select a retained style.');
  const response=await api('/api/resources/'+id+'/download',{raw:true}),value=await response.json();
  if(value.version!==8||!value.sources)throw Error('The original file is not a MapLibre v8 style.');
  const prior=JSON.parse($('archives').value||'[]'),archives=resources.filter(row=>row.kind==='pmtiles');
  $('archives').value=JSON.stringify(Object.entries(value.sources).map(([sourceId,source])=>({
    sourceId,type:source.type,resourceId:prior.find(row=>row.sourceId===sourceId)?.resourceId??(archives.length===1?archives[0].id:'SELECT_RESOURCE_ID')
  })),null,2);persist();message('Loaded every original style source. Assign each source its retained archive ID.');
}
async function uploadFiles(event){
  event.preventDefault();const files=[...$('sourceFiles').files];if(!files.length)throw Error('Select original files.');
  for(const file of files){
    const fileIdentity={name:file.name,bytes:file.size,lastModified:file.lastModified};
    const rights={license:$('license').value,attribution:$('attribution').value,sourceUrl:$('sourceUrl').value};
    const kind=$('resourceKind').value,matches=uploads.filter(row=>eq(row.input.file,fileIdentity));
    if(matches.length>1)throw Error('More than one retained upload names this file. Finish the already received original bodies first.');
    let input;
    if(matches.length){
      input=copy(matches[0].input);
      if(input.kind!==kind||!eq(input.rights,rights))throw Error('This file has a retained transfer with different source details. Use Finish received uploads to restore those exact details before resuming.');
    }else{
      input={requestId:uuid('browser-upload'),expectedWorkspaceId:state.id,name:file.name,kind,rights,file:fileIdentity};
      uploads.push({id:input.requestId,input});persist();
    }
    message('Receiving '+file.name+' using original transfer '+input.requestId+'…');
    await api('/api/uploads',{method:'POST',body:input});
    const saved=await api('/api/uploads/'+input.requestId);
    if(!saved.body)await api('/api/uploads/'+input.requestId,{method:'PUT',binary:file});
    await api('/api/uploads/'+input.requestId+'/finish',{method:'POST',body:{expectedWorkspaceId:state.id}});
    uploads=uploads.filter(row=>row.id!==input.requestId);persist();
  }
  $('sourceFiles').value='';await refresh();message('Original files received and registered.');
}
async function finishUploads(){
  for(const upload of [...uploads]){
    let current;try{current=await api('/api/uploads/'+upload.id);}
    catch(error){if(error.status!==404)throw error;await api('/api/uploads',{method:'POST',body:upload.input});current=await api('/api/uploads/'+upload.id);}
    if(!current.body){
      $('resourceKind').value=upload.input.kind;
      for(const name of ['license','attribution','sourceUrl'])$(name).value=upload.input.rights[name];
      message('Reselect the original '+upload.input.file.name+' ('+upload.input.file.bytes+' bytes) to resume transfer '+upload.id+'. Its exact source details are restored.',true);return;
    }
    await api('/api/uploads/'+upload.id+'/finish',{method:'POST',body:{expectedWorkspaceId:state.id}});
    uploads=uploads.filter(row=>row.id!==upload.id);persist();
  }
  await refresh();message('All retained complete uploads are registered.');
}
async function updateMap(){
  const view=state.preview;
  if(!view?.alive){
    mapGeneration++;mapAbort?.abort();mapAbort=null;mapOpeningPath=null;if(map)map.dispose();map=null;mapPath=null;
    $('mapStatus').textContent='The native preview is stopped.';return;
  }
  if((mapPath===view.path&&map)||mapOpeningPath===view.path)return;
  const generation=++mapGeneration;mapAbort?.abort();mapAbort=new AbortController();const signal=mapAbort.signal;mapOpeningPath=view.path;
  const current=()=>generation===mapGeneration&&state.preview?.alive&&state.preview.path===view.path;
  try{
    const module=await import('/runtime/preview.js');if(!current())return;
    const response=await fetch(view.path.replace(/style\.json$/,'manifest.json'),{cache:'no-store'});
    if(!response.ok)throw Error('The preview selection changed. Refresh its native session.');
    const manifest=await response.json();if(!current())return;
    if(map)map.dispose();map=null;mapPath=null;
    const opened=await module.createNativeMap($('map'),{
      signal,style:new URL(view.path,location.origin).href,workerUrl:new URL('/runtime/maplibre-gl-worker.mjs',location.origin).href,
      onError:error=>{if(current())$('mapStatus').textContent=String(error.message??error);}
    });
    if(!current()){opened.dispose();return;}
    map=opened;mapPath=view.path;
    $('mapStatus').textContent='Native session '+view.session+' · '+view.releaseId;$('rights').replaceChildren();
    for(const rights of manifest.rights){
      const line=document.createElement('div');line.textContent=rights.attribution+' · '+rights.license+' ';
      const link=document.createElement('a');link.href=rights.sourceUrl;link.target='_blank';link.rel='noreferrer noopener';link.textContent='Original source';line.append(link);$('rights').append(line);
    }
    $('layerControls').replaceChildren();
    for(const layer of manifest.layers){
      const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.checked=layer.visible;
      check.onchange=()=>{
        const values=JSON.parse($('decisions').value||'[]'),index=values.findIndex(row=>row.layerId===layer.id);
        const value={layerId:layer.id,visible:check.checked,note:index>=0?values[index].note??'':''};
        if(index>=0)values[index]=value;else values.push(value);
        $('decisions').value=JSON.stringify(values,null,2);persist();message('Layer choice saved in this draft. Save and inspect a new edition to release it.');
      };
      label.append(check,document.createTextNode(layer.id));$('layerControls').append(label);
    }
  }finally{if(generation===mapGeneration)mapOpeningPath=null;}
}
function renderPackage(){
  $('downloadPackage').disabled=!lastPackage;
  $('packageResult').textContent=lastPackage?lastPackage.packageId+' · '+lastPackage.bytes.toLocaleString()+' bytes · '+lastPackage.sourceFiles+' source files · complete saved workspace and selected runtime.':'';
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function bind(id,work){$(id).addEventListener('click',()=>Promise.resolve().then(work).catch(error=>message(error.message,true)));}
for(const id of Object.values(fields))$(id).addEventListener('input',persist);
for(const id of ['reviewer','reviewNote','exportDirectory','packageDirectory','packageDestination'])$(id).addEventListener('input',persist);
bind('connect',connect);bind('refresh',refresh);bind('moreResources',()=>loadResources());bind('readStyle',readStyle);bind('resumeRequest',resume);bind('closeFailedRequest',closeFailedRequest);bind('resumeUploads',finishUploads);
$('uploadForm').addEventListener('submit',event=>uploadFiles(event).catch(error=>message(error.message,true)));
bind('saveEdition',()=>{const d=currentDraft();return dispatch('save-edition',{editionId:d.editionId,expectedVersion:d.expectedVersion,edition:editionInput()});});
bind('inspectEdition',()=>{const d=unchangedSaved();return dispatch('inspect',{editionId:d.editionId,version:d.expectedVersion});});
bind('recordReview',()=>{const d=unchangedSaved();if(!inspection)throw Error('Inspect the saved edition first.');
  return dispatch('review',{editionId:d.editionId,version:d.expectedVersion,inspectionRequestId:inspection.requestId,
    expectedCurrentRelease:state.currentRelease,reviewer:$('reviewer').value,note:$('reviewNote').value});});
bind('prepareRelease',()=>{if(!review)throw Error('Record the review first.');return dispatch('prepare-release',{reviewId:review.id,reviewSha256:review.reviewSha256});});
bind('openPreview',()=>dispatch('preview',{releaseId:$('release').value}));bind('stopPreview',()=>dispatch('stop-preview',{}));
bind('publish',async()=>{const release=await api('/api/releases/'+$('release').value);return dispatch('publish',{releaseId:release.id,manifestSha256:release.manifestSha256,expectedCurrentRelease:state.currentRelease});});
bind('restore',async()=>{if(!state.currentRelease)throw Error('There is no published release to restore.');const current=await api('/api/releases/'+state.currentRelease);
  return dispatch('restore',{fromReleaseId:current.id,manifestSha256:current.manifestSha256});});
bind('captureView',()=>{if(!map)throw Error('Open the native map first.');$('view').value=JSON.stringify(map.view(),null,2);persist();});
bind('exportWorkspace',()=>dispatch('export',{destination:$('exportDirectory').value}));
bind('packageWorkspace',()=>dispatch('package',{stagingDirectory:$('packageDirectory').value,destination:$('packageDestination').value}));
bind('downloadPackage',async()=>{
  if(!lastPackage)throw Error('Build the complete portable package first.');
  const response=await api('/api/package-download',{method:'POST',body:lastPackage,raw:true});
  downloadBlob(await response.blob(),lastPackage.packageId+'.zip');
});
bind('downloadDraft',()=>downloadBlob(new Blob([JSON.stringify({draft:currentDraft(),edition:editionInput()},null,2)+'\n'],{type:'application/json'}),currentDraft().editionId+'.json'));
const initial=new URLSearchParams(location.hash.slice(1)).get('token');if(initial){token=initial;history.replaceState(null,'',location.pathname+location.search);}
else token=sessionStorage.getItem('pmtiles.token:'+location.origin)||'';
if(token){$('token').value=token;connect().catch(error=>message(error.message,true));}
setInterval(()=>{if(state&&!document.hidden)refresh().catch(error=>message(error.message,true));},5000);
