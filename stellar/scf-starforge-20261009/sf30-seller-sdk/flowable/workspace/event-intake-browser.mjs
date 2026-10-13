// MIT. Event source editing and native review in the existing Flowable workspace.
export function installFlowableEventIntake({api,eventAPI,write,busy,button,node,pre,keyValues,notice,reload,openRecord,records,forEngine,requireEngine,workspaceId,casePortfolio}){
 const root=document.querySelector('[data-panel="events"]'),event=root.querySelector('#event-source'),profile=root.querySelector('#event-profile'),
 definition=root.querySelector('#event-definition'),previewBox=root.querySelector('#event-preview'),savedBox=root.querySelector('#event-saved'),
 examples=root.querySelector('#event-example'),status=root.querySelector('#event-status');
 let generation=0,preview=null,saved=null,capture=null,restoredWorkspace=null,loadedDefinitionsKey=null,lastConnection=null;
 const selection=()=>JSON.stringify({connectionId:requireEngine(),portfolioId:capture?.id,revision:capture?.revision,definitionId:definition.value,eventText:event.value,profileText:profile.value});
 const draftKey=()=> 'flowable-event-draft:'+workspaceId();
 function persist(){if(!workspaceId())return;try{sessionStorage.setItem(draftKey(),JSON.stringify({eventText:event.value,profileText:profile.value,definitionId:definition.value}));}catch{notice('The draft could not be retained in this tab. Download its original sources.','error');}}
 function edited(){generation++;preview=null;previewBox.replaceChildren(node('p','Preview the current complete source before saving.'));persist();}
 event.addEventListener('input',edited);profile.addEventListener('input',edited);definition.addEventListener('change',edited);
 function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=node('a',null,{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function sourceText(programme,name){const item=programme.programme.sources.find(s=>s.name===name);if(!item)throw Error('This programme has no original '+name);return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(item.contentBase64),x=>x.charCodeAt(0)));}
 async function openSaved(id){
  const epoch=++generation,p=await api('readProgramme',{id});if(epoch!==generation)return;
  if(!p.programme.sources.some(s=>s.name==='event.json')||!p.programme.sources.some(s=>s.name==='event-profile.json'))throw Error('Select a saved event programme.');
  event.value=sourceText(p,'event.json');profile.value=sourceText(p,'event-profile.json');saved=p;preview=null;persist();renderSaved();
  previewBox.replaceChildren(node('p','Original event and profile reopened. Native work stays bound to its saved definition and source.'));
 }
 function renderSaved(){
  savedBox.replaceChildren();
  const list=forEngine(records('programme')).filter(x=>String(x.label??'').startsWith('Metadata review:'));
  if(!saved)savedBox.append(node('p','Save the reviewed event source to begin the original case operation.'));
  else{
   const p=saved;savedBox.append(keyValues([['Saved programme',p.programmeKey],['Revision',p.record.revision],['Progress',p.progress.state]]));
   const toolbar=node('div',null,{class:'toolbar'});
   toolbar.append(button('Prepare and review original start',async()=>{
    // Reopening a saved programme is deliberate; edits belong to a new preview.
    if(event.value!==sourceText(p,'event.json')||profile.value!==sourceText(p,'event-profile.json'))throw Error('The editor differs from this saved programme. Reopen its originals or preview and save the changed event.');
    const command=await eventAPI('preparation',{programmeId:p.record.id});
    if(command.method!=='prepareProgrammeStep')throw Error('Unexpected event preparation action');
    const result=await write(command.method,command.args);
    await eventAPI('review',{programmeId:p.record.id,operationId:result.operation.id});
    await reload();await openRecord(result.operation.kind,result.operation.id);
    notice('Selected case XML and original event request reviewed. Continue in the original native operation.');
   }),button('Refresh saved event',()=>openSaved(p.record.id)),button('Download saved programme',()=>download(p.programmeKey+'.json',JSON.stringify(p.programme,null,2)+'\n')),
    button('Export complete workspace',async()=>{const r=await write('exportWorkspace',{label:p.label+' complete event handover'});await reload();await openRecord(r.kind,r.id);}));
   savedBox.append(toolbar);
  }
  const listBox=node('div');for(const r of list)listBox.append(button(r.label+' · '+r.state,()=>openSaved(r.id)));savedBox.append(listBox);
 }
 async function previewCurrent(){
  if(!capture||!definition.value)throw Error('Select the CMMN connection, refresh cases, and select a captured definition.');
  const frozen=selection(),epoch=++generation,result=await eventAPI('preview',JSON.parse(frozen));
  if(epoch!==generation||frozen!==selection())throw Error('The selected event source changed during preview; preview the current edition.');
  preview={value:result,input:frozen};previewBox.replaceChildren(keyValues([['Event SHA-256',result.eventSha256],['Mapping SHA-256',result.profileSha256],
   ['Case definition',result.definition.id],['XML SHA-256',result.definition.sha256],['Business key',result.businessKey]]),node('h3','Exact typed native start'),pre(result.nativeRequest.bodyText));
  previewBox.append(button('Save reviewed event programme',async()=>{
   if(!preview||preview.input!==selection())throw Error('Preview the current event source before saving.');
   const selected=preview.value;
   const r=await write('saveProgramme',{requestId:selected.requestId,connectionId:JSON.parse(preview.input).connectionId,programmeText:selected.programmeText});
   await reload();await openSaved(r.id);notice('Complete original event, mapping and selected case source saved.');
  }),button('Download preview programme',()=>download(result.programme.key+'.json',result.programmeText)));
 }
 root.querySelector('#event-preview-button').addEventListener('click',()=>busy('Review event source',previewCurrent));
 root.querySelector('#event-load-example').addEventListener('click',()=>busy('Open event example',async()=>{
  const result=await eventAPI('example',{name:examples.value});event.value=result.eventText;profile.value=result.profileText;saved=null;edited();renderSaved();
 }));
 root.querySelector('#event-download').addEventListener('click',()=>download('event.json',event.value));
 root.querySelector('#event-profile-download').addEventListener('click',()=>download('event-profile.json',profile.value));
 for(const [id,target]of [['event-file',event],['event-profile-file',profile]])root.querySelector('#'+id).addEventListener('change',e=>busy('Open original event source',async()=>{
  const file=e.target.files[0];if(!file)return;if(file.size>1048576)throw Error('Each original JSON source is limited to 1 MiB.');
  target.value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());edited();e.target.value='';
 }));
 return {async render(){
  const epoch=++generation,workspace=workspaceId(),connectionId=requireEngine();
  if(lastConnection!==connectionId){lastConnection=connectionId;saved=null;preview=null;}
  if(restoredWorkspace!==workspace){restoredWorkspace=workspace;saved=null;preview=null;capture=null;loadedDefinitionsKey=null;event.value='';profile.value='';definition.value='';definition.dataset.restore='';previewBox.replaceChildren(node('p','Open this workspace original event source to preview.'));try{const retained=JSON.parse(sessionStorage.getItem(draftKey())??'null');if(retained){event.value=retained.eventText;profile.value=retained.profileText;definition.dataset.restore=retained.definitionId??'';}}catch{}}
  capture=records('casePortfolio').find(x=>x.id===casePortfolio()&&x.connectionId===connectionId&&x.state==='CAPTURED')??null;
  status.textContent=capture?'Using saved CMMN capture '+capture.id+' revision '+capture.revision+'.':'Open Cases and refresh the selected CMMN connection to capture original definitions.';
  const key=JSON.stringify([connectionId,capture?.id,capture?.revision]);
  if(key!==loadedDefinitionsKey){
   const selectedCapture=capture,items=[];if(selectedCapture){let offset=0;do{const page=await api('readCasePortfolio',{id:selectedCapture.id,revision:selectedCapture.revision,collection:'definitions',offset,limit:500});if(epoch!==generation)return;items.push(...page.items);offset=page.nextOffset;}while(offset!=null);}
   if(epoch!==generation)return;
   const selected=definition.value||definition.dataset.restore;definition.replaceChildren(node('option','Select original case definition',{value:''}));
   for(const item of items)definition.append(node('option',item.name+' · '+item.key+' · v'+item.version,{value:item.id}));
   if(items.some(x=>x.id===selected))definition.value=selected;loadedDefinitionsKey=key;preview=null;
  }
  renderSaved();
 }};
}
