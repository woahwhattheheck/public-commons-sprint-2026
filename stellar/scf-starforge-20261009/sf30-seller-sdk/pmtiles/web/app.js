import {createPMTilesCommerceUI} from './commerce.mjs';
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
    reviewer:$('reviewer').value,reviewNote:$('reviewNote').value,exportDirectory:$('exportDirectory').value,packageDirectory:$('packageDirectory').value,packageDestination:$('packageDestination').value,lastPackage,mapChoices:retainedMapChoices,
    comparisonInputs:{id:$('compareEditionId').value,version:$('compareEditionVersion').value},selectedRelease:$('release').value||preferredReleaseId}));}
  catch(error){message('Browser storage could not retain these edits. Download the edition draft before closing this tab. '+error.message,true);}
  $('draftStatus').textContent=savedDraft&&eq(draft,savedDraft)?'Saved version '+draft.expectedVersion:'Unsaved edits';
  $('pending').textContent=pending?'Retained request '+pending.input.requestId+' · '+pending.action:'';
  renderDraftChanges();
}
async function api(path,{method='GET',body,binary,raw=false,signal}={}){
  const headers={Authorization:'Bearer '+token};
  if(body!==undefined)headers['Content-Type']='application/json';
  if(binary!==undefined)headers['Content-Type']='application/octet-stream';
  const response=await fetch(path,{method,headers,body:binary!==undefined?binary:body===undefined?undefined:JSON.stringify(body),cache:'no-store',signal});
  if(response.status===401){$('connection').hidden=false;throw Error('Reconnect using the current workspace access token. Your saved draft is retained.');}
  if(!response.ok){let value;try{value=await response.json();}catch{}throw Object.assign(new Error(value?.error?.message??'HTTP '+response.status),{code:value?.error?.code,status:response.status});}
  return raw?response:response.json();
}
const commerceUI=createPMTilesCommerceUI({api,onWorkspaceChange:refresh});
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
function retainEditionDraft(){
  persist();if(!draft||eq(draft,savedDraft))return;
  const bytes=JSON.stringify(draft);localStorage.setItem(workspaceKey+':draft:'+draft.editionId,bytes);
  localStorage.setItem(workspaceKey+':draft:'+encodeURIComponent(draft.editionId)+':version:'+draft.expectedVersion,bytes);
}
async function loadEdition(id,version){
  retainEditionDraft();
  const generation=++editionReadGeneration,selectedKey=workspaceKey;editionReadAbort?.abort();editionReadAbort=new AbortController();clearComparison();
  try{
    const value=await readEdition(id,version,{signal:editionReadAbort.signal});
    if(generation!==editionReadGeneration||workspaceKey!==selectedKey||!pageActive)return;
    retainEditionDraft();
    const recalled=localStorage.getItem(workspaceKey+':draft:'+encodeURIComponent(id)+':version:'+version)??localStorage.getItem(workspaceKey+':draft:'+id);savedDraft=fromEdition(value);
    if(recalled){const old=JSON.parse(recalled);if(old.expectedVersion===version){applyDraft(old);message('Reopened the retained draft for '+id+'.');}
      else{applyDraft(savedDraft);message('Opened saved version '+version+'. Its older local draft remains retained.');}}
    else applyDraft(savedDraft);
    $('openEditionId').value=id;$('openEditionVersion').value=String(version);
    setComparisonSelection(id,version>1?version-1:'');inspection=null;review=null;persist();renderReview();
  }catch(error){if(generation===editionReadGeneration&&workspaceKey===selectedKey&&pageActive)throw error;}
}
function renderState(){
  $('identity').textContent=state.title+' · '+state.id+' · revision '+state.revision;
  $('currentRelease').textContent=state.currentRelease?'Published release: '+state.currentRelease:'No published release selected.';
  $('editions').replaceChildren();for(const edition of state.editions)item($('editions'),edition.name,
    edition.id+' · version '+edition.version,[{label:'Open',run:()=>loadEdition(edition.id,edition.version)}]);
  const selected=$('release').value||preferredReleaseId;$('release').replaceChildren();option($('release'),'','Select a prepared release');
  for(const release of state.releases)option($('release'),release.id,release.editionId+' v'+release.editionVersion+' · '+release.id.slice(-8));
  if(selected){if(!state.releases.some(row=>row.id===selected))option($('release'),selected,selected);$('release').value=selected;}
  else if(state.currentRelease){if(!state.releases.some(row=>row.id===state.currentRelease))option($('release'),state.currentRelease,state.currentRelease);$('release').value=state.currentRelease;}
  $('operations').replaceChildren();
  for(const row of state.operations){
    const recoveryKey=workspaceKey+':saved-draft:'+row.id;
    const actions=[{label:'Open result',run:async()=>{const result=await api('/api/requests/'+row.id);showJson($('inspection'),result);}}];
    if(localStorage.getItem(recoveryKey)!==null)actions.push({label:'Download saved draft',run:()=>{
      const retained=JSON.parse(localStorage.getItem(recoveryKey));
      if(retained?.workspaceId!==state.id||retained.requestId!==row.id)throw Error('The retained draft belongs to a different request.');
      downloadBlob(new Blob([JSON.stringify(retained,null,2)+'\n'],{type:'application/json'}),row.id+'-saved-draft.json');
    }});
    item($('operations'),row.kind+' · '+row.status,row.id+(row.error?' · '+row.error.message:''),actions);
  }
  renderReview();renderDraftChanges();updateReleaseDetails().catch(error=>message(error.message,true));updateMap().catch(error=>message(error.message,true));
}
function renderReview(){
  if(inspection){const r=inspection.result;$('inspection').replaceChildren();
    item($('inspection'),'Original archive inspection complete',
      'Edition '+r.editionId+' v'+r.version+' · '+r.inspections.length+' archive(s) · request '+inspection.requestId);
    for(const row of r.inspections)item($('inspection'),row.nativeVersion,
      row.bytes.toLocaleString()+' bytes · zoom '+row.header.minZoom+'–'+row.header.maxZoom+' · SHA256 '+row.resourceSha256);
  }
  $('reviewStatus').textContent=review?'Saved review '+review.id+' · '+review.reviewer+' · '+review.edition.id+' v'+review.edition.version:'Record a review after inspecting the saved edition.';
  showReviewDetails($('reviewDetails'),review);
}
function showJson(container,value){container.replaceChildren();const pre=document.createElement('pre');pre.textContent=JSON.stringify(value,null,2);container.append(pre);}
function editionInput(){
  const d=currentDraft();return {schema:'starforge.pmtiles-edition.v1',name:d.name,notes:d.notes,style:d.style,
    archives:JSON.parse(d.archivesText),sprite:JSON.parse(d.spriteText),glyphs:JSON.parse(d.glyphsText),
    layerDecisions:JSON.parse(d.decisionsText),view:JSON.parse(d.viewText)};
}
function unchangedSaved(){const d=currentDraft();if(!savedDraft||!eq(d,savedDraft))throw Error('Save the current edition before inspecting or reviewing it.');return d;}
function editionDraftKey(id,version){return workspaceKey+':draft:'+encodeURIComponent(id)+':version:'+version;}
function readRetainedDraft(key,id,version){
  const bytes=localStorage.getItem(key);if(bytes===null)return null;
  const value=JSON.parse(bytes);
  if(value?.editionId!==id||!Number.isSafeInteger(value.expectedVersion))throw Error('The retained edition draft has a different identity.');
  if(version!==undefined&&value.expectedVersion!==version)throw Error('The retained edition draft has a different version.');
  for(const key of Object.keys(fields))if(key!=='expectedVersion'&&typeof value[key]!=='string')throw Error('The retained edition draft is incomplete.');
  return value;
}
function acknowledgeEditionDraft(job,result){
  const id=job.input.editionId,previous=job.input.expectedVersion;
  if(result.id!==id||result.version!==previous+1||job.draft?.editionId!==id||job.draft.expectedVersion!==previous)
    throw Error('The saved edition result differs from the retained request.');
  const current=currentDraft(),selected=current.editionId===id&&current.expectedVersion===previous;
  const legacyKey=workspaceKey+':draft:'+id,oldKey=editionDraftKey(id,previous),newKey=editionDraftKey(id,result.version);
  const legacy=readRetainedDraft(legacyKey,id),historical=readRetainedDraft(oldKey,id,previous),existing=readRetainedDraft(newKey,id,result.version);
  const original=selected?current:legacy?.expectedVersion===previous?legacy:historical??job.draft;
  const acknowledged=fromEdition(result),promoted=eq(original,job.draft)?acknowledged:{...copy(original),expectedVersion:result.version};
  // Keep both versions before clearing the request; a later acknowledgement reuses this same native result.
  const recoveryKey=workspaceKey+':saved-draft:'+job.input.requestId,priorBytes=localStorage.getItem(recoveryKey);
  const prior=priorBytes===null?null:JSON.parse(priorBytes);
  if(prior&&(prior.requestId!==job.input.requestId||prior.editionId!==id||prior.previousVersion!==previous||
    prior.version!==result.version||!eq(prior.saved,acknowledged)||!eq(prior.submitted,job.draft)))
    throw Error('The retained saved-draft acknowledgment has a different request.');
  localStorage.setItem(oldKey,JSON.stringify(original));
  const retained=prior?.retainedDrafts??[];
  for(const value of [existing,legacy?.expectedVersion>=result.version?legacy:null,prior?.draft])
    if(value&&!eq(value,promoted)&&!retained.some(old=>eq(old,value)))retained.push(copy(value));
  localStorage.setItem(recoveryKey,JSON.stringify({schema:'pmtiles.saved-draft.v1',workspaceId:state.id,
    requestId:job.input.requestId,editionId:id,previousVersion:previous,version:result.version,
    submitted:job.draft,saved:acknowledged,draft:promoted,retainedDrafts:retained}));
  // A distinct acknowledged or newer draft remains selected in its existing storage slot.
  const acknowledgedExisting=existing??(legacy?.expectedVersion===result.version?legacy:null);
  const selectedDraft=acknowledgedExisting&&!eq(acknowledgedExisting,acknowledged)&&!eq(acknowledgedExisting,promoted)?acknowledgedExisting:promoted;
  if(!existing||eq(existing,acknowledged)||eq(existing,promoted))localStorage.setItem(newKey,JSON.stringify(selectedDraft));
  if(!legacy||legacy.expectedVersion===previous||eq(legacy,acknowledged)||eq(legacy,selectedDraft))
    localStorage.setItem(legacyKey,JSON.stringify(selectedDraft));
  if(selected){savedDraft=acknowledged;applyDraft(promoted);inspection=null;review=null;}
}
async function applyResult(job,result){
  if(job.action==='save-edition')acknowledgeEditionDraft(job,result);
  if(job.action==='inspect')inspection={requestId:job.input.requestId,result};
  if(job.action==='review')review=result;
  if(job.action==='prepare-release'){preferredReleaseId=result.id;$('release').value=result.id;state.releases.unshift(result);renderState();$('release').value=result.id;}
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
    renderState();commerceUI.observe(state);}
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
    retainedMapChoices=Array.isArray(prior.mapChoices)?prior.mapChoices:[];preferredReleaseId=prior.selectedRelease??'';
    setComparisonSelection(prior.comparisonInputs?.id??'',prior.comparisonInputs?.version??'');
  }}
  else{savedDraft=null;pending=null;uploads=[];inspection=null;review=null;closedRequests=[];lastPackage=null;retainedMapChoices=[];preferredReleaseId='';setComparisonSelection('','');draft=currentDraft();}
  $('connection').hidden=true;$('workspace').hidden=false;sessionStorage.setItem('pmtiles.token:'+location.origin,token);
  await loadResources(true);renderState();renderPackage();persist();message('Connected to the saved workspace.');
  if(pending)await resume().catch(error=>message('Retained request: '+error.message,true));
  await commerceUI.connect(state).catch(error=>commerceUI.report(error));
}
async function readStyle(){
  const id=$('styleResource').value,selectedKey=workspaceKey,selectedEdition=$('editionId').value;if(!id)throw Error('Select a retained style.');
  const response=await api('/api/resources/'+id+'/download',{raw:true}),value=await response.json();
  if(workspaceKey!==selectedKey||$('styleResource').value!==id||$('editionId').value!==selectedEdition)return;
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

const editionFields=['name','notes','style','archives','sprite','glyphs','layerDecisions','view'];
const fieldLabels={name:'Name',notes:'Release notes',style:'Original style',archives:'Archive bindings',sprite:'Sprite assets',glyphs:'Glyph inventory',layerDecisions:'Layer choices',view:'Saved map view'};
let pageActive=true,editionReadGeneration=0,editionReadAbort=null,comparisonGeneration=0,comparisonAbort=null,comparisonRecord=null;
let releaseReadGeneration=0,releaseReadAbort=null,releaseDetail=null,releaseDetailLoading=null,preferredReleaseId='';
let previewManifest=null,previewLayers=[],previewSources=[],previewFeature=null,mapLayerNodes=new Map(),previewChoices=new Map(),retainedMapChoices=[],restoreChoicesPending=false;
function definition(container,rows){
  const list=document.createElement('dl');list.className='definition';
  for(const [name,value] of rows){const term=document.createElement('dt'),detail=document.createElement('dd');term.textContent=name;detail.textContent=value==null?'—':typeof value==='string'?value:JSON.stringify(value);list.append(term,detail);}
  container.append(list);return list;
}
function detailJson(container,label,value,{open=false}={}){
  const details=document.createElement('details'),summary=document.createElement('summary'),pre=document.createElement('pre');
  details.open=open;summary.textContent=label;pre.textContent=JSON.stringify(value,null,2);details.append(summary,pre);container.append(details);return details;
}
function draftEdition(value){
  return {schema:'starforge.pmtiles-edition.v1',name:value.name,notes:value.notes,style:value.style,
    archives:JSON.parse(value.archivesText),sprite:JSON.parse(value.spriteText),glyphs:JSON.parse(value.glyphsText),
    layerDecisions:JSON.parse(value.decisionsText),view:JSON.parse(value.viewText)};
}
function renderDraftChanges(){
  const node=$('draftChanges');if(!savedDraft){node.textContent='Save this complete edition to begin its native inspection and review.';return;}
  try{
    const before=draftEdition(savedDraft),after=editionInput(),changed=editionFields.filter(key=>!eq(before[key],after[key]));
    node.textContent=changed.length?'Draft changes: '+changed.map(key=>fieldLabels[key]).join(', ')+'.':'The draft matches saved version '+savedDraft.expectedVersion+'.';
  }catch{node.textContent='The draft contains incomplete JSON. Complete its bindings before saving or comparing it.';}
  if(comparisonRecord){
    const current=currentDraft(),selected=comparisonRecord.after;
    $('comparisonStatus').textContent='Compared saved '+comparisonRecord.before.id+' v'+comparisonRecord.before.version+' → '+selected.id+' v'+selected.version+
      (current.editionId===selected.id&&current.expectedVersion===selected.version?'':'. The editor now selects another edition.')+
      ' · '+comparisonRecord.changedFields.length+' changed fields.';
  }
}
function setComparisonSelection(id,version){$('compareEditionId').value=id??'';$('compareEditionVersion').value=version??'';}
async function readEdition(id,version,{signal}={}){
  if(!id||!Number.isSafeInteger(version)||version<1)throw Error('Choose an exact saved edition ID and version.');
  const value=await api('/api/editions/'+encodeURIComponent(id)+'/'+version,{signal});
  if(value.id!==id||value.version!==version||value.schema!=='starforge.pmtiles-edition.v1')throw Error('The saved edition identity changed.');
  return value;
}
function renderComparison(container,left,right){
  container.replaceChildren();const changed=editionFields.filter(key=>!eq(left[key],right[key]));
  definition(container,[['Before',left.id+' · version '+left.version],['Before source',left.sourceDigest],['After',right.id+' · version '+right.version],['After source',right.sourceDigest]]);
  for(const key of editionFields){
    const block=document.createElement('details');block.className='diffField';block.open=changed.includes(key);
    const summary=document.createElement('summary');summary.textContent=fieldLabels[key]+' · '+(changed.includes(key)?'Changed':'Same');block.append(summary);
    const columns=document.createElement('div');columns.className='diffColumns';
    for(const [label,value] of [['Before',left[key]],['After',right[key]]]){const side=document.createElement('div'),heading=document.createElement('strong'),pre=document.createElement('pre');
      heading.textContent=label;pre.textContent=typeof value==='string'?value:JSON.stringify(value,null,2);side.append(heading,pre);columns.append(side);}
    block.append(columns);container.append(block);
  }
  return changed;
}
async function compareSaved({published=false}={}){
  const current=unchangedSaved(),selectedWorkspace=state.id,selectedKey=workspaceKey,generation=++comparisonGeneration;
  comparisonAbort?.abort();comparisonAbort=new AbortController();const signal=comparisonAbort.signal;
  comparisonRecord=null;$('editionComparison').replaceChildren();$('downloadComparison').disabled=true;$('comparisonStatus').textContent='Reading the exact saved editions…';
  const stillCurrent=()=>pageActive&&generation===comparisonGeneration&&workspaceKey===selectedKey&&state?.id===selectedWorkspace&&
    currentDraft().editionId===current.editionId&&currentDraft().expectedVersion===current.expectedVersion;
  try{
    let previousId=$('compareEditionId').value.trim(),previousVersion=Number($('compareEditionVersion').value),publishedId=null;
    if(published){publishedId=state.currentRelease;if(!publishedId)throw Error('There is no published release to compare.');
      const release=await api('/api/releases/'+encodeURIComponent(publishedId),{signal});
      if(release.id!==publishedId)throw Error('The published release identity changed.');
      previousId=release.editionId;previousVersion=release.editionVersion;
    }
    const [left,right]=await Promise.all([readEdition(previousId,previousVersion,{signal}),readEdition(current.editionId,current.expectedVersion,{signal})]);
    if(!stillCurrent())return;
    if(published&&state.currentRelease!==publishedId)throw Error('The published release changed while reading it. Compare the current selection again.');
    const changedFields=renderComparison($('editionComparison'),left,right);
    comparisonRecord={schema:'starforge.pmtiles-edition-comparison.v1',workspaceId:selectedWorkspace,
      before:left,after:right,changedFields,publishedReleaseId:publishedId,readAt:new Date().toISOString()};
    setComparisonSelection(previousId,previousVersion);$('comparisonPanel').open=true;$('downloadComparison').disabled=false;persist();renderDraftChanges();
  }catch(error){if(stillCurrent()){$('comparisonStatus').textContent=error.message;throw error;}}
}
function clearComparison(){
  comparisonGeneration++;comparisonAbort?.abort();comparisonAbort=null;comparisonRecord=null;
  $('editionComparison').replaceChildren();$('comparisonStatus').textContent='';$('downloadComparison').disabled=true;
}
function showReviewDetails(container,value){
  container.replaceChildren();if(!value)return;
  const box=document.createElement('div');box.className='reviewMeta';
  definition(box,[['Review',value.id],['Reviewer',value.reviewer],['Recorded',value.createdAt],['Inspection request',value.inspectionRequestId],['Review SHA-256',value.reviewSha256],['Prior release',value.previousReleaseId??'First release']]);
  if(value.note){const note=document.createElement('p');note.textContent=value.note;box.append(note);}
  container.append(box);
}
async function updateReleaseDetails(){
  const id=$('release').value;
  if(!id){releaseReadGeneration++;releaseReadAbort?.abort();releaseDetail=null;releaseDetailLoading=null;$('releaseDetails').replaceChildren();return;}
  if(releaseDetail?.release.id===id&&releaseDetail.workspaceId===state.id){renderReleaseDetails();return;}
  if(releaseDetailLoading===id)return;
  const generation=++releaseReadGeneration,selectedWorkspace=state.id;releaseReadAbort?.abort();releaseReadAbort=new AbortController();const signal=releaseReadAbort.signal;
  releaseDetail=null;releaseDetailLoading=id;$('releaseDetails').replaceChildren();$('releaseDetails').textContent='Reading selected release…';
  const current=()=>pageActive&&generation===releaseReadGeneration&&state?.id===selectedWorkspace&&$('release').value===id;
  try{
    const release=await api('/api/releases/'+encodeURIComponent(id),{signal});
    if(release.id!==id||release.workspaceId!==selectedWorkspace)throw Error('The selected release belongs to another workspace.');
    const edition=await readEdition(release.editionId,release.editionVersion,{signal});let previous=null;
    if(release.previousReleaseId){const prior=await api('/api/releases/'+encodeURIComponent(release.previousReleaseId),{signal});
      if(prior.id!==release.previousReleaseId||prior.workspaceId!==selectedWorkspace)throw Error('The original preceding release changed.');
      previous={release:prior,edition:await readEdition(prior.editionId,prior.editionVersion,{signal})};
    }
    if(!current())return;releaseDetail={workspaceId:selectedWorkspace,release,edition,previous};renderReleaseDetails();
  }catch(error){if(current()){$('releaseDetails').textContent=error.message;throw error;}}
  finally{if(generation===releaseReadGeneration)releaseDetailLoading=null;}
}
function renderReleaseDetails(){
  if(!releaseDetail||releaseDetail.release.id!==$('release').value)return;
  const {release,edition,previous}=releaseDetail,container=$('releaseDetails');container.replaceChildren();
  definition(container,[['Selected release',release.id],['Edition',edition.id+' · version '+edition.version],['Created',release.createdAt],
    ['Manifest SHA-256',release.manifestSha256],['Edition source',edition.sourceDigest],['Review SHA-256',release.reviewSha256],
    ['Selected runtime',release.runtimeSha256],['Retained files',release.files.length+' · '+release.files.reduce((sum,row)=>sum+row.bytes,0).toLocaleString()+' bytes'],
    ['Preceding release',release.previousReleaseId??'First release']]);
  const selectedReview=previewManifest?.release.id===release.id?previewManifest.review:review?.reviewSha256===release.reviewSha256?review:null;
  if(selectedReview){const reviewBox=document.createElement('div');showReviewDetails(reviewBox,selectedReview);container.append(reviewBox);}
  const actions=document.createElement('div');actions.className='row';const open=document.createElement('button');open.type='button';open.textContent='Open exact edition';
  open.onclick=()=>loadEdition(edition.id,edition.version).catch(error=>message(error.message,true));actions.append(open);
  const download=document.createElement('button');download.type='button';download.textContent='Download release selection';download.onclick=()=>downloadBlob(
    new Blob([JSON.stringify({schema:'starforge.pmtiles-release-selection.v1',workspaceId:state.id,release,edition,previous,review:selectedReview},null,2)+'\n'],{type:'application/json'}),release.id+'-selection.json');
  actions.append(download);container.append(actions);
  if(previous){const details=document.createElement('details'),summary=document.createElement('summary'),body=document.createElement('div');
    summary.textContent='Changes from the preceding published release';details.append(summary,body);renderComparison(body,previous.edition,edition);container.append(details);
  }else detailJson(container,'Complete first release edition',edition);
}
function currentPreview(generation,view){return pageActive&&generation===mapGeneration&&state?.preview?.alive&&state.preview.path===view.path&&state.preview.releaseId===view.releaseId;}
function mapButtons(enabled){
  for(const id of ['captureView','restoreMapView','openPreviewEdition','downloadObservation','applyLayerChoices','resetLayerChoices'])$(id).disabled=!enabled;
  $('applyLayerChoices').disabled=!enabled||!previewLayers.length;$('resetLayerChoices').disabled=!enabled||!previewLayers.length;
  $('fitMap').disabled=!enabled||!previewManifest?.bounds;$('retryMap').disabled=!state?.preview?.alive;
}
function clearMapDetails(){
  previewManifest=null;previewLayers=[];previewSources=[];previewFeature=null;mapLayerNodes=new Map();previewChoices=new Map();restoreChoicesPending=false;
  for(const id of ['rights','mapLocation','mapSelection','mapErrors','layerControls','mapSources','featureLocation','featureDetails','layerChoiceStatus'])$(id).replaceChildren();
  $('layerCount').textContent='';$('sourceCount').textContent='';$('featureCount').textContent='';
  $('featureSelect').replaceChildren();option($('featureSelect'),'','Select a point on the map');$('featureSelect').disabled=true;
  $('mapStatus').dataset.state='closed';delete $('mapStatus').dataset.releaseId;mapButtons(false);
}
function clearMap(){
  mapGeneration++;mapAbort?.abort();mapAbort=null;mapOpeningPath=null;
  const previous=map;map=null;mapPath=null;previous?.dispose();clearMapDetails();
}
function archiveBounds(sources){
  const bounds=sources.map(row=>row.header).filter(h=>h&&[h.minLon,h.minLat,h.maxLon,h.maxLat].every(Number.isFinite))
    .map(h=>[h.minLon,h.minLat,h.maxLon,h.maxLat]);
  if(!bounds.length)return null;
  let south=Math.min(...bounds.map(b=>b[1])),north=Math.max(...bounds.map(b=>b[3]));
  if(bounds.some(b=>b[2]-b[0]>=360-1e-9))return [-180,south,180,north];
  const intervals=[];
  for(const [west,,east] of bounds){if(east<west){intervals.push([west+180,360],[0,east+180]);}else intervals.push([west+180,east+180]);}
  intervals.sort((a,b)=>a[0]-b[0]);const merged=[];
  for(const range of intervals){const prior=merged.at(-1);if(prior&&range[0]<=prior[1])prior[1]=Math.max(prior[1],range[1]);else merged.push([...range]);}
  let best={gap:-1,start:0,end:360};
  for(let i=0;i<merged.length;i++){const next=merged[(i+1)%merged.length],end=merged[i][1],nextStart=next[0]+(i===merged.length-1?360:0),gap=nextStart-end;
    if(gap>best.gap)best={gap,start:next[0],end};}
  if(best.gap<=1e-9)return [-180,south,180,north];
  return [best.start-180,south,best.end-180,north];
}
function renderMapStatus(value,view){
  const status=$('mapStatus'),errors=Number(value.errorCount??0),ready=value.stage==='ready'&&value.loaded&&value.idle&&errors===0;
  status.dataset.state=ready?'ready':value.stage==='error'||errors?'error':'loading';status.dataset.releaseId=view.releaseId;
  const label=ready?'Style and tiles ready':errors?errors+' map error'+(errors===1?'':'s'):value.stage==='loading-engine'?'Opening installed map engine':value.loaded?'Loading selected tiles':'Loading selected style';
  status.textContent=label+' · '+view.releaseId+' · native session '+view.session;
  $('mapErrors').replaceChildren();
  if(value.errors?.length){const details=document.createElement('details'),summary=document.createElement('summary');summary.textContent='Map errors · '+errors;
    details.append(summary);for(const error of value.errors){const row=document.createElement('div');row.className='errorRow';row.textContent=[error.time,error.sourceId,error.message,error.status?'HTTP '+error.status:''].filter(Boolean).join(' · ');details.append(row);}$('mapErrors').append(details);}
}
function renderMapLocation(value){
  $('mapLocation').textContent=value?'Longitude '+value.longitude.toFixed(6)+' · latitude '+value.latitude.toFixed(6)+' · native zoom '+value.zoom.toFixed(3):'';
}
function retainMapChoices(){
  if(!previewManifest)return;
  const value={releaseId:previewManifest.release.id,manifestSha256:previewManifest.release.manifestSha256,
    layers:[...previewChoices].map(([id,row])=>({id,visible:row.visible,note:row.note,noteEdited:row.noteEdited}))};
  const index=retainedMapChoices.findIndex(row=>row.releaseId===value.releaseId&&row.manifestSha256===value.manifestSha256);
  if(index<0)retainedMapChoices.push(value);else retainedMapChoices[index]=value;persist();
}
function mapChoiceStatus(){
  const original=new Map((previewManifest?.layers??[]).map(row=>[row.id,row])),notes=new Map((previewManifest?.edition.layerDecisions??[]).map(row=>[row.layerId,row.note??'']));
  let changed=0;for(const [id,value] of previewChoices)if(value.visible!==original.get(id)?.visible||value.note!==(notes.get(id)??''))changed++;
  $('layerChoiceStatus').textContent=changed?changed+' preview layer choice'+(changed===1?'':'s')+' differ from the released edition.':'The preview uses the released layer choices.';
}
function filterMapLayers(){
  const query=$('layerFilter').value.trim().toLowerCase();let shown=0;
  for(const {row} of mapLayerNodes.values()){row.hidden=!!query&&!row.dataset.search.includes(query);if(!row.hidden)shown++;}
  $('layerCount').textContent=shown+' of '+mapLayerNodes.size;
}
function renderMapLayers(rows,generation,view){
  previewLayers=copy(rows);const retained=new Set();
  for(const layer of rows){
    retained.add(layer.id);let choice=previewChoices.get(layer.id);
    if(!choice){const note=previewManifest.edition.layerDecisions?.find(row=>row.layerId===layer.id)?.note??'';choice={visible:layer.visible,note,noteEdited:false};previewChoices.set(layer.id,choice);}
    choice.visible=layer.visible;let nodes=mapLayerNodes.get(layer.id);
    if(!nodes){
      const row=document.createElement('div');row.className='layerRow';row.dataset.layerId=layer.id;
      const label=document.createElement('label');label.className='layerVisibility';const check=document.createElement('input');check.type='checkbox';check.dataset.layerId=layer.id;
      const title=document.createElement('span');title.textContent=layer.id;label.append(check,title);
      const meta=document.createElement('div');meta.className='meta';
      const noteLabel=document.createElement('label');noteLabel.className='layerNote';noteLabel.append(document.createTextNode('Decision note'));
      const note=document.createElement('input');note.type='text';note.maxLength=2000;note.value=choice.note;note.dataset.layerNote=layer.id;noteLabel.append(note);
      const filter=document.createElement('div');row.append(label,meta,noteLabel,filter);
      check.onchange=()=>{if(!currentPreview(generation,view)||!map)return;try{map.setLayerVisibility(layer.id,check.checked);previewChoices.get(layer.id).visible=check.checked;retainMapChoices();mapChoiceStatus();}catch(error){check.checked=previewChoices.get(layer.id).visible;message(error.message,true);}};
      note.oninput=()=>{if(!currentPreview(generation,view))return;const current=previewChoices.get(layer.id);current.note=note.value;current.noteEdited=true;retainMapChoices();mapChoiceStatus();};
      nodes={row,check,meta,note,filter};mapLayerNodes.set(layer.id,nodes);
    }
    nodes.row.dataset.search=[layer.id,layer.type,layer.source,layer.sourceLayer].filter(Boolean).join(' ').toLowerCase();
    nodes.check.checked=layer.visible;nodes.check.disabled=!map||!map.observation().state.loaded;
    nodes.meta.textContent=[layer.type,layer.source?'Source '+layer.source:'',layer.sourceLayer?'Layer '+layer.sourceLayer:'',
      layer.minZoom!=null||layer.maxZoom!=null?'Zoom '+(layer.minZoom??0)+'–'+(layer.maxZoom??24):''].filter(Boolean).join(' · ');
    if(document.activeElement!==nodes.note)nodes.note.value=choice.note;
    if(nodes.filter.dataset.json!==JSON.stringify(layer.filter)){nodes.filter.replaceChildren();if(layer.filter)detailJson(nodes.filter,'Original feature filter',layer.filter);nodes.filter.dataset.json=JSON.stringify(layer.filter);}
    $('layerControls').append(nodes.row);
  }
  for(const [id,nodes] of mapLayerNodes)if(!retained.has(id)){nodes.row.remove();mapLayerNodes.delete(id);}
  filterMapLayers();mapChoiceStatus();
}
function restoreRetainedMapChoices(){
  if(!restoreChoicesPending||!map||!map.observation().state.loaded||!previewLayers.length)return;restoreChoicesPending=false;
  const saved=retainedMapChoices.find(row=>row.releaseId===previewManifest.release.id&&row.manifestSha256===previewManifest.release.manifestSha256);
  if(!saved||!Array.isArray(saved.layers))return;
  for(const row of saved.layers){
    if(typeof row.id!=='string'||typeof row.visible!=='boolean'||typeof row.note!=='string'||row.note.length>2000||!mapLayerNodes.has(row.id))continue;
    const current=previewChoices.get(row.id);current.note=row.note;current.noteEdited=row.noteEdited===true;mapLayerNodes.get(row.id).note.value=row.note;
    if(current.visible!==row.visible){map.setLayerVisibility(row.id,row.visible);current.visible=row.visible;}
  }
  mapChoiceStatus();
}
function renderMapSources(rows){
  previewSources=copy(rows);$('mapSources').replaceChildren();$('sourceCount').textContent=rows.length+' sources';
  for(const source of rows){
    const original=previewManifest.sources.find(row=>row.sourceId===source.id),card=item($('mapSources'),source.id,
      source.type+' · '+(source.loaded===true?'Loaded':source.loaded===false?'Loading':'Awaiting source'));
    if(original){
      definition(card,[['Original resource',original.resourceId],['Bytes',original.bytes?.toLocaleString()],['SHA-256',original.sha256],
        ['Archive zoom',original.header?original.header.minZoom+'–'+original.header.maxZoom:null],
        ['Bounds',original.header?[original.header.minLon,original.header.minLat,original.header.maxLon,original.header.maxLat]:null]]);
      for(const layer of original.metadata?.vector_layers??[]){const details=detailJson(card,'Source layer '+layer.id,layer);details.dataset.sourceLayer=layer.id;}
      detailJson(card,'Original archive metadata',original.metadata);detailJson(card,'Original source binding',original.originalSource);
    }
    detailJson(card,'Current selected style source',source);
  }
}
function renderFeatureSelection(){
  const index=Number($('featureSelect').value);$('featureDetails').replaceChildren();
  if(!previewFeature||!Number.isSafeInteger(index)||index<0||index>=previewFeature.features.length)return;
  const feature=previewFeature.features[index];
  definition($('featureDetails'),[['Feature ID',feature.id],['Style layer',feature.layerId],['Layer type',feature.layerType],['Source',feature.source],['Source layer',feature.sourceLayer]]);
  const wrap=document.createElement('div');wrap.className='tableWrap';const table=document.createElement('table');table.className='dataTable';
  const head=document.createElement('thead'),headrow=document.createElement('tr');
  for(const label of ['Property','Original value']){const cell=document.createElement('th');cell.scope='col';cell.textContent=label;headrow.append(cell);}head.append(headrow);table.append(head);
  const body=document.createElement('tbody');
  for(const [key,value] of Object.entries(feature.properties??{})){const row=document.createElement('tr'),name=document.createElement('th'),cell=document.createElement('td');
    name.scope='row';name.textContent=key;cell.textContent=typeof value==='string'?value:JSON.stringify(value);row.append(name,cell);body.append(row);}
  table.append(body);wrap.append(table);$('featureDetails').append(wrap);detailJson($('featureDetails'),'Original feature geometry',feature.geometry);
}
function renderMapFeature(value){
  previewFeature=value?copy(value):null;$('featureSelect').replaceChildren();$('featureDetails').replaceChildren();
  if(!value){option($('featureSelect'),'','Select a point on the map');$('featureSelect').disabled=true;$('featureCount').textContent='';$('featureLocation').textContent='';return;}
  $('featureLocation').textContent='Longitude '+value.longitude.toFixed(6)+' · latitude '+value.latitude.toFixed(6);
  $('featureCount').textContent=value.features.length+' rendered features';
  if(!value.features.length){option($('featureSelect'),'','No vector feature at this point');$('featureSelect').disabled=true;
    $('featureDetails').textContent=previewSources.every(source=>source.type!=='vector')?'This release uses raster imagery. Source and archive details are available above.':'Select another point or enable the relevant style layer.';return;}
  value.features.forEach((feature,index)=>option($('featureSelect'),String(index),(index+1)+'. '+(feature.layerId??'Feature')+' · '+(feature.id??feature.sourceLayer??'unnamed')));
  $('featureSelect').disabled=false;$('featureSelect').value='0';renderFeatureSelection();
}
function requirePreviewDraft(){
  if(!previewManifest||!map)throw Error('Open the selected native preview first.');
  const current=currentDraft(),edition=previewManifest.edition;
  if(current.editionId!==edition.id||current.expectedVersion!==edition.version||current.style!==edition.style)
    throw Error('Open this preview’s exact edition before applying its layer choices to a draft.');
  return current;
}
function applyPreviewChoices(){
  requirePreviewDraft();const values=JSON.parse($('decisions').value||'[]');if(!Array.isArray(values))throw Error('Layer choices must be a JSON array.');
  for(const layer of previewLayers){const choice=previewChoices.get(layer.id),index=values.findIndex(row=>row.layerId===layer.id),prior=index<0?null:values[index];
    const value={layerId:layer.id,visible:choice.visible,note:choice.noteEdited?choice.note:prior?.note??choice.note};
    if(index<0)values.push(value);else values[index]=value;
  }
  $('decisions').value=JSON.stringify(values,null,2);persist();message('Applied the preview layer choices to this draft. Save and inspect the new edition to record its review.');
}
function resetPreviewChoices(){
  if(!map||!previewManifest)throw Error('Open the selected preview first.');
  for(const layer of previewManifest.layers){if(!previewChoices.has(layer.id))continue;
    const note=previewManifest.edition.layerDecisions?.find(row=>row.layerId===layer.id)?.note??'';
    previewChoices.set(layer.id,{visible:layer.visible,note,noteEdited:false});map.setLayerVisibility(layer.id,layer.visible);
    const nodes=mapLayerNodes.get(layer.id);if(nodes){nodes.check.checked=layer.visible;nodes.note.value=note;}
  }
  retainMapChoices();mapChoiceStatus();message('Restored the released layer choices in the preview.');
}
function downloadMapObservation(){
  if(!map||!previewManifest)throw Error('Open the native preview first.');
  const value={schema:'starforge.pmtiles-map-observation.v1',workspaceId:state.id,observedAt:new Date().toISOString(),
    release:previewManifest.release,edition:previewManifest.edition,review:previewManifest.review??null,
    originalSources:previewManifest.sources,rights:previewManifest.rights,glyphCoverage:previewManifest.glyphCoverage,
    previewChoices:[...previewChoices].map(([id,row])=>({id,...row})),native:map.observation()};
  downloadBlob(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}),previewManifest.release.id+'-map-inspection.json');
}

