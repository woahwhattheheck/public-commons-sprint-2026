import {installDocumentComparison} from './document-comparison-browser.mjs';
// MIT. Document source editing and native review in the existing Flowable workspace.
export function installFlowableDocumentIntake({api,documentAPI,write,busy,button,node,pre,keyValues,notice,reload,openRecord,records,forEngine,requireEngine,workspaceId,portfolio}){
 const root=document.querySelector('[data-panel="documents"]'),captureEditor=root.querySelector('#document-source'),profile=root.querySelector('#document-profile'),
 definition=root.querySelector('#document-definition'),previewBox=root.querySelector('#document-preview'),savedBox=root.querySelector('#document-saved'),
 status=root.querySelector('#document-status');
 const comparison=installDocumentComparison({root,documentAPI,busy,node,button,pre,keyValues,notice,workspaceId});
 let generation=0,preview=null,saved=null,capture=null,restoredWorkspace=null,loadedDefinitionsKey=null,lastConnection=null;
 const selection=()=>JSON.stringify({connectionId:requireEngine(),portfolioId:capture?.id,revision:capture?.revision,definitionId:definition.value,captureText:captureEditor.value,profileText:profile.value});
 const draftKey=()=> 'flowable-document-draft:'+workspaceId();
 function persist(){if(!workspaceId())return;try{sessionStorage.setItem(draftKey(),JSON.stringify({captureText:captureEditor.value,profileText:profile.value,definitionId:definition.value}));}catch{notice('The draft could not be retained in this tab. Download its original sources.','error');}}
 function edited(){generation++;preview=null;previewBox.replaceChildren(node('p','Preview the current complete source before saving.'));persist();}
 captureEditor.addEventListener('input',edited);profile.addEventListener('input',edited);definition.addEventListener('change',edited);
 function download(name,text){const url=URL.createObjectURL(new Blob([text],{type:'application/json;charset=utf-8'}));const a=node('a',null,{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 function sourceText(programme,name){const item=programme.programme.sources.find(s=>s.name===name);if(!item)throw Error('This programme has no original '+name);return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(Uint8Array.from(atob(item.contentBase64),x=>x.charCodeAt(0)));}
 async function openSaved(id){
  const epoch=++generation,p=await api('readProgramme',{id});if(epoch!==generation)return;
  if(!p.programme.sources.some(s=>s.name==='alfresco-capture.json')||!p.programme.sources.some(s=>s.name==='document-profile.json'))throw Error('Select a saved document programme.');
  captureEditor.value=sourceText(p,'alfresco-capture.json');profile.value=sourceText(p,'document-profile.json');saved=p;preview=null;persist();renderSaved();
  previewBox.replaceChildren(node('p','Original document and profile reopened. Native work stays bound to its saved definition and source.'));
 }
 function renderSaved(){
  savedBox.replaceChildren();
  const list=forEngine(records('programme')).filter(x=>String(x.label??'').startsWith('Document review:'));
  if(!saved)savedBox.append(node('p','Save the reviewed document source to begin the original process operation.'));
  else{
   const p=saved;savedBox.append(keyValues([['Saved programme',p.programmeKey],['Revision',p.record.revision],['Progress',p.progress.state]]));
   const toolbar=node('div',null,{class:'toolbar'});
   toolbar.append(button('Prepare and review original start',async()=>{
    // Reopening a saved programme is deliberate; edits belong to a new preview.
    if(captureEditor.value!==sourceText(p,'alfresco-capture.json')||profile.value!==sourceText(p,'document-profile.json'))throw Error('The editor differs from this saved programme. Reopen its originals or preview and save the changed document.');
    const command=await documentAPI('preparation',{programmeId:p.record.id});
    if(command.method!=='prepareProgrammeStep')throw Error('Unexpected document preparation action');
    const result=await write(command.method,command.args);
    await documentAPI('review',{programmeId:p.record.id,operationId:result.operation.id});
    await reload();await openRecord(result.operation.kind,result.operation.id);
    notice('Selected BPMN XML and original document request reviewed. Continue in the original native operation.');
   }),button('Refresh saved document',()=>openSaved(p.record.id)),button('Download saved programme',()=>download(p.programmeKey+'.json',JSON.stringify(p.programme,null,2)+'\n')),
    button('Show actual process and saved history',async()=>{
    const current=await api('readProgramme',{id:p.record.id}),row=current.progress.rows.find(x=>x.key==='start-document-process');
    if(!row?.record)throw Error('Prepare this original document process first.');
    const selected=records('portfolio').find(x=>x.id===portfolio()&&x.connectionId===requireEngine());
    if(!selected)throw Error('Refresh the original engine and select its saved portfolio.');
    const result=await documentAPI('result',{programmeId:p.record.id,operationId:row.record.id,portfolioId:selected.id,revision:selected.revision});
    previewBox.replaceChildren(node('h3','Actual document process'),keyValues([['Process ID',result.review.processInstanceId],['Capture',result.portfolio.id],['Revision',result.portfolio.revision]]),pre(result.collections));
   }),button('Download original document',()=>{
    const member=p.programme.sources.find(x=>x.name==='document-content.bin'),capture=JSON.parse(sourceText(p,'alfresco-capture.json')),
     selected=capture.reads.find(x=>x.role==='selected-before'),name=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(selected.body.contentBase64),c=>c.charCodeAt(0)))).entry.name;
    const url=URL.createObjectURL(new Blob([Uint8Array.from(atob(member.contentBase64),c=>c.charCodeAt(0))],{type:'application/octet-stream'})),a=node('a',null,{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
   }),button('Export complete workspace',async()=>{const r=await write('exportWorkspace',{label:p.label+' complete document handover'});await reload();await openRecord(r.kind,r.id);}));
   savedBox.append(toolbar);
  }
  const listBox=node('div');for(const r of list)listBox.append(button(r.label+' · '+r.state,()=>openSaved(r.id)));savedBox.append(listBox);
 }
 async function previewCurrent(){
  if(!capture||!definition.value)throw Error('Select the BPMN connection, refresh definitions, and select a captured definition.');
  const frozen=selection(),epoch=++generation,result=await documentAPI('preview',JSON.parse(frozen));
  if(epoch!==generation||frozen!==selection())throw Error('The selected document source changed during preview; preview the current edition.');
  preview={value:result,input:frozen};previewBox.replaceChildren(keyValues([['Capture SHA-256',result.capture.sha256],['Document SHA-256',result.capture.content.sha256],['Mapping SHA-256',result.profileSha256],
   ['Process definition',result.definition.id],['XML SHA-256',result.definition.sha256],['Business key',result.businessKey]]),node('h3','Exact typed native start'),pre(result.nativeRequest.bodyText));
  previewBox.append(button('Save reviewed document programme',async()=>{
   if(!preview||preview.input!==selection())throw Error('Preview the current document source before saving.');
   const selected=preview.value;
   const r=await write('saveProgramme',{requestId:selected.requestId,connectionId:JSON.parse(preview.input).connectionId,programmeText:selected.programmeText});
   await reload();await openSaved(r.id);notice('Complete original document, mapping and selected process source saved.');
  }),button('Download preview programme',()=>download(result.programme.key+'.json',result.programmeText)));
 }
 root.querySelector('#document-preview-button').addEventListener('click',()=>busy('Review document source',previewCurrent));
 root.querySelector('#document-load-example').addEventListener('click',()=>busy('Open document example',async()=>{
  const result=await documentAPI('example',{});captureEditor.value=result.captureText;profile.value=result.profileText;saved=null;edited();renderSaved();
 }));
 root.querySelector('#document-download').addEventListener('click',()=>download('alfresco-capture.json',captureEditor.value));
 root.querySelector('#document-profile-download').addEventListener('click',()=>download('document-profile.json',profile.value));
 for(const [id,target]of [['document-file',captureEditor],['document-profile-file',profile]])root.querySelector('#'+id).addEventListener('change',e=>busy('Open original document source',async()=>{
  const file=e.target.files[0];if(!file)return;if(file.size>(id==='document-file'?16777216:1048576))throw Error('Capture limit is 16 MiB; mapping profile limit is 1 MiB.');
  target.value=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());edited();e.target.value='';
 }));
 return {async render(){
  comparison.render();
  const epoch=++generation,workspace=workspaceId(),connectionId=requireEngine();
  if(lastConnection!==connectionId){lastConnection=connectionId;saved=null;preview=null;}
  if(restoredWorkspace!==workspace){restoredWorkspace=workspace;saved=null;preview=null;capture=null;loadedDefinitionsKey=null;captureEditor.value='';profile.value='';definition.value='';definition.dataset.restore='';previewBox.replaceChildren(node('p','Open this workspace original document source to preview.'));try{const retained=JSON.parse(sessionStorage.getItem(draftKey())??'null');if(retained){captureEditor.value=retained.captureText;profile.value=retained.profileText;definition.dataset.restore=retained.definitionId??'';}}catch{}}
  capture=records('portfolio').find(x=>x.id===portfolio()&&x.connectionId===connectionId&&x.state==='CAPTURED')??null;
  status.textContent=capture?'Using saved BPMN capture '+capture.id+' revision '+capture.revision+'.':'Refresh engine with the selected BPMN connection to capture original definitions.';
  const key=JSON.stringify([connectionId,capture?.id,capture?.revision]);
  if(key!==loadedDefinitionsKey){
   const selectedCapture=capture,items=[];if(selectedCapture){let offset=0;do{const page=await api('readPortfolio',{id:selectedCapture.id,revision:selectedCapture.revision,collection:'definitions',offset,limit:500});if(epoch!==generation)return;items.push(...page.items);offset=page.nextOffset;}while(offset!=null);}
   if(epoch!==generation)return;
   const selected=definition.value||definition.dataset.restore;definition.replaceChildren(node('option','Select original process definition',{value:''}));
   for(const item of items)definition.append(node('option',item.name+' · '+item.key+' · v'+item.version,{value:item.id}));
   if(items.some(x=>x.id===selected))definition.value=selected;loadedDefinitionsKey=key;preview=null;
  }
  renderSaved();
 }};
}
