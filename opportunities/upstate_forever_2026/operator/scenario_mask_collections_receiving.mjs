import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const SCHEMA='upstate.scenario-mask-browser-receiving/v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const equal=(a,b)=>canonical(a)===canonical(b);
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const documentOf=value=>Object.fromEntries(Object.entries(value).filter(([key])=>!['id','schema','_downloads'].includes(key)));
async function syncDirectory(directory){const file=await fs.open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function atomic(file,bytes,{immutable=false}={}){
 await fs.mkdir(path.dirname(file),{recursive:true});
 if(immutable){try{const previous=await fs.readFile(file);requireValue(previous.equals(Buffer.from(bytes)),'Retained output changed: '+file);return;}catch(error){if(error.code!=='ENOENT')throw error;}}
 const temporary=file+'.pending-'+randomUUID();let handle;
 try{handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
  if(immutable){await fs.link(temporary,file);await fs.unlink(temporary);}else await fs.rename(temporary,file);
  await syncDirectory(path.dirname(file));
 }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');

/** Borrow the current native operator's Page. The caller retains its original lock and API. */
export async function receiveScenarioMaskCollections(page,{api,workspaceKey,control,outputDirectory,ownerCheck}){
 requireValue(typeof ownerCheck==='function'&&typeof api==='function','Use the original owner check and authenticated operator API.');
 requireValue(control&&typeof control.operation_id==='string'&&/^[a-f0-9]{64}$/.test(control.input_sha256||''),'Receive the complete original native operation identity.');
 const scenario=control.scenario,run=control.run,footprint=control.footprint;
 requireValue(scenario?.kind==='landcover'&&scenario.patches?.length>=2&&run?.selection?.scenario_id===scenario.id&&footprint?.run_id===run.id,'Receive the actual saved multi-edition scenario, completed run and footprint.');
 const pairs=scenario.patches.map(p=>[p.source_collection_id||scenario.source_collection_id,p.mask_source_id]);
 requireValue(new Set(pairs.map(p=>p[0])).size>=2,'Receive the actual scenario with masks from at least two retained source editions.');
 const output=path.resolve(outputDirectory);await fs.mkdir(output,{recursive:true});
 const identity={schema:SCHEMA,operation_id:control.operation_id,input_sha256:control.input_sha256,project_id:control.project_id,workspace_key:workspaceKey,scenario_id:scenario.id,run_id:run.id,footprint_id:footprint.id};
 const stateFile=path.join(output,'browser-state.json');
 let state=await read(stateFile);
 if(state)requireValue(equal(state.identity,identity),'Continue this exact native scenario in its original browser output.');
 else{requireValue((await fs.readdir(output)).length===0,'Receive into an empty original browser output directory.');state={identity,files:{},started_at:new Date().toISOString()};await atomic(stateFile,json(state));}
 const save=()=>atomic(stateFile,json(state));
 const endpoint=(name,values={})=>name+'?'+new URLSearchParams({workspace:workspaceKey,...values});
 const verifyFiles=async()=>{for(const [name,item]of Object.entries(state.files)){const bytes=await fs.readFile(path.join(output,name));requireValue(bytes.length===item.bytes&&hash(bytes)===item.sha256,'The retained browser member changed: '+name);}};
 const keep=async(name,bytes)=>{const item={bytes:bytes.length,sha256:hash(bytes)};if(state.files[name])requireValue(equal(state.files[name],item),'The retained output edition changed: '+name);await atomic(path.join(output,name),bytes,{immutable:true});state.files[name]=item;await save();return item;};
 await verifyFiles();await ownerCheck();
 if(state.state==='complete')return state;
 const originalURL=new URL(page.url());
 requireValue(['http:','https:'].includes(originalURL.protocol),'Borrow the existing original operator Page.');
 requireValue(await page.locator('#workspace-select').inputValue()===workspaceKey,'Select this retained original Workspace in the existing operator.');
 const requestCheck=request=>{
  requireValue(request?.workspace===workspaceKey&&request.action==='scenario.save'&&typeof request.operation_id==='string','Preserve the original scenario save request.');
  requireValue(equal(documentOf(request.payload),documentOf(scenario)),'The original UI changed the complete authored scenario or mask source pair.');
 };
 const taskCheck=task=>{
  requireValue(task?.workspace===workspaceKey&&task.action==='scenario.save'&&equal(task.payload,state.request.payload),'The accepted native task belongs to another request.');
  requireValue(/^[a-f0-9]{64}$/.test(task.request_sha256||''),'Retain the original native task request hash.');
  if(state.request_sha256)requireValue(task.request_sha256===state.request_sha256,'The original native task request hash changed.');
  if(state.task_id)requireValue(task.id===state.task_id,'Preserve the same accepted original task.');
 };
 const waitFor=async(fn,label)=>{const until=Date.now()+120000;for(;;){await ownerCheck();const value=await fn();if(value)return value;if(Date.now()>=until)throw Error('Timed out while '+label);await page.waitForTimeout(120);}};
 const capture=async(name,locator=null)=>{
  if(state.files[name])return;
  try{const previous=await fs.readFile(path.join(output,name));requireValue(previous.length>8&&previous.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'The retained screenshot is not its complete PNG.');await keep(name,previous);return;}catch(error){if(error.code!=='ENOENT')throw error;}
  await ownerCheck();const bytes=locator?await locator.screenshot():await page.screenshot({fullPage:true});await keep(name,bytes);
 };
 const formSnapshot=async()=>page.locator('#operation-form').evaluate(form=>({
  controls:[...form.querySelectorAll('input,select,textarea,[contenteditable="true"]')].map((node,index)=>({
   index,tag:node.tagName.toLowerCase(),name:node.getAttribute('name')||'',type:node.getAttribute('type')||'',
   value:node.isContentEditable?node.textContent:node.value,checked:typeof node.checked==='boolean'?node.checked:null,
   selected:node.tagName==='SELECT'?[...node.selectedOptions].map(option=>option.value):null,
   files:node.type==='file'?[...node.files].map(file=>({name:file.name,size:file.size,type:file.type,lastModified:file.lastModified})):null
  })),
  patches:[...form.querySelectorAll('[data-patch]')].map(row=>JSON.parse(row.dataset.patchOriginal||'{}')),
  html:form.outerHTML
 }));
 const rawForm=snapshot=>({controls:snapshot.controls,patches:snapshot.patches});
 const retainForm=async()=>{
  const snapshot=await formSnapshot(),bytes=json(snapshot),name='form-custody-'+hash(bytes)+'.json';
  await keep(name,bytes);state.form_snapshot=rawForm(snapshot);state.form_snapshot_file=name;await save();
 };
 const guardForm=async()=>{
  const current=await formSnapshot();
  if(!state.form_snapshot||!equal(rawForm(current),state.form_snapshot)){
   const bytes=json(current);await keep('retained-author-form-'+hash(bytes)+'.json',bytes);
   throw Error('The current raw scenario form differs from this course’s retained form. Its complete controls and patch order are saved; keep it open for its author.');
  }
 };
 const changeForm=async action=>{await ownerCheck();await guardForm();await action();await retainForm();};
 const closeOwnedForm=async()=>{if(state.form_owned&&await page.locator('#form-dialog').evaluate(el=>el.open)){
  await ownerCheck();await guardForm();await retainForm();
  await page.locator('#form-dialog [data-action="form-close"]').first().click();
 }state.form_owned=false;await save();};
 const closeOwnedDetail=async()=>{if(state.detail_owned&&await page.locator('#detail-dialog').evaluate(el=>el.open)){
  const title=await page.locator('#detail-title').textContent(),body=await page.locator('#detail-body').textContent();
  requireValue(title.includes(scenario.title)||body.includes(scenario.title)||body.includes(run.id),'Keep the current source detail: it is not this operation’s retained native selection.');
  await ownerCheck();await page.locator('#detail-dialog [data-action="detail-close"]').click();
 }state.detail_owned=false;await save();};
 const navigate=async view=>{await ownerCheck();await page.locator('[data-view="'+view+'"]').first().click();};
 try{
  if(await page.locator('#form-dialog').evaluate(el=>el.open)){requireValue(state.form_owned,'Keep the current author form intact; continue after its original owner closes it.');await closeOwnedForm();}
  if(await page.locator('#detail-dialog').evaluate(el=>el.open)){requireValue(state.detail_owned,'Keep the current source detail intact; continue on the original owner’s available Page.');await closeOwnedDetail();}
  if(!state.original_view){state.original_view=/^#[a-z][a-z0-9-]*$/.test(originalURL.hash)?originalURL.hash:'#scenarios';await save();}
  await keep('native-control.json',json(control));
  const retained=await api(endpoint('/api/item',{kind:'scenarios',id:scenario.id}));
  requireValue(equal(documentOf(retained),documentOf(scenario)),'The installed native scenario differs from its complete receiving source.');
  const actualRun=await api(endpoint('/api/item',{kind:'runs',id:run.id}));
  requireValue(equal(actualRun.selection,run.selection),'The installed run changed its grid, profile, model or scenario.');
  const report=await api(endpoint('/api/scenario-footprints/report',{id:footprint.id}));
  requireValue(report.run_id===run.id&&equal(report.request,footprint.request),'Open the original source-bound native footprint.');
  await keep('installed-footprint.json',json({...report,_downloads:undefined}));
  await navigate('scenarios');
  const openForm=async()=>{
   await ownerCheck();state.form_owned=true;await save();
   await page.locator('[data-action="scenario-clone"][data-id="'+scenario.id+'"]').first().click();
   await page.locator('#form-dialog[open] [name="mask_collection"]').first().waitFor();
   await retainForm();
  };
  const validateRows=async()=>{
   const rows=page.locator('#patch-list [data-patch]');requireValue(await rows.count()===scenario.patches.length,'Every original ordered patch must remain visible.');
   for(let i=0;i<scenario.patches.length;i++){
    const row=rows.nth(i),patch=scenario.patches[i];
    requireValue(await row.locator('[name="mask_collection"]').inputValue()===(patch.source_collection_id||''),'A patch edition was silently changed.');
    requireValue(await row.locator('[name="mask_source"]').inputValue()===patch.mask_source_id,'A patch mask was silently changed.');
   }
  };
  if(!state.request){
   await openForm();await validateRows();
   const defaultSelect=page.locator('#form-dialog [name="collection"]');
   const alternate=pairs.find(pair=>pair[0]!==scenario.source_collection_id)[0];
   await changeForm(()=>defaultSelect.selectOption(alternate));
   const rows=page.locator('#patch-list [data-patch]');
   for(let i=0;i<scenario.patches.length;i++)if(scenario.patches[i].source_collection_id){
    requireValue(await rows.nth(i).locator('[name="mask_collection"]').inputValue()===scenario.patches[i].source_collection_id,'Changing the default retargeted an explicit patch edition.');
    requireValue(await rows.nth(i).locator('[name="mask_source"]').inputValue()===scenario.patches[i].mask_source_id,'Changing the default retargeted an explicit patch mask.');
   }
   await changeForm(()=>defaultSelect.selectOption(scenario.source_collection_id));
   for(let i=0;i<scenario.patches.length;i++)await changeForm(()=>rows.nth(i).locator('[name="mask_source"]').selectOption(scenario.patches[i].mask_source_id));
   await validateRows();
   await changeForm(()=>rows.nth(1).locator('[data-action="patch-earlier"]').click());
   await changeForm(()=>page.locator('#patch-list [data-patch]').first().locator('[data-action="patch-later"]').click());await validateRows();
   await changeForm(()=>page.locator('#form-dialog [name="title"]').fill(scenario.title));
   for(const width of[1440,390]){await page.setViewportSize({width,height:1000});await capture('scenario-editions-'+width+'.png',page.locator('#form-dialog'));for(let i=0;i<scenario.patches.length;i++){await page.locator('#patch-list [data-patch]').nth(i).scrollIntoViewIfNeeded();await capture('scenario-patch-'+(i+1)+'-'+width+'.png',page.locator('#patch-list [data-patch]').nth(i));}}
   let interceptedResolve,interceptedReject;const intercepted=new Promise((resolve,reject)=>{interceptedResolve=resolve;interceptedReject=reject;});intercepted.catch(()=>{});
   const routeHandler=async route=>{
    const request=route.request();let body;try{body=request.postDataJSON();}catch{}
    if(request.method()!=='POST'||body?.action!=='scenario.save'||body.workspace!==workspaceKey){await route.fallback();return;}
    try{await ownerCheck();requestCheck(body);requireValue(!state.request||equal(state.request,body),'Preserve the first original browser request.');state.request=body;await save();await route.continue();interceptedResolve();}
    catch(error){await route.abort().catch(()=>{});interceptedReject(error);}
   };
   await page.route('**/api/actions',routeHandler);
   let timer;
   try{await ownerCheck();await guardForm();await retainForm();await page.locator('#form-submit').click();await Promise.race([intercepted,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The original scenario save was not intercepted.')),120000);})]);}
   finally{clearTimeout(timer);await page.unroute('**/api/actions',routeHandler);}
  }
  requestCheck(state.request);await ownerCheck();
  let task=await api('/api/actions',{method:'POST',body:state.request});taskCheck(task);state.task_id=task.id;state.request_sha256=task.request_sha256;await save();
  task=await waitFor(async()=>{const current=await api(endpoint('/api/task',{id:state.task_id}));taskCheck(current);if(['failed','cancelled','interrupted'].includes(current.state))throw Error(current.error?.message||'Continue the existing failed native task before receiving.');return current.state==='complete'?current:null;},'receiving the same original scenario save');
  requireValue(/^[a-f0-9]{64}$/.test(task.result?.id||'')&&equal(documentOf(task.result),documentOf(scenario)),'The UI save did not retain the complete authored scenario and source pairs.');
  state.edited_scenario_id=task.result.id;await save();
  await keep('scenario-save-request.json',json(state.request));await keep('scenario-save-task.json',json(task));
  await closeOwnedForm();
  for(const width of[1440,390]){
   await page.setViewportSize({width,height:1000});await navigate('scenarios');await ownerCheck();state.detail_owned=true;await save();
   await page.locator('[data-action="item"][data-kind="scenarios"][data-id="'+state.edited_scenario_id+'"]').first().click();await page.locator('#detail-dialog[open]').waitFor();
   requireValue((await page.locator('#detail-body').textContent()).includes(scenario.reason),'The saved scenario reason is not visible.');
   await capture('saved-scenario-'+width+'.png',page.locator('#detail-dialog'));await closeOwnedDetail();
   await navigate('runs');await ownerCheck();state.detail_owned=true;await save();
   await page.locator('[data-action="item"][data-kind="runs"][data-id="'+run.id+'"]').first().click();await page.locator('#detail-dialog[open]').waitFor();await capture('native-run-'+width+'.png',page.locator('#detail-dialog'));
   await ownerCheck();await page.locator('[data-action="run-input-footprint"][data-id="'+run.id+'"]').first().click();state.detail_owned=false;await save();
   const surface=page.locator('.scenario-footprint-host');
   await surface.locator('#report:not([hidden])').waitFor();
   await waitFor(async()=>surface.locator('.preview-image').evaluate(img=>img.complete&&img.naturalWidth>0),'opening the exact native footprint image');
   requireValue((await surface.locator('#report').textContent()).includes(footprint.id),'The visible native footprint changed.');
   await capture('native-footprint-'+width+'.png');
   for(const details of await surface.locator('#report details').all()){if(!await details.evaluate(el=>el.open)){await ownerCheck();await details.locator('summary').click();}}
   await capture('native-footprint-sources-'+width+'.png');
  }
  const origin=new URL(page.url()).origin;
  for(const item of report._downloads||[]){
   requireValue(typeof item.artifact_id==='string'&&/^[a-z0-9_]+$/.test(item.artifact_id),'Retain the original native artifact ID.');
   const url=new URL(item.url,origin);requireValue(url.origin===origin,'Use the original authenticated file ticket.');
   const name='footprint-'+item.artifact_id+'-'+path.basename(item.filename||item.artifact_id);
   if(!state.files[name]){
    await ownerCheck();const response=await page.context().request.get(url.href);requireValue(response.ok(),'The original retained artifact could not be opened.');
    const bytes=await response.body();requireValue(bytes.length===item.bytes&&hash(bytes)===item.sha256,'The literal native download changed.');await keep(name,bytes);
   }
  }
  state.state='operated';state.producer_visual_review_required=true;await save();return state;
 }catch(error){state.error={name:error.name,message:error.message};await save();throw error;}
 finally{await closeOwnedForm();await closeOwnedDetail();if(state.original_view){await ownerCheck();await page.evaluate(hash=>{location.hash=hash;},state.original_view);}if(state.state==='operated'){state.state='complete';state.completed_at=new Date().toISOString();delete state.error;await save();}}
}