async function updateMap({force=false}={}){
  const view=state?.preview;
  if(!pageActive||!view?.alive){
    clearMap();$('mapStatus').textContent='The native preview is stopped.';return;
  }
  if(!force&&((mapPath===view.path&&map)||mapOpeningPath===view.path))return;
  clearMap();const generation=mapGeneration;mapAbort=new AbortController();const signal=mapAbort.signal;mapOpeningPath=view.path;
  const current=()=>currentPreview(generation,view);
  $('mapStatus').dataset.state='loading';$('mapStatus').dataset.releaseId=view.releaseId;
  $('mapStatus').textContent='Reading selected release · '+view.releaseId;mapButtons(false);
  try{
    const manifestUrl=new URL(view.path.replace(/style\.json$/,'manifest.json'),location.origin);
    if(manifestUrl.origin!==location.origin)throw Error('The preview must use its original workspace.');
    const [module,response]=await Promise.all([import('/runtime/preview.js'),fetch(manifestUrl,{cache:'no-store',signal})]);
    if(!response.ok)throw Error('The preview selection returned HTTP '+response.status+'. Refresh its original session.');
    const manifest=await response.json();if(!current())return;
    const release=manifest.release;
    if(!release||release.id!==view.releaseId||release.manifestSha256!==view.manifestSha256||release.workspaceId!==state.id)
      throw Error('The native preview manifest names a different selected release.');
    const edition=manifest.edition??await readEdition(release.editionId,release.editionVersion,{signal});if(!current())return;
    if(edition.id!==release.editionId||edition.version!==release.editionVersion)throw Error('The native preview edition changed.');
    if(manifest.review&&manifest.review.reviewSha256!==release.reviewSha256)throw Error('The native preview review changed.');
    const matchingInspection=inspection?.result?.editionId===edition.id&&inspection.result.version===edition.version?inspection.result:null;
    const sources=manifest.sources??matchingInspection?.prepared.sources??[];
    if(!Array.isArray(sources)||!Array.isArray(manifest.layers)||!Array.isArray(manifest.rights))throw Error('The selected preview inventory is incomplete.');
    if(sources.length&&(sources.length!==edition.archives.length||sources.some(source=>!edition.archives.some(binding=>binding.sourceId===source.sourceId&&binding.resourceId===source.resourceId))))
      throw Error('The inspected archives belong to a different selected edition.');
    previewManifest={...manifest,edition,sources,bounds:archiveBounds(sources)};
    restoreChoicesPending=retainedMapChoices.some(row=>row.releaseId===release.id&&row.manifestSha256===release.manifestSha256);
    $('mapSelection').textContent=edition.id+' · version '+edition.version+' · manifest '+release.manifestSha256;
    for(const rights of manifest.rights){
      const line=document.createElement('div');line.textContent=rights.attribution+' · '+rights.license+' ';
      const url=new URL(rights.sourceUrl);
      if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password){const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noreferrer noopener';link.textContent='Original source';line.append(link);}
      $('rights').append(line);
    }
    const opened=await module.createNativeMap($('map'),{
      signal,style:new URL(view.path,location.origin).href,workerUrl:new URL('/runtime/maplibre-gl-worker.mjs',location.origin).href,
      selection:{key:state.id+':'+view.releaseId+':'+view.session,editionId:edition.id,styleId:edition.style,
        styleSha256:matchingInspection?.prepared.originalStyleSha256??'',snapshot:release.manifestSha256,bounds:previewManifest.bounds,minZoom:0,maxZoom:24},
      onState:value=>{if(current()){renderMapStatus(value,view);mapButtons(!!map&&value.loaded);restoreRetainedMapChoices();}},
      onLayers:value=>{if(current()){renderMapLayers(value,generation,view);restoreRetainedMapChoices();}},
      onSources:value=>{if(current())renderMapSources(value);},
      onLocation:value=>{if(current())renderMapLocation(value);},
      onFeature:value=>{if(current())renderMapFeature(value);},
      onError:error=>{if(current()){$('mapStatus').dataset.state='error';$('mapStatus').textContent=String(error.message??error)+' · '+view.releaseId;}}
    });
    if(!current()){opened.dispose();return;}
    map=opened;mapPath=view.path;const actual=map.observation();
    renderMapStatus(actual.state,view);renderMapLayers(actual.layers,generation,view);renderMapSources(actual.sources);renderMapLocation(actual.location);
    mapButtons(actual.state.loaded);restoreRetainedMapChoices();renderReleaseDetails();
  }catch(error){
    if(current()){map?.dispose();map=null;mapPath=null;mapButtons(false);$('mapStatus').dataset.state='error';$('mapStatus').textContent=error.message+' · '+view.releaseId;throw error;}
  }finally{if(generation===mapGeneration)mapOpeningPath=null;}
}
function renderPackage(){
  $('downloadPackage').disabled=!lastPackage;
  $('packageResult').textContent=lastPackage?lastPackage.packageId+' · '+lastPackage.bytes.toLocaleString()+' bytes · '+lastPackage.sourceFiles+' source files · complete saved workspace and selected runtime.':'';
}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function bind(id,work){$(id).addEventListener('click',()=>Promise.resolve().then(work).catch(error=>message(error.message,true)));}
for(const id of Object.values(fields))$(id).addEventListener('input',persist);
for(const id of ['reviewer','reviewNote','exportDirectory','packageDirectory','packageDestination','compareEditionId','compareEditionVersion'])$(id).addEventListener('input',persist);
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
bind('openExactEdition',()=>loadEdition($('openEditionId').value.trim(),Number($('openEditionVersion').value)));
bind('compareEditions',()=>compareSaved());bind('comparePublished',()=>compareSaved({published:true}));
bind('downloadComparison',()=>{if(!comparisonRecord)throw Error('Compare the saved editions first.');
  downloadBlob(new Blob([JSON.stringify(comparisonRecord,null,2)+'\n'],{type:'application/json'}),comparisonRecord.after.id+'-v'+comparisonRecord.after.version+'-comparison.json');});
