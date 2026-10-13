/* Managed browser continuation for the original Curriculum Migration Workbench.
 * New writes execute the original native command; IndexedDB retains the exact request
 * before sending. The embedded original application remains an exact separate download.
 */
const Managed = (() => {
 const config=CURRICULUM_MANAGED_CONFIG,scopeKey='curriculum-managed:'+config.storeId+':'+config.directory;
 const clone=x=>JSON.parse(JSON.stringify(x)),digest=x=>Codec.sha256(Model.canonical(x));
 let token=location.hash.slice(1),db,identity,branch,busy=false,displayedKey=null,restoring=false;
 let drafts={},pendingUi=null,draftTimer=null,tabId,viewGeneration=0;
 try{
  if(token){sessionStorage.setItem(scopeKey+':token',token);history.replaceState(null,'',location.pathname+location.search);}
  else token=sessionStorage.getItem(scopeKey+':token')||'';
  tabId=sessionStorage.getItem(scopeKey+':tab')||crypto.randomUUID();sessionStorage.setItem(scopeKey+':tab',tabId);
 }catch{tabId=crypto.randomUUID();if(token)history.replaceState(null,'',location.pathname+location.search);}
 const draftKey=scopeKey+':drafts:'+tabId,originalOperations=new WeakMap();
 const requestKey=scopeKey+':request';
 const currentExpected=()=>({workspaceId:branch.workspaceId,revision:branch.revision,snapshotSha256:branch.snapshotSha256});
 function headers(){return{'Authorization':'Bearer '+token,'X-Curriculum-Store-Id':config.storeId,'X-Curriculum-Store-Directory':config.directory};}
 async function call(path,body,binary=false){
  if(!token)throw Error('Open this managed Application through its private connection URL.');
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{...headers(),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',credentials:'omit',redirect:'error'});
  if(binary&&response.ok){
   const bytes=new Uint8Array(await response.arrayBuffer()),sha=response.headers.get('x-curriculum-source-sha256'),length=response.headers.get('x-curriculum-source-bytes');
   if(sha&&Codec.sha256(bytes)!==sha)throw Error('Downloaded source checksum differs.');
   if(length!==null&&Number(length)!==bytes.length)throw Error('Downloaded source length differs.');
   return bytes;
  }
  const reply=await response.json();
  if(!response.ok||reply.ok!==true)throw Object.assign(Error(reply.error?.message||'Managed request failed.'),{code:reply.error?.code,notCommitted:reply.notCommitted,requestId:reply.requestId});
  return reply.result;
 }
 async function database(){
  if(db)return db;
  db=await new Promise((resolve,reject)=>{const r=indexedDB.open('curriculum-managed-recovery.v1',1);r.onupgradeneeded=()=>r.result.createObjectStore('retained',{keyPath:'key'});r.onerror=()=>reject(r.error);r.onblocked=()=>reject(Error('Close the older workbench tab to open retained drafts.'));r.onsuccess=()=>resolve(r.result);});
  db.onversionchange=()=>{db.close();db=null;};return db;
 }
 async function transaction(key,mode,work){
  const d=await database();
  return new Promise((resolve,reject)=>{const tx=d.transaction('retained',mode),s=tx.objectStore('retained');let result,error;
   tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(error||tx.error);tx.onerror=()=>{};
   const request=s.get(key);request.onerror=()=>{error=request.error;tx.abort();};request.onsuccess=()=>{try{result=work(s,request.result);}catch(e){error=e;tx.abort();}};
  });
 }
 const pending=()=>transaction(requestKey,'readonly',(_s,row)=>row||null);
 async function settle(original,result){
  await transaction(requestKey,'readwrite',(s,row)=>{if(!row||row.sha256!==original.sha256)throw Error('The retained request changed. Reopen its current state.');s.delete(requestKey);});
  pendingUi=null;return result;
 }
 async function dispatch(original){
  try{return await settle(original,await call(original.path,original.body));}
  catch(error){if(error.notCommitted===true)await settle(original,null);throw error;}
 }
 async function mutate(path,input){
  const body=clone(input);body.requestId??=crypto.randomUUID();
  const original={key:requestKey,path,body,sha256:digest({path,body})};
  await persistDrafts();
  await transaction(requestKey,'readwrite',(s,row)=>{if(row&&row.sha256!==original.sha256)throw Error('An original request awaits recovery. Use Recover original request before another change.');if(!row)s.add(original);});
  pendingUi=original;updateControls();return dispatch(original);
 }
 function currentViewKey(){return branch.id+':'+tab+':'+(tab==='case'?selected||'':tab==='contracts'?contractId||'':'');}
 function capture(){
  if(restoring||!displayedKey||!branch)return;
  const previous=drafts[displayedKey],values=[];
  document.querySelectorAll('#main input[id],#main textarea[id],#main select[id]').forEach(el=>{
   if(el.type!=='file')values.push({id:el.id,value:el.value,...(['checkbox','radio'].includes(el.type)?{checked:el.checked}:{})});
  });
  drafts[displayedKey]={basis:previous?.basis||currentExpected(),values,details:[...document.querySelectorAll('#main details')].map(x=>x.open),panel:curriculumPanel?.snapshot?.()||previous?.panel||null};
 }
 async function persistDrafts(){
  capture();if(draftTimer){clearTimeout(draftTimer);draftTimer=null;}
  const row={key:draftKey,drafts:clone(drafts),branchId:branch?.id||null,selected,tab,contractId,search,page,engineer:document.querySelector('#engineer')?.value||''};
  await transaction(draftKey,'readwrite',s=>s.put(row));
 }
 function queueDraftSave(){if(restoring)return;if(draftTimer)clearTimeout(draftTimer);draftTimer=setTimeout(()=>{draftTimer=null;persistDrafts().catch(e=>notice('Retain this form with Export draft: '+e.message,true));},200);}
 function restore(){
  viewGeneration++;
  displayedKey=currentViewKey();const d=drafts[displayedKey];restoring=true;
  try{
   if(d){for(const value of d.values){const el=document.getElementById(value.id);if(el&&el.closest('#main')){el.value=value.value;if('checked'in value)el.checked=value.checked;}}
    [...document.querySelectorAll('#main details')].forEach((el,i)=>{if(i<d.details.length)el.open=d.details[i];});}
  }finally{restoring=false;}updateControls();
 }
 function staleDraft(){const d=drafts[displayedKey];return !!d&&digest(d.basis)!==digest(currentExpected());}
 function updateControls(){
  if(!branch)return;
  const label=document.getElementById('managed-identity');label.textContent=identity.title+' · '+branch.label+' · Revision '+branch.revision;
  document.getElementById('storage').textContent='Saved in managed store '+identity.id;
  document.getElementById('managed-draft-status').textContent=staleDraft()?'This form was prepared against another saved revision. Review current values, then explicitly use the retained form or discard it.':pendingUi?'An original request awaits recovery. Its complete input is retained.':'Edits are saved to this managed branch.';
  document.getElementById('managed-rebase-draft').hidden=!staleDraft();
  document.getElementById('managed-recover').disabled=busy;
  document.getElementById('managed-branches').disabled=busy;document.getElementById('managed-branches').value=branch.id;
 }
 async function exclusive(fn){
  if(busy)throw Error('Wait for the current managed operation to finish.');
  busy=true;const disabled=[];
  document.querySelectorAll('button,input,select,textarea').forEach(el=>{if(!el.disabled){el.disabled=true;disabled.push(el);}});
  try{return await fn();}finally{busy=false;for(const el of disabled)if(el.isConnected)el.disabled=false;updateControls();}
 }
 function checkEditable(){
  if(!branch)throw Error('Select a managed branch first.');
  if(staleDraft())throw Error('Review the newer saved revision, then explicitly use or discard this retained form before saving.');
 }
 function register(object,kind,names){
  const original=object[kind];if(typeof original!=='function')throw Error('Original command is missing: '+kind);
  object[kind]=function(...args){
   checkEditable();const before=args[0],context=args.at(-1);
   if(before.id!==branch.workspaceId||before.revision!==branch.revision||digest(before)!==branch.snapshotSha256)throw Error('The displayed workspace differs from its managed branch.');
   const body={};names.forEach((name,i)=>body[name]=clone(args[i+1]));
   const next=original(...args);
   originalOperations.set(next,{id:branch.id,expected:currentExpected(),command:{kind,actor:context.actor,at:context.at,body},expectedSnapshot:digest(next)});
   return next;
  };
 }
 register(Model,'addEdition',['edition']);register(Model,'addCase',['case']);register(Model,'updateCase',['caseId','patch']);
 register(Model,'saveResponse',['caseId','lane','response']);register(Model,'compareCase',['caseId']);register(Model,'decide',['caseId','decision']);register(Model,'addAsset',['asset']);
 register(Curriculum,'planCurriculumCase',['caseId','options']);register(Curriculum,'decideCurriculumPlan',['caseId','decision']);
 async function refreshChoices(){
  const rows=await call('/api/branches'),select=document.getElementById('managed-branches');select.replaceChildren();
  for(const row of rows){const option=document.createElement('option');option.value=row.id;option.textContent=row.label+' · r'+row.revision;select.append(option);}select.value=branch.id;
 }
 function captureContext(){return {branchId:branch.id,expected:currentExpected(),viewKey:currentViewKey(),generation:viewGeneration};}
 function assertContext(context){
  if(context.branchId!==branch.id||digest(context.expected)!==digest(currentExpected())||context.viewKey!==currentViewKey()||context.generation!==viewGeneration)throw Error('The original editor changed while this input was open. Reopen the file in the intended branch and editor.');
 }
 async function readFileText(file){const context=captureContext();const text=await exclusive(()=>file.text());assertContext(context);return {text,context};}
 function installBranch(next,{clearView=false}={}){
  if(next.storeId!==config.storeId||next.workspaceId!==next.snapshot.id||next.revision!==next.snapshot.revision||next.snapshotSha256!==digest(next.snapshot))throw Error('Managed branch identity or complete snapshot differs.');
  if(clearView){capture();document.getElementById('new-dialog')?.close();if(curriculumPanel){curriculumPanel.destroy();curriculumPanel=null;}displayedKey=null;}
  branch=next;workspace=Curriculum.receiveCurriculumWorkspace(next.snapshot);
  if(!workspace.cases.some(c=>c.id===selected))selected=workspace.cases[0]?.id;
  if(!workspace.editions.some(e=>e.id===contractId))contractId=null;
 }
 async function save(next,message='Saved'){
  const operation=originalOperations.get(next);if(!operation)throw Error('Save the original workbench operation through its command.');
  originalOperations.delete(next);capture();
  return exclusive(async()=>{
   const frozenKey=displayedKey,result=await mutate('/api/branches/command',{requestId:crypto.randomUUID(),id:operation.id,expected:operation.expected,command:operation.command});
   if(result.branch.snapshotSha256!==operation.expectedSnapshot)throw Error('Saved command returned a different complete workspace. Recover and inspect the original request.');
   // Always reopen current: an exact replay returns its first result, including an older revision.
   const current=await call('/api/branches/'+encodeURIComponent(operation.id));
   installBranch(current);
   if(drafts[frozenKey]&&current.snapshotSha256===result.branch.snapshotSha256)drafts[frozenKey].basis=currentExpected();
   displayedKey=null;render();await refreshChoices();await persistDrafts();notice(message);
   return workspace;
  });
 }
 async function exportWorkspace(){
  await persistDrafts();const packet=await call('/api/branches/export',{id:branch.id,expected:currentExpected()});
  download(workspace.id+'-r'+workspace.revision+'.json',JSON.stringify(packet,null,2));notice('Complete workspace, retained sources, decisions and history exported.');
 }
 async function receiveFile(file){
  const context=captureContext(),fileBytes=await exclusive(async()=>new Uint8Array(await file.arrayBuffer()));assertContext(context);const snapshot=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(fileBytes)),inputSha256=Codec.sha256(fileBytes),label=file.name.replace(/\.json$/i,'')||'Received workspace';
  return exclusive(async()=>{
   capture();const next=await mutate('/api/branches/create',{id:crypto.randomUUID(),label,snapshot,origin:{kind:'operator-file',name:file.name,inputSha256,parentBranchId:branch.id,fromStoreId:identity.id}});
   installBranch(next,{clearView:true});selected=workspace.cases[0]?.id;tab='overview';render();await refreshChoices();await persistDrafts();notice('Complete workspace received in a separate managed branch.');
  });
 }
 async function sourceDownload(){
  return exclusive(async()=>{
   await persistDrafts();const expected=currentExpected(),id=branch.id,packet=await call('/api/branches/export',{id,expected}),files=[];
   // Exact fixed selection, including pristine HTML; no live DOM or private connection data.
   for(const path of CURRICULUM_MANAGED_CONFIG.sourcePaths){
    const bytes=await call('/api/application-source/'+encodeURIComponent(path),undefined,true);
    files.push({path,content:new TextDecoder('utf-8',{fatal:true}).decode(bytes)});
   }
   const generated=await call('/api/report',{id,expected,kind:'sdk',options:{editionId:workspace.editions.at(-1).id}});
   const report=generated.result;
   for(const file of report.files)files.push({path:'generated/'+file.path,content:file.content});
   files.push({path:'current-workspace.json',content:JSON.stringify(packet,null,2)});
   files.push({path:'RECEIVE_CURRENT_WORKSPACE.txt',content:'Open curriculum-migration-workbench.html in an independent browser context. Use Receive workspace and select current-workspace.json. The complete original source, generated Oak API SDK and current portable workspace are included.\n'});
   const url=URL.createObjectURL(zipFiles(files)),a=document.createElement('a');a.href=url;a.download='Curriculum_Migration_Workbench.zip';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
   notice('Complete application, exact source, generated API SDK and selected workspace exported.');
  });
 }
 async function recover(){
  return exclusive(async()=>{
   capture();const old=await pending();
   if(old){
    const receipt=await call('/api/requests/'+encodeURIComponent(old.body.requestId));
    let result;
    if(receipt!==null){
     if(digest(receipt.input)!==receipt.inputSha256)throw Error('Retained server request checksum differs.');
     // The server normalizes inputs. Exact replay performs its original input comparison.
     result=await dispatch(old);
    }else result=await dispatch(old);
    if(old.path==='/api/branches/create'){installBranch(result,{clearView:true});selected=workspace.cases[0]?.id;tab='overview';}
   }
   installBranch(await call('/api/branches/'+encodeURIComponent(branch.id)));displayedKey=null;render();await refreshChoices();await persistDrafts();
   notice('Original request settled and current branch reopened. Your retained form remains available.');
  });
 }
 async function boot(){
  try{
   identity=await call('/api/identity');
   if(identity.id!==config.storeId||identity.directory!==config.directory||identity.sourceSha256!==config.sourceSha256)throw Error('Managed store identity differs from this Application.');
   const saved=await transaction(draftKey,'readonly',(_s,row)=>row||null),rows=await call('/api/branches');
   drafts=saved?.drafts||{};pendingUi=await pending();
   const id=rows.some(r=>r.id===saved?.branchId)?saved.branchId:identity.defaultBranchId;
   installBranch(await call('/api/branches/'+encodeURIComponent(id)));
   originalWorkspace=workspace;
   selected=workspace.cases.some(c=>c.id===saved?.selected)?saved.selected:workspace.cases[0]?.id;
   tab=['case','curriculum','contracts','sources','history','overview'].includes(saved?.tab)?saved.tab:'case';contractId=saved?.contractId||null;search=saved?.search||'';page=saved?.page||0;
   document.getElementById('engineer').value=saved?.engineer||'';document.getElementById('case-search').value=search;
   document.getElementById('engineer').oninput=queueDraftSave;
   document.getElementById('case-search').oninput=e=>{search=e.target.value;render();queueDraftSave();};
   document.querySelectorAll('[data-tab]').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;render();queueDraftSave();});
   document.getElementById('export-workspace').onclick=action(exportWorkspace);
   document.getElementById('receive-workspace').onchange=action(async()=>{const el=document.getElementById('receive-workspace'),file=el.files[0];if(file)await receiveFile(file);el.value='';});
   document.getElementById('new-case').onclick=newCase;document.getElementById('close-dialog').onclick=()=>document.getElementById('new-dialog').close();
   document.getElementById('download-source').onclick=action(sourceDownload);
   document.getElementById('managed-recover').onclick=action(recover);
   document.getElementById('managed-reopen').onclick=action(()=>exclusive(async()=>{capture();installBranch(await call('/api/branches/'+encodeURIComponent(branch.id)));displayedKey=null;render();await persistDrafts();notice('Latest saved revision reopened. Retained form values remain available.');}));
   document.getElementById('managed-branches').onchange=action(async()=>{const id=document.getElementById('managed-branches').value;await persistDrafts();await exclusive(async()=>{installBranch(await call('/api/branches/'+encodeURIComponent(id)),{clearView:true});render();await persistDrafts();});});
   document.getElementById('managed-copy').onclick=action(()=>exclusive(async()=>{const packet=await call('/api/branches/export',{id:branch.id,expected:currentExpected()});const copy=await mutate('/api/branches/create',{id:crypto.randomUUID(),label:branch.label+' — working copy',snapshot:packet,origin:{kind:'working-copy',storeId:identity.id,branchId:branch.id,snapshotSha256:branch.snapshotSha256}});installBranch(copy,{clearView:true});render();await refreshChoices();await persistDrafts();notice('Independent working branch created with complete history.');}));
   document.getElementById('managed-export-draft').onclick=action(async()=>{await persistDrafts();download('curriculum-retained-forms.json',JSON.stringify({schema:'curriculum-managed-forms.v1',storeId:identity.id,branchId:branch.id,drafts},null,2));});
   document.getElementById('managed-discard-draft').onclick=action(async()=>{delete drafts[displayedKey];displayedKey=null;if(curriculumPanel){curriculumPanel.destroy();curriculumPanel=null;}render();await persistDrafts();notice('The form now shows the current saved values.');});
   document.getElementById('managed-rebase-draft').onclick=action(async()=>{capture();if(drafts[displayedKey])drafts[displayedKey].basis=currentExpected();await persistDrafts();updateControls();notice('Retained form now targets the displayed saved revision. Save its explicit operation when ready.');});
   document.getElementById('managed-inspect-current').onclick=()=>download('current-saved-branch.json',JSON.stringify(branch,null,2));
   document.getElementById('main').addEventListener('input',queueDraftSave);document.getElementById('main').addEventListener('change',queueDraftSave);
   render();await refreshChoices();notice('Managed curriculum workspace reopened with its complete source editions and history.');
  }catch(error){notice('Unable to open managed workspace: '+error.message,true);}
 }
 return{boot,save,exportWorkspace,receiveFile,capture,restore,captureContext,assertContext,readFileText,isBusy:()=>busy,current:()=>clone(branch),read:id=>call('/api/branches/'+encodeURIComponent(id)),list:()=>call('/api/branches'),pending,panelDraft:()=>drafts[currentViewKey()]?.panel||null,queueDraftSave};
})();
