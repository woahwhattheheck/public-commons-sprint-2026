/** Complete source-selection continuation on the caller's existing authenticated Page. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createWorking,validateWorking,serializeWorking,reconcileSources} from './web/gis-working-selection.mjs';

const ensure=(value,message)=>{if(!value)throw Error(message);};
const hash=body=>createHash('sha256').update(body).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
 value&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const same=(a,b)=>canonical(a)===canonical(b);
const exists=async file=>{try{await fs.stat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};

export async function receiveGISSourceSelection(page,{
 inputPath,outputDirectory,workspace,api,ownerCheck,nativeVerify,taskTimeoutSeconds=14400
}){
 ensure(typeof api==='function'&&typeof ownerCheck==='function'&&typeof nativeVerify==='function','Use the original owner, authenticated API and native literal-archive receiver.');
 await ownerCheck();
 const inputBytes=await fs.readFile(inputPath),input=JSON.parse(inputBytes.toString('utf8'));
 ensure(input.schema==='upstate.gis-source-selection-receiving-input/v1','Choose the complete original GIS selection input.');
 const collections=[...new Set(input.selection.sources.map(row=>row.source_collection_id))];
 ensure(collections.length>=2,'Retain at least two actual original source editions.');
 const output=path.resolve(outputDirectory);await fs.mkdir(output,{recursive:true,mode:0o700});
 const inputIdentity={bytes:inputBytes.length,sha256:hash(inputBytes)},statePath=path.join(output,'source-selection-browser.json');
 let state=await exists(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):
  {schema:'upstate.gis-source-selection-browser/v1',input:inputIdentity,project_id:input.project_id,
   workspace_key:workspace,phases:{},artifacts:{},state:'running'};
 ensure(same(state.input,inputIdentity)&&state.project_id===input.project_id&&state.workspace_key===workspace,
   'Resume the same original GIS project and complete source input.');
 async function checkpoint(){
  const tmp=statePath+'.'+randomUUID()+'.tmp',body=JSON.stringify(state,null,2)+'\n';
  await fs.writeFile(tmp,body,{mode:0o600});const fd=await fs.open(tmp,'r');try{await fd.sync();}finally{await fd.close();}
  await fs.rename(tmp,statePath);const dir=await fs.open(output,'r');try{await dir.sync();}finally{await dir.close();}
 }
 async function retain(name,body){
  const target=path.join(output,name);ensure(path.dirname(target)===output,'Keep source-selection artifacts in this owned directory.');
  if(await exists(target))ensure((await fs.readFile(target)).equals(Buffer.from(body)),'Retained complete GIS artifact changed: '+name);
  else{
   const tmp=target+'.'+randomUUID()+'.tmp';await fs.writeFile(tmp,body,{mode:0o600});
   const fd=await fs.open(tmp,'r');try{await fd.sync();}finally{await fd.close();}
   try{await fs.link(tmp,target);}catch(error){if(error.code!=='EEXIST')throw error;ensure((await fs.readFile(target)).equals(Buffer.from(body)),'Concurrent retained artifact changed.');}
   finally{await fs.unlink(tmp);}
   const dir=await fs.open(output,'r');try{await dir.sync();}finally{await dir.close();}
  }
  const bytes=await fs.readFile(target);state.artifacts[name]={path:target,bytes:bytes.length,sha256:hash(bytes)};await checkpoint();return target;
 }
 async function originalState(){const current=await api('/api/state?'+new URLSearchParams({workspace}));
  ensure(current.workspace_key===workspace&&current.data?.project?.id===input.project_id,'Open the same original or restored scientific project.');return current;}
 async function openPane(){
  await ownerCheck();await originalState();
  for(const id of ['form-dialog','detail-dialog']){
   const d=page.locator('#'+id);if(await d.count()&&await d.evaluate(node=>node.open))
    await d.locator('[data-action="'+(id==='form-dialog'?'form-close':'detail-close')+'"]').click();
  }
  await page.locator('[data-view="gis-projects"]').click();
  await page.locator('[data-gis-export]').waitFor({state:'visible'});
 }
 async function working(){const value=await page.evaluate(key=>JSON.parse(sessionStorage.getItem('upstate-gis-working-selection:'+key)||'null'),workspace);
  return value?validateWorking(value,{projectId:input.project_id}):null;}
 async function expectSelection(expected){
  const deadline=Date.now()+30000;
  while(Date.now()<deadline){const value=await working();if(value&&same(value.selection,expected))return value;await page.waitForTimeout(50);}
  throw Error('The installed complete working selection has not retained the requested source editions.');
 }
 async function openFile(body){
  await ownerCheck();await page.locator('[data-gis-working-open]').setInputFiles({name:'gis-working-selection.json',mimeType:'application/json',buffer:Buffer.from(body)});
 }
 async function download(name,click){
  await ownerCheck();
  if(await exists(path.join(output,name)))return retain(name,await fs.readFile(path.join(output,name)));
  const pending=page.waitForEvent('download',{timeout:60000});await click();const value=await pending;
  ensure(!await value.failure(),'The complete GIS browser download failed.');
  const temp=path.join(output,'.download-'+randomUUID());try{
   await value.saveAs(temp);return await retain(name,await fs.readFile(temp));
  }finally{await fs.unlink(temp).catch(()=>{});}
 }
 async function screenshot(name){
  await ownerCheck();await page.evaluate(async()=>{await document.fonts.ready;await new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)));});
  if(await exists(path.join(output,name)))return retain(name,await fs.readFile(path.join(output,name)));
  return retain(name,await page.screenshot({fullPage:true}));
 }
 function checkTask(task,phase){
  const request=phase.request;
  ensure(task.workspace===workspace&&task.action===request.action&&same(task.payload,request.payload),'The original queue returned another complete GIS request.');
  if(phase.accepted_operation_id)ensure(task.operation_id===phase.accepted_operation_id,'The accepted original operation changed.');
  else{ensure(typeof task.operation_id==='string'&&task.operation_id,'The accepted native operation has no identity.');phase.accepted_operation_id=task.operation_id;}
  if(phase.task_id)ensure(task.id===phase.task_id,'The retained task changed.');else phase.task_id=task.id;
 }
 async function waitTask(phase){
  const deadline=Date.now()+taskTimeoutSeconds*1000;
  while(true){
   await ownerCheck();const response=await api('/api/task?'+new URLSearchParams({id:phase.task_id})),task=response.task||response;
   checkTask(task,phase);phase.last_state=task.state;await checkpoint();
   if(task.state==='complete'){phase.result=clone(task.result);await checkpoint();return task;}
   ensure(!['failed','cancelled','interrupted'].includes(task.state),'Continue the original reported GIS task '+task.id+' ('+task.state+').');
   ensure(Date.now()<deadline,'The original GIS task remains active: '+task.id);await page.waitForTimeout(1000);
  }
 }
 async function uiTask(name,action,click,check,{drop=false}={}){
  const phase=state.phases[name]||(state.phases[name]={action});
  ensure(phase.action===action,'The retained phase names another native action.');
  if(phase.request){
   ensure(phase.request.action===action&&phase.request.workspace===workspace,'The retained request names another original action.');check(phase.request.payload);
   await ownerCheck();const response=await api('/api/actions',phase.request),task=response.task||response;checkTask(task,phase);await checkpoint();
   return waitTask(phase);
  }
  let matched=false,finish;const done=new Promise(resolve=>{finish=resolve;});let failure;
  const route='**/api/actions';
  const handler=async intercepted=>{
   const request=intercepted.request().postDataJSON();
   if(matched||request?.action!==action||request.workspace!==workspace)return intercepted.continue();
   matched=true;
   try{
    check(request.payload);phase.request=clone(request);await checkpoint();await ownerCheck();
    const response=await intercepted.fetch(),body=await response.json();ensure(response.ok(),JSON.stringify(body));
    const task=body.task||body;checkTask(task,phase);phase.response_loss_exercised=Boolean(drop);await checkpoint();
    if(drop)await intercepted.abort('failed');else await intercepted.fulfill({response});
   }catch(error){failure=error;await intercepted.abort('failed').catch(()=>{});}
   finally{finish();}
  };
  await page.route(route,handler);
  try{
   await ownerCheck();await click();
   const deadline=Date.now()+60000;
   while(!matched&&Date.now()<deadline)await page.waitForTimeout(50);
   ensure(matched,'The installed control did not submit the original GIS action.');
   let timer;try{await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The original GIS response remains unresolved.')),60000);})]);}finally{clearTimeout(timer);}
   if(failure)throw failure;
  }finally{await page.unroute(route,handler);}
  return waitTask(phase);
 }
 await retain('source-selection-input.json',inputBytes);await originalState();
 for(const descriptor of Object.values(state.artifacts)){
  const bytes=await fs.readFile(descriptor.path);ensure(bytes.length===descriptor.bytes&&hash(bytes)===descriptor.sha256,'A retained source-selection artifact changed.');
 }
 await openPane();
 const catalogue=await api('/api/gis/projects?'+new URLSearchParams({workspace}));
 const prepared=createWorking({projectId:input.project_id,selection:input.selection,
  activeSourceCollectionId:collections[0],catalogue});
 ensure(same(prepared.selection,input.selection)&&reconcileSources(prepared.selection,catalogue).can_submit_sources,'The original admitted selection changed.');
 if(!state.phases.working?.complete){
  const first=clone(prepared);first.selection.sources=first.selection.sources.filter(row=>row.source_collection_id===collections[0]);
  first.source_descriptions=first.source_descriptions.filter(row=>row.source_collection_id===collections[0]);
  await retain('initial-working-selection.json',serializeWorking(first));await openFile(serializeWorking(first));await expectSelection(first.selection);
  // Browse each actual edition and select its real original rows through the installed controls.
  for(const collection of collections.slice(1)){
   await ownerCheck();await page.locator('[name="source_collection_id"]').selectOption(collection);
   const ids=[...new Set(input.selection.sources.filter(row=>row.source_collection_id===collection).map(row=>row.source_id))];
   for(const id of ids){await ownerCheck();await page.locator('[name="source"][value='+JSON.stringify(id)+']').check();}
  }
  await expectSelection(input.selection);
  for(const collection of collections){await ownerCheck();await page.locator('[name="source_collection_id"]').selectOption(collection);await expectSelection(input.selection);}
  for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await screenshot('combined-source-choices-'+width+'.png');}
  const downloaded=await download('complete-working-selection.json',()=>page.locator('[data-gis-working-download]').click());
  const full=validateWorking(JSON.parse(await fs.readFile(downloaded,'utf8')),{projectId:input.project_id});
  ensure(same(full.selection,input.selection),'The downloaded working file changed original source choices.');
  await ownerCheck();await page.locator('[name="notes"]').fill(input.selection.notes.join('\n')+'\nUnfinished receiving note.');
  const unfinished=await download('unfinished-working-selection.json',()=>page.locator('[data-gis-working-download]').click());
  const draft=validateWorking(JSON.parse(await fs.readFile(unfinished,'utf8')),{projectId:input.project_id});
  ensure(draft.selection.notes.at(-1)==='Unfinished receiving note.','The original unfinished note was not retained.');
  await openFile(await fs.readFile(downloaded));await expectSelection(input.selection);
  const reopened=await working();
  ensure(reopened.import_history.some(row=>same(row.previous?.selection,draft.selection)),'Opening saved work lost the complete displaced unfinished selection.');
  await ownerCheck();await page.reload();await openPane();await expectSelection(input.selection);
  state.phases.working={complete:true,working_file:state.artifacts['complete-working-selection.json'],unfinished_file:state.artifacts['unfinished-working-selection.json']};await checkpoint();
 }else{
  const retained=await fs.readFile(path.join(output,'complete-working-selection.json'));await openFile(retained);await expectSelection(input.selection);
 }
 await page.setViewportSize({width:1440,height:1000});
 const exported=await uiTask('export','gis.project.export',()=>page.locator('[data-gis-export] button[type="submit"]').click(),
  payload=>ensure(same(payload,input.selection),'Export changed the complete original selection.'),{drop:true});
 await ownerCheck();await page.reload();await openPane();await expectSelection(input.selection);
 const replay=await uiTask('export','gis.project.export',()=>{},payload=>ensure(same(payload,input.selection),'Replay changed source choices.'));
 ensure(replay.id===exported.id,'The response-loss recovery created another export task.');
 const archiveURL=exported.result.archive_download.url+'?download=1';
 const archive=await download('complete-editable-gis.zip',()=>page.locator('a[href='+JSON.stringify(archiveURL)+']').first().click());
 const archiveBytes=await fs.readFile(archive);
 ensure(archiveBytes.length===exported.result.archive.bytes&&hash(archiveBytes)===exported.result.archive.sha256,'The actual complete ZIP differs from the original native export.');
 state.archive={path:archive,bytes:archiveBytes.length,sha256:hash(archiveBytes)};await checkpoint();
 const received=await uiTask('receive','gis.project.receive',async()=>{
  await page.locator('[name="archive"]').setInputFiles(archive);
  await page.locator('[data-gis-receive] button[type="submit"]').click();
 },payload=>ensure(typeof payload.upload_id==='string'&&payload.upload_id,'Receive the actual complete original upload.'));
 ensure(received.result.result.fingerprint===exported.result.result.fingerprint,'The independent original receiver changed the complete GIS edition.');
 for(const [label,view]of [['export',exported.result],['received',received.result]]){
  await ownerCheck();await page.goto(new URL(view.viewer_url,page.url()).href);
  const payload=JSON.parse(await page.locator('#project-data').textContent());
  ensure(payload.edition_id===view.result.edition_id,'The layer browser opened another original edition.');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.locator('#browse-layers').click();
   for(let i=0;i<payload.layers.length;i++){await ownerCheck();await page.locator('#layers button.details').nth(i).click();await screenshot(label+'-layer-'+i+'-'+width+'.png');}
   await page.locator('#browse-sources').click();
   const count=await page.locator('#sources button.source-choice').count();
   for(let i=0;i<count;i++){await ownerCheck();await page.locator('#sources button.source-choice').nth(i).click();await screenshot(label+'-source-'+i+'-'+width+'.png');}
  }
 }
 state.state='native_ready';await checkpoint();
 const nativeInput=path.join(output,'native-browser-source.json');
 if(!await exists(nativeInput))await retain('native-browser-source.json',JSON.stringify(state,null,2)+'\n');
 else{
  const previous=JSON.parse(await fs.readFile(nativeInput,'utf8'));
  ensure(same(previous.input,state.input)&&previous.project_id===state.project_id&&
   same(previous.phases.export.request,state.phases.export.request)&&same(previous.phases.receive.request,state.phases.receive.request)&&
   same(previous.archive,state.archive),'The retained native browser source names another complete operation.');
  await retain('native-browser-source.json',await fs.readFile(nativeInput));
 }
 await ownerCheck();const native=await nativeVerify(nativeInput);
 ensure(native.project_id===input.project_id&&native.state==='complete'&&native.fingerprint===exported.result.result.fingerprint,
  'The original native literal ZIP reopening returned another complete edition.');
 const {pathToFileURL}=await import('node:url');
 await ownerCheck();await page.goto(pathToFileURL(path.join(native.independent_project,'OPEN_GIS.html')).href);
 const cold=JSON.parse(await page.locator('#project-data').textContent());
 ensure(cold.edition_id===exported.result.result.edition_id,'The actual cold archive opened another GIS edition.');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:1000});await page.locator('#browse-layers').click();
  for(let i=0;i<cold.layers.length;i++){await ownerCheck();await page.locator('#layers button.details').nth(i).click();await screenshot('independent-layer-'+i+'-'+width+'.png');}
  await page.locator('#browse-sources').click();
  const count=await page.locator('#sources button.source-choice').count();
  for(let i=0;i<count;i++){await ownerCheck();await page.locator('#sources button.source-choice').nth(i).click();await screenshot('independent-source-'+i+'-'+width+'.png');}
 }
 state.native_reopened=native;state.cold_browser_complete=true;state.state='complete';state.completed_at=state.completed_at||new Date().toISOString();await checkpoint();return clone(state);
}