bind('fitMap',()=>{if(!map||!map.fit())throw Error('The selected preview has no complete retained archive bounds.');});
bind('restoreMapView',()=>{if(!map)throw Error('Open the selected native map first.');map.restoreView();});
bind('retryMap',()=>updateMap({force:true}));
bind('openPreviewEdition',()=>{if(!previewManifest)throw Error('Open the selected preview first.');return loadEdition(previewManifest.edition.id,previewManifest.edition.version);});
bind('applyLayerChoices',applyPreviewChoices);bind('resetLayerChoices',resetPreviewChoices);bind('downloadObservation',downloadMapObservation);
$('layerFilter').addEventListener('input',filterMapLayers);$('featureSelect').addEventListener('change',renderFeatureSelection);
$('release').addEventListener('change',()=>{preferredReleaseId=$('release').value;persist();updateReleaseDetails().catch(error=>message(error.message,true));});
mapButtons(false);

const initial=new URLSearchParams(location.hash.slice(1)).get('token');if(initial){token=initial;history.replaceState(null,'',location.pathname+location.search);}
else token=sessionStorage.getItem('pmtiles.token:'+location.origin)||'';
if(token){$('token').value=token;connect().catch(error=>message(error.message,true));}
let pollTimer=setInterval(()=>{if(state&&!document.hidden&&pageActive)refresh().catch(error=>message(error.message,true));},5000);
addEventListener('pagehide',()=>{
  persist();commerceUI.close();pageActive=false;clearInterval(pollTimer);pollTimer=null;editionReadGeneration++;editionReadAbort?.abort();
  comparisonGeneration++;comparisonAbort?.abort();releaseReadGeneration++;releaseReadAbort?.abort();releaseDetailLoading=null;clearMap();
});
addEventListener('pageshow',event=>{if(event.persisted){pageActive=true;if(!pollTimer)pollTimer=setInterval(()=>{if(state&&!document.hidden&&pageActive)refresh().catch(error=>message(error.message,true));},5000);
  if(state)refresh().catch(error=>message(error.message,true));}});

