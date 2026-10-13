/** Operate the original scientific configuration desk in an existing browser.
 * Copyright TokenJunkieLabs. The caller owns the app, Workspace, browser and
 * receiving lock. api(path, options) is its authenticated original API adapter.
 * This helper selects an EXISTING scientifically chosen revision; it creates
 * one ordinary setup task and returns its actual ID for receive_scientific_setup.
 */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const need=(ok,message)=>{if(!ok)throw Error(message);};
const q=(workspace,values)=>new URLSearchParams({workspace,...values}).toString();
const same=(a,b)=>canonical(a)===canonical(b);
async function atomic(filename,value){
 const temporary=filename+'.pending';await writeFile(temporary,JSON.stringify(value,null,2)+'\n');await rename(temporary,filename);
}
async function existing(filename){try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}

export async function receiveScientificConfiguration({page,api,workspace,workspaceDirectory,setupId,revisionProfileId,directory}){
 need(page&&typeof api==='function'&&workspace&&path.isAbsolute(workspaceDirectory||'')&&setupId&&revisionProfileId&&directory,'Supply the original page/API/Workspace key and absolute original Workspace directory, saved setup and selected existing revision.');
 const moduleSha=hash(await readFile(fileURLToPath(import.meta.url)));
 const root=path.resolve(directory,'scientific-configuration-'+moduleSha.slice(0,12));await mkdir(root,{recursive:true});
 const journalPath=path.join(root,'operation.json');
 const original=await api('/api/scientific-setup/detail?'+q(workspace,{setup_id:setupId}));
 need(original.workspace_key===workspace&&original.setup_id===setupId,'Open the original setup in its actual Workspace.');
 const base=original.specification;
 need(base?.method?.configuration,'Receive a setup captured with the complete configuration sheet.');
 const revised=await api('/api/scientific-setup/configuration?'+q(workspace,{profile_id:revisionProfileId,grid_id:base.selection.grid_id}));
 need(revised.workspace_key===workspace&&revised.configuration?.profile_id===revisionProfileId,'Open the exact selected existing revision.');
 need(revisionProfileId!==base.selection.profile_id,'Select the actual separate saved revision for this receiving journey.');
 const identity={schema:'upstate.scientific-configuration-browser/v1',workspace,workspace_directory:workspaceDirectory,setup_id:setupId,revision_profile_id:revisionProfileId,
  original_specification_sha256:original.setup.specification_sha256,revision_source_sha256:revised.configuration.table.sha256,module_sha256:moduleSha};
 let journal=await existing(journalPath);
 if(journal)need(same(journal.identity,identity),'Keep this receiving directory bound to its original setup/revision/source.');
 else{journal={identity,started_at:new Date().toISOString(),downloads:[],screenshots:[]};await atomic(journalPath,journal);}
 const keep=async values=>{Object.assign(journal,values);await atomic(journalPath,journal);};
 const selected={...clone(base.selection),title:base.selection.title+' · selected configuration revision',profile_id:revisionProfileId};
 const originalViewport=page.viewportSize(),originalUrl=page.url();
 const download=async(locator,name)=>{
  const [transfer]=await Promise.all([page.waitForEvent('download'),locator.click()]);
  const target=path.join(root,name);await transfer.saveAs(target);const body=await readFile(target);
  journal.downloads=journal.downloads.filter(row=>row.name!==name);journal.downloads.push({name,bytes:body.length,sha256:hash(body)});await keep({downloads:journal.downloads});return body;
 };
 const capture=async(name,width,height)=>{
  await page.setViewportSize({width,height});
  const target=path.join(root,name+'.png');await page.screenshot({path:target,fullPage:true});
  const bytes=await readFile(target);journal.screenshots=journal.screenshots.filter(row=>row.name!==name);journal.screenshots.push({name,path:target,sha256:hash(bytes),bytes:bytes.length});await keep({screenshots:journal.screenshots});
 };
 const poll=async task=>{
  await keep({task_id:task.id});
  while(task.state!=='complete'){
   if(['failed','interrupted','cancelled'].includes(task.state))throw Error('Open the retained original task '+task.id+': '+(task.error?.message||task.state));
   await page.waitForTimeout(700);task=await api('/api/task?'+q(workspace,{id:task.id}));
  }
  need(task.action==='scientific.setup.create'&&same(task.payload,selected),'The accepted task must preserve the entire selected setup payload.');
  await keep({task_id:task.id,accepted_operation_id:task.operation_id,setup_id:task.result.setup_id,result:task.result});
  return task;
 };
 try{
  if(!journal.request&&!journal.setup_id){
   const keys={pending:'upstate-scientific-setup:v1:'+workspace+':'+base.project.id+':operation',
    active:'upstate-scientific-setup:v1:'+workspace+':'+base.project.id+':active'};
   const retained=await page.evaluate(keys=>({pending:JSON.parse(localStorage.getItem(keys.pending)||'null'),active:JSON.parse(localStorage.getItem(keys.active)||'null')}),keys);
   if(retained.pending){
    const pending=retained.pending;
    need(pending.workspace===workspace&&pending.action==='scientific.setup.create'&&same(pending.payload,selected),'Reconcile the other original setup request before this receiving journey.');
    await keep({request:{workspace:pending.workspace,action:pending.action,payload:pending.payload,operation_id:pending.operation_id}});
   }else if(retained.active&&retained.active!==setupId){
    const active=await api('/api/scientific-setup/detail?'+q(workspace,{setup_id:retained.active}));
    if(same(active.setup.selection,selected))await keep({setup_id:active.setup_id,task_id:active.setup.operation_id,recovered_original_active:true});
   }
  }
  if(journal.setup_id){
   const saved=await api('/api/scientific-setup/detail?'+q(workspace,{setup_id:journal.setup_id}));
   need(same(saved.setup.selection,selected),'The original completed setup selection changed.');
  }else if(journal.request){
   need(journal.request.workspace===workspace&&journal.request.action==='scientific.setup.create'&&same(journal.request.payload,selected),'Retain the exact earlier setup request.');
   // Same original request ID, never a new setup mutation on continuation.
   await poll(await api('/api/actions',{method:'POST',body:journal.request}));
  }else{
   await page.locator('[data-view="scientific-setup"]').click();
   await page.locator('[data-setup-action="open"][data-setup-id="'+setupId+'"]').click();
   const originalPanel=page.locator('[data-setup-detail]');
   await originalPanel.locator('[data-config-profile="'+base.selection.profile_id+'"]').waitFor();
   const originalSearch=originalPanel.locator('[data-setup-config-search]');
   await originalSearch.fill('NO_MATCH_'+moduleSha);await originalPanel.getByText('No coefficient rows match.',{exact:false}).waitFor();
   await originalSearch.fill('');
   await capture('original-desktop',1440,1000);await capture('original-narrow',390,844);
   await originalPanel.locator('[data-setup-config-action="edit-profile"]').click();
   await page.locator('[data-pw-action="revise"]').waitFor();
   need((await page.locator('[data-pw-main]').innerText()).includes(base.method.profile.title),'The revision link must open the actual original profile.');
   await download(page.locator('[data-pw-action="export-table"]'),'original-profile.csv');
   await page.locator('[data-view="scientific-setup"]').click();
   await page.locator('[data-setup-action="open"][data-setup-id="'+setupId+'"]').click();
   await page.locator('[data-setup-action="edit"]').click();
   await page.locator('[data-setup-field="title"]').fill(selected.title);
   await page.locator('[data-setup-field="profile_id"]').selectOption(revisionProfileId);
   await page.locator('[data-setup-action="configuration"]').click();
   await page.locator('[data-setup-configuration] [data-config-profile="'+revisionProfileId+'"]').waitFor();
   await page.locator('[data-setup-action="preview"]').click();
   await page.locator('[data-setup-preview] [data-config-profile="'+revisionProfileId+'"]').waitFor();
   await page.locator('[data-setup-preview]').getByText('Compared with the opened saved setup',{exact:true}).waitFor();
   await capture('revised-desktop',1440,1000);await capture('revised-narrow',390,844);
   // The application retains its request before dispatch. Recover that same
   // pending record if a previous browser lifetime ended before our journal.
   const pendingKey='upstate-scientific-setup:v1:'+workspace+':'+base.project.id+':operation';
   const pending=await page.evaluate(key=>JSON.parse(localStorage.getItem(key)||'null'),pendingKey);
   if(pending){
    need(pending.workspace===workspace&&pending.action==='scientific.setup.create'&&same(pending.payload,selected),'Reconcile the other original setup request before receiving this revision.');
    await keep({request:{workspace:pending.workspace,action:pending.action,payload:pending.payload,operation_id:pending.operation_id}});
    await poll(await api('/api/actions',{method:'POST',body:journal.request}));
   }else{
    const [request]=await Promise.all([page.waitForRequest(request=>request.method()==='POST'&&new URL(request.url()).pathname==='/api/actions'&&request.postDataJSON()?.action==='scientific.setup.create'),
     page.locator('[data-setup-action="create"]').click()]);
    const actual=request.postDataJSON();
    need(actual.workspace===workspace&&actual.action==='scientific.setup.create'&&same(actual.payload,selected),'The browser sent a different setup selection.');
    await keep({request:actual});
    // Reconcile the same idempotent original action even if its browser
    // response was lost; an identical active task can be coalesced by server.
    await poll(await api('/api/actions',{method:'POST',body:actual}));
   }
  }
  const saved=await api('/api/scientific-setup/detail?'+q(workspace,{setup_id:journal.setup_id}));
  need(same(saved.setup.selection,selected)&&same(saved.specification.method.configuration,revised.configuration),'The saved setup must retain the exact selected revision/configuration.');
  need(same(saved.specification.observations,base.observations),'Original measurement rows/support must stay unchanged in this profile-only revision.');
  await keep({selection:selected,configuration:saved.specification.method.configuration,original_setup_id:setupId,original_review_id:original.review_id,revised_review_id:saved.review_id});
  await page.locator('[data-view="scientific-setup"]').click();
  await page.locator('[data-setup-action="refresh"]').click();
  await page.locator('[data-setup-action="open"][data-setup-id="'+journal.setup_id+'"]').click();
  const panel=page.locator('[data-setup-detail]');
  await panel.locator('[data-config-profile="'+revisionProfileId+'"]').waitFor();
  const csv=await download(panel.getByRole('link',{name:'Selected parameters, units and original methods'}),'selected-parameters.csv');
  need(csv.toString('utf8').includes('target,label,value,units,model,selected_for_grid,description,reference'),'Open the full actual native parameter CSV.');
  const html=await download(panel.getByRole('link',{name:'Readable scientific setup'}),'selected-setup.html');
  need(html.toString('utf8').includes('Original coefficient table'),'Open the actual complete readable setup attachment.');
  await download(panel.getByRole('link',{name:'Scientific setup specification'}),'selected-specification.json');
  const opened=JSON.parse(await readFile(path.join(root,'selected-specification.json'),'utf8'));
  need(same(opened,saved.specification),'The downloaded original specification changed.');
  await capture('retained-desktop',1440,1000);await capture('retained-narrow',390,844);
  const attachment=await page.context().newPage();
  try{
   await attachment.route('https://configuration-receiving.invalid/**',route=>route.fulfill({status:200,contentType:'text/html; charset=utf-8',body:html}));
   await attachment.goto('https://configuration-receiving.invalid/selected-setup.html');
   for(const [name,width,height]of[['attachment-desktop',1440,1000],['attachment-narrow',390,844]]){
    await attachment.setViewportSize({width,height});const target=path.join(root,name+'.png');await attachment.screenshot({path:target,fullPage:true});
    const body=await readFile(target);journal.screenshots.push({name,path:target,bytes:body.length,sha256:hash(body)});
   }
  }finally{await attachment.close();}
  await atomic(path.join(root,'selected-setup-request.json'),selected);
  await keep({completed_at:new Date().toISOString(),native_reopen:{module:'source_tools.receive_scientific_setup',workspace:workspaceDirectory,workspace_key:workspace,selection_file:path.join(root,'selected-setup-request.json'),operation_id:journal.task_id,output_directory:path.join(root,'native-export-reopen')},
   operator_instruction:'Continue the SAME actual setup with receive_scientific_setup --operation-id above, export/cold-reopen its full Workspace; personally view every captured desktop/narrow frame and every attachment.'});
  return clone(journal);
 }catch(error){await keep({error:{at:new Date().toISOString(),message:error.message,stack:error.stack}});throw error;}
 finally{if(originalViewport)await page.setViewportSize(originalViewport);if(page.url()!==originalUrl)await page.goto(originalUrl);}
}
