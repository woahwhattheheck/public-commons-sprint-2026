/** Complete authored synthesis on the existing receiving owner's Page and queue. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WORK_SCHEMA,stableJSON,validateDocument,validateWorking} from './web/scientific_synthesis_core.mjs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
const equal=(left,right)=>stableJSON(left)===stableJSON(right);
const copy=value=>JSON.parse(JSON.stringify(value));
const now=()=>new Date().toISOString();
const pair=value=>({source_collection_id:value.source_collection_id,source_id:value.source_id});
async function syncDirectory(directory){const file=await fs.open(directory,'r');try{await file.sync();}finally{await file.close();}}
async function atomic(filename,bytes,{immutable=false}={}){
 await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
 const temporary=filename+'.'+randomUUID()+'.pending';
 try{
  const file=await fs.open(temporary,'wx',0o600);try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  if(immutable){try{await fs.link(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;ensure((await fs.readFile(filename)).equals(Buffer.from(bytes)),'A retained receiving file differs: '+filename);}}
  else await fs.rename(temporary,filename);
  await syncDirectory(path.dirname(filename));
 }finally{await fs.rm(temporary,{force:true});}
}
async function exists(file){try{await fs.access(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
function validateInput(value){
 ensure(value?.schema==='upstate.scientific-synthesis-receiving-input/v1','Open the complete authored synthesis receiving input.');
 ensure(typeof value.operation_id==='string'&&value.operation_id&&typeof value.project_id==='string'&&value.project_id,'Retain the original receiving operation and project.');
 ensure(Array.isArray(value.documents)&&value.documents.length===2,'Retain the two complete authored editions.');
 for(const doc of value.documents)validateDocument(doc,{complete:true});
 const [first,second]=value.documents;
 ensure(first.series_id===second.series_id&&equal(first.sources,second.sources),'Both authored editions must use the same series and ordered original studies.');
 ensure(first.revision_name!==second.revision_name&&second.change_note.trim()&&!equal(first,second),'Keep a distinct, explained authored revision.');
 ensure(/^[a-f0-9]{64}$/.test(value.catalog_sha256),'Retain the actual reviewed original catalogue hash.');
 ensure(value.report&&typeof value.report.title==='string'&&value.report.title.trim(),'Retain the authored report title.');
 for(const key of ['name','organization','email'])ensure(typeof value.report.contact?.[key]==='string','Retain the report contact '+key+'.');
 return value;
}

/**
 * api is the existing owner's authenticated (route, optionalBody) function.
 * showTask is the existing owner's task-view function. No browser or service is started.
 * mode "reopened" reads the parent's independently restored original Workspace.
 */
export async function receiveScientificSynthesis(page,{
 control,workspace,api,showTask,ownerCheck,outputDirectory,mode='operate',taskTimeoutSeconds=14400
}){
 validateInput(control);
 ensure(typeof api==='function'&&typeof showTask==='function'&&typeof ownerCheck==='function','Use the existing owner, authenticated API and task view.');
 ensure(['operate','reopened'].includes(mode),'Select original operate or independent reopened mode.');
 const output=path.resolve(outputDirectory);await fs.mkdir(output,{recursive:true,mode:0o700});
 const statePath=path.join(output,'synthesis-receiving.json');
 const selection={schema:control.schema,operation_id:control.operation_id,project_id:control.project_id,input_sha256:sha(stableJSON(control))};
 let state=await exists(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):
  {schema:'upstate.scientific-synthesis-receiving/v1',selection,original_workspace:workspace,phases:{},artifacts:{},source_editions:[],attempts:[]};
 ensure(equal(state.selection,selection),'Resume the same complete authored receiving input.');
 if(mode==='operate')ensure(state.original_workspace===workspace,'Continue writing only in the original Workspace.');
 const sourceSha=sha(await fs.readFile(fileURLToPath(import.meta.url)));
 if(!state.source_editions.some(x=>x.sha256===sourceSha))state.source_editions.push({sha256:sourceSha,first_seen_at:now()});
 const attempt={mode,workspace,source_sha256:sourceSha,started_at:now()};state.attempts.push(attempt);
 let writes=Promise.resolve();
 const checkpoint=()=>{const bytes=Buffer.from(JSON.stringify(state,null,2)+'\n');writes=writes.catch(()=>{}).then(()=>atomic(statePath,bytes));return writes;};
 const endpoint=(route,params={})=>route+'?'+new URLSearchParams({workspace,...params});
 const read=(route,params={})=>api(endpoint(route,params));
 const panel=()=>page.locator('.scientific-synthesis');
 const action=name=>panel().locator('[data-synthesis-action="'+name+'"]');
 const report=()=>page.locator('.scientific-report-editions');
 const reportAction=name=>report().locator('[data-scientific-report-action="'+name+'"]');
 async function original(){await ownerCheck();const result=await read('/api/source-reports/synthesis-catalog');ensure(result.workspace_key===workspace&&result.project_id===control.project_id,'The original project or Workspace changed.');return result;}
 async function artifact(name,bytes){
  ensure(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(name),'Keep artifacts inside this receiving edition.');
  const file=path.join(output,name),body=Buffer.from(bytes),record={path:name,bytes:body.length,sha256:sha(body)};
  if(state.artifacts[name])ensure(equal(state.artifacts[name],record),'The retained artifact has a different identity: '+name);
  await atomic(file,body,{immutable:true});state.artifacts[name]=record;await checkpoint();return record;
 }
 async function retained(name){
  const row=state.artifacts[name];if(!row)return null;
  const body=await fs.readFile(path.join(output,name));ensure(body.length===row.bytes&&sha(body)===row.sha256,'A retained receiving artifact changed: '+name);return body;
 }
 async function capture(name,locator=null){
  if(await retained(name))return state.artifacts[name];
  await ownerCheck();const body=locator?await locator.screenshot():await page.screenshot({fullPage:true});return artifact(name,body);
 }
 async function closeDialogs(){
  for(const [selector,button]of [['#form-dialog','form-close'],['#detail-dialog','detail-close']]){
   const dialog=page.locator(selector);if(await dialog.count()&&await dialog.evaluate(el=>el.open))await dialog.locator('[data-action="'+button+'"]').first().click();
  }
 }
 async function sources(){
  await ownerCheck();await closeDialogs();
  const select=page.locator('#workspace-select');if(await select.inputValue()!==workspace)await select.selectOption(workspace);
  await page.locator('[data-view="sources"]').click();
  await panel().waitFor();await action('new').waitFor();
  await page.waitForFunction(()=>{const n=document.querySelector('.scientific-synthesis [data-synthesis-action="new"]');return n&&(!n.disabled||!!document.querySelector('.scientific-synthesis [data-synthesis-action="recover"]:not(:disabled)'));});
 }
 async function working(){
  // Read the actual committed IndexedDB document; its public portable download is also exercised below.
  const value=await page.evaluate(async ws=>{
   const tab=sessionStorage.getItem('scientific-synthesis-tab');if(!tab)return null;
   return await new Promise((resolve,reject)=>{
    const req=indexedDB.open('tjlabs-scientific-synthesis-v1',1);
    req.onerror=()=>reject(req.error);req.onsuccess=()=>{const db=req.result;
     if(!db.objectStoreNames.contains('working')){db.close();resolve(null);return;}
     const tx=db.transaction('working','readonly'),r=tx.objectStore('working').get(ws+':'+tab);let value;
     r.onsuccess=()=>{value=r.result};tx.oncomplete=()=>{db.close();resolve(value||null);};tx.onerror=()=>{db.close();reject(tx.error);};};
   });
  },workspace);
  return value?validateWorking(value.schema==='upstate.scientific-synthesis-browser/v1'?value.working:value):null;
 }
 async function ready(){
  await page.waitForFunction(()=>{const n=document.querySelector('.scientific-synthesis [data-synthesis-action="refresh"]');return n&&!n.disabled;});
 }
 async function openWorking(value){
  validateWorking(value);await ownerCheck();
  const current=await working();
  if(current?.pending){ensure(equal(current.pending,value.pending),'Recover the original pending request before replacing this draft.');return;}
  await panel().locator('[data-synthesis-open]').setInputFiles({name:'scientific-synthesis-working.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(value))});
  await page.waitForFunction(expected=>document.querySelector('.scientific-synthesis [data-synthesis-field="title"]')?.value===expected,value.document.title);
  await ready();
  // A committed read transaction follows the UI's write transaction.
  let accepted=await working();const deadline=Date.now()+60000;
  while(!accepted||!equal(accepted.document,value.document)||!equal(accepted.pending,value.pending)){
   ensure(Date.now()<deadline,'The complete selected working copy was not retained.');
   await page.waitForTimeout(100);accepted=await working();
  }
  return accepted;
 }
 async function downloadJSON(name,click,check){
  let body=await retained(name);
  if(!body){await ownerCheck();const pending=page.waitForEvent('download');await click();const event=await pending;
   ensure(await event.failure()===null,'The actual JSON download failed.');const temporary=path.join(output,'.download-'+randomUUID());
   try{await event.saveAs(temporary);body=await fs.readFile(temporary);check(JSON.parse(body.toString('utf8')));await artifact(name,body);}
   finally{await fs.rm(temporary,{force:true});}
  }check(JSON.parse(body.toString('utf8')));return JSON.parse(body.toString('utf8'));
 }
 async function ticketDownload(ticket,name){
  let body=await retained(name);
  if(!body){
   await ownerCheck();const link=page.locator('a[href='+JSON.stringify(ticket.url+(ticket.url.includes('?')?'&':'?')+'download=1')+']').first();
   await link.waitFor();const pending=page.waitForEvent('download');await link.click();const event=await pending;
   ensure(await event.failure()===null,'The original ticket download failed.');
   const temporary=path.join(output,'.download-'+randomUUID());
   try{await event.saveAs(temporary);body=await fs.readFile(temporary);ensure(body.length===ticket.bytes&&sha(body)===ticket.sha256,'The actual downloaded source differs.');await artifact(name,body);}
   finally{await fs.rm(temporary,{force:true});}
  }
  ensure(body.length===ticket.bytes&&sha(body)===ticket.sha256,'The retained download differs from its original ticket.');
  return state.artifacts[name];
 }
 function checkTask(task,request){
  ensure(task&&typeof task.id==='string'&&task.workspace===request.workspace&&task.action===request.action&&equal(task.payload,request.payload),'The accepted original task has another complete request.');
  // Original Operator.submit may coalesce active identical requests and retain an operation alias.
  // The accepted task ID and complete body are authoritative; task.operation_id need not equal the caller alias.
 }
 async function waitTask(phase){
  const deadline=Date.now()+taskTimeoutSeconds*1000;
  while(true){
   await ownerCheck();const result=await api('/api/task?'+new URLSearchParams({id:phase.task_id})),task=result.task||result;
   checkTask(task,phase.request);phase.last_state=task.state;phase.last_observed_at=now();await checkpoint();
   if(task.state==='complete'){phase.result=copy(task.result);phase.task=copy(task);await checkpoint();return task;}
   ensure(!['failed','cancelled','interrupted'].includes(task.state),'Resume the existing native task '+task.id+' after its reported '+task.state+' result: '+JSON.stringify(task.error||{}));
   ensure(Date.now()<deadline,'The existing original task remains active: '+task.id);await page.waitForTimeout(1000);
  }
 }
 async function uiTask(name,actionName,click,check,{drop=false}={}){
  let phase=state.phases[name]||(state.phases[name]={action:actionName,started_at:now()});
  ensure(phase.action===actionName,'The retained phase names another native action.');
  if(phase.request){ensure(phase.request.action===actionName,'The retained complete request names another native action.');check(phase.request);}
  if(phase.request&&(!drop||phase.response_loss_exercised)){
   const task=await api('/api/actions',phase.request);const accepted=task.task||task;checkTask(accepted,phase.request);
   ensure(!phase.task_id||phase.task_id===accepted.id,'The original task identity changed on response recovery.');
   phase.task_id=accepted.id;await checkpoint();return waitTask(phase);
  }
  let matched=false,resolveDone,rejectDone;
  const done=new Promise((resolve,reject)=>{resolveDone=resolve;rejectDone=reject;});done.catch(()=>{});
  const routePattern='**/api/actions';
  const handler=async route=>{
   let settled=false;
   try{
    const request=route.request().postDataJSON();
    if(matched||request?.action!==actionName){await route.continue();return;}
    matched=true;await ownerCheck();check(request);
    if(phase.request)ensure(equal(request,phase.request),'UI recovery changed the original complete request.');
    else phase.request=copy(request);
    if(actionName==='source-reports.synthesis-save'){
     const value=await working();ensure(value?.pending&&equal(value.pending.payload,request.payload),'The actual UI did not commit its original pending document before dispatch.');
     phase.working=copy(value);
    }
    await checkpoint();await ownerCheck();
    const response=await route.fetch({timeout:60000}),value=await response.json(),task=value.task||value;
    ensure(response.ok(),'The original queue rejected this request: '+JSON.stringify(value));checkTask(task,request);
    phase.task_id=task.id;phase.accepted_task=copy(task);await checkpoint();
    await waitTask(phase);
    if(drop){await route.abort('failed');settled=true;phase.response_loss_exercised=true;phase.response_lost_after_native_completion=now();}
    else{await route.fulfill({response});settled=true;}
    await checkpoint();resolveDone(phase.task);
   }catch(error){if(!settled)try{await route.abort('failed');}catch{}rejectDone(error);}
  };
  await page.route(routePattern,handler);
  let timer;
  try{
   await ownerCheck();await click();
   return await Promise.race([done,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('The original UI request has not completed; resume its retained request.')),taskTimeoutSeconds*1000);})]);
  }finally{clearTimeout(timer);await page.unroute(routePattern,handler);}
 }
 async function checkEdition(collection,document,operation){
  const value=await read('/api/source-reports/synthesis-edition',{collection_id:collection});
  ensure(value.project_id===control.project_id&&value.collection_id===collection&&equal(value.record.document,document),'The complete authored source edition differs.');
  if(operation)ensure(value.record.operation_id===operation,'The authored source has another original request.');
  ensure(value.record.catalog.catalog_sha256===control.catalog_sha256,'The authored chapter lost its selected original catalogue.');
  return value;
 }
 async function finishUI(phase){
  await ready();let value=await working();
  if(value?.pending){
   ensure(equal(value.pending.payload,phase.request.payload),'The UI pending source has another request.');
   await ownerCheck();await action('recover').click();await ready();
   const deadline=Date.now()+60000;
   while((value=await working())?.pending){ensure(Date.now()<deadline,'The original saved edition has not reopened in its editor.');await page.waitForTimeout(100);}
  }
  ensure(value&&equal(value.document,phase.request.payload.document)&&value.base_collection_id===phase.result.collection_id,'The complete original source receipt did not reach the editor.');
  return value;
 }
 async function openSaved(collection){
  await ownerCheck();await action('refresh').click();await ready();
  await panel().locator('[data-synthesis-action="open"][data-id="'+collection+'"]').click();await ready();
 }
 async function receiveEdition(name,document,base){
  let phase=state.phases[name];
  const refs=await api(endpoint('/api/source-reports/synthesis-references'),{sources:document.sources});
  ensure(refs.project_id===control.project_id&&refs.catalog.catalog_sha256===control.catalog_sha256,'The original reference catalogue differs from this authored input.');
  let value={schema:WORK_SCHEMA,project_id:control.project_id,document:copy(document),base_collection_id:base,catalog:refs.catalog,pending:null,import_history:[]};
  if(phase?.working)value=copy(phase.working);
  if(!phase?.request){
   if(name==='first'&&state.artifacts['unfinished-working.json']){
    value=JSON.parse((await retained('unfinished-working.json')).toString('utf8'));
   }
   await openWorking(value);
   if(name==='first'){
    if(!state.artifacts['unfinished-working.json']){
     await action('add').filter({hasText:'Add next work'}).click();await ready();
     await downloadJSON('unfinished-working.json',()=>action('download').click(),v=>{
      validateWorking(v);ensure(v.document.sections.length===document.sections.length+1&&v.document.sections.at(-1).text==='','Retain the complete unfinished authored section.');
     });
    }
    const unfinished=JSON.parse((await retained('unfinished-working.json')).toString('utf8'));
    await page.reload({waitUntil:'domcontentloaded'});await sources();await openWorking(unfinished);
    const tail=unfinished.document.sections.at(-1);
    await capture('unfinished-authoring.png',panel());
    await panel().locator('[data-synthesis-action="remove"][data-section="'+tail.id+'"]').click();await ready();
    let committed=await working();const removalDeadline=Date.now()+60000;
    while(!committed||committed.pending||!equal(committed.document,document)){
     ensure(Date.now()<removalDeadline,'The complete authored edition was not committed after removing unfinished work.');
     await page.waitForTimeout(100);committed=await working();
    }
    ensure(equal(committed.document,document)&&!committed.pending,'Unfinished-work reopening changed the complete authored edition.');
   }
  }else if(!phase.response_loss_exercised&&name==='first'){
   await openWorking(value);
  }
  const task=await uiTask(name,'source-reports.synthesis-save',()=>action(phase?.request?'recover':'save').click(),request=>{
   ensure(request.workspace===workspace&&equal(request.payload.document,document)&&request.payload.base_collection_id===base&&request.payload.catalog_sha256===control.catalog_sha256,'The actual source save differs from the reviewed whole document.');
   ensure(request.operation_id===request.payload.operation_id,'The native source and original queue request IDs differ.');
  },{drop:name==='first'});
  phase=state.phases[name];
  if(name==='first'&&!phase.ui_recovered){
   await page.reload({waitUntil:'domcontentloaded'});await sources();
   const current=await working();
   if(!current?.pending&&(!current||current.base_collection_id!==phase.result.collection_id))await openWorking(phase.working);
   await finishUI(phase);phase.ui_recovered=true;await checkpoint();
  }else if(!(await working())?.pending&&phase.result)await openSaved(phase.result.collection_id);
  else await finishUI(phase);
  const edition=await checkEdition(phase.result.collection_id,document,phase.request.payload.operation_id);
  phase.received_revision_id=edition.record.revision_id;phase.history_count=edition.history.length;await checkpoint();
  await downloadJSON(name+'-working.json',()=>action('download').click(),v=>{validateWorking(v);ensure(equal(v.document,document)&&v.base_collection_id===edition.collection_id&&!v.pending,'The downloaded working copy differs from the saved chapter.');});
  await downloadJSON(name+'-edition.json',()=>action('download-edition').click(),v=>ensure(equal(v.record,edition.record)&&equal(v.history,edition.history),'The complete authored edition download differs.'));
  const decorated=await api('/api/task?'+new URLSearchParams({id:task.id}));const full=decorated.task||decorated;checkTask(full,phase.request);
  await showTask(task.id);
  ensure(full._downloads?.length,'Open the original task view to receive its complete source ZIP.');
  for(let i=0;i<full._downloads.length;i++)await ticketDownload(full._downloads[i],name+'-source-'+i+'.zip');
  await closeDialogs();await sources();await openSaved(edition.collection_id);
  for(const width of [1440,390]){await ownerCheck();await page.setViewportSize({width,height:1000});await capture(name+'-chapter-'+width+'.png',panel());}
  await page.setViewportSize({width:1440,height:1000});
  return edition;
 }
 async function reportCourse(edition){
  const recovery=reportAction('recover');
  if(await recovery.count()){await ownerCheck();await recovery.click();await page.waitForFunction(()=>!document.querySelector('[data-scientific-report-action="recover"]'));await closeDialogs();}
  await openSaved(edition.collection_id);await ownerCheck();await action('compose').click();
  for(const [field,value]of Object.entries({title:control.report.title,...control.report.contact}))await report().locator('[data-scientific-report-field="'+field+'"]').fill(value);
  await reportAction('preview').click();await reportAction('render').waitFor();await page.waitForFunction(()=>!document.querySelector('[data-scientific-report-action="render"]').disabled);
  await uiTask('render','source-reports.render',()=>reportAction('render').click(),request=>{
   ensure(request.workspace===workspace&&equal(request.payload.sources,[edition.source,...edition.record.document.sources].map(pair)),'The actual report selection lost its authored chapter or original studies.');
  });
  await page.waitForFunction(()=>{const n=document.querySelector('[data-scientific-report-action="preview"]');return n&&!n.disabled;});
  const phase=state.phases.render,id=phase.result.scientific_report_edition_id;
  ensure(id,'The original renderer did not retain its edition identity.');
  await closeDialogs();await sources();await reportAction('refresh').click();
  await report().locator('[data-scientific-report-action="open"][data-id="'+id+'"]').click();
  const detail=await read('/api/source-reports/scientific-edition',{id});
  ensure(detail.edition.state==='complete'&&equal(detail.edition.sources.map(pair),[edition.source,...edition.record.document.sources].map(pair)),'The saved rendered report has another ordered original source set.');
  await page.waitForFunction(({url,title})=>{const f=[...document.querySelectorAll('[data-scientific-report-document-host] iframe')].find(f=>!f.hidden&&f.getAttribute('src')===url);return !!f?.contentDocument?.body?.textContent.includes(title);},{url:detail.viewer_url,title:control.report.title});
  for(const width of [1440,390]){
   await ownerCheck();await page.setViewportSize({width,height:1000});
   await capture('scientific-report-'+width+'.png',report().locator('[data-scientific-report-document-host]'));
   const frame=page.frames().find(f=>f.url().endsWith(detail.viewer_url));ensure(frame,'The selected native scientific report frame is absent.');
   const headings=frame.locator('h2,h3');for(let index=0;index<await headings.count();index++){await ownerCheck();await headings.nth(index).scrollIntoViewIfNeeded();await capture('scientific-report-'+width+'-section-'+String(index).padStart(4,'0')+'.png',report().locator('[data-scientific-report-document-host]'));}
  }
  await page.setViewportSize({width:1440,height:1000});
  for(let i=0;i<detail.files.length;i++){
   const file=detail.files[i],extension=path.extname(file.path).replace(/[^A-Za-z0-9.]/g,'')||'.bin';
   await ticketDownload(file,'report-file-'+String(i).padStart(4,'0')+extension);
  }
  state.report={id,detail:copy(detail)};await checkpoint();
  await uiTask('report-export','source-reports.export',()=>reportAction('export').click(),request=>ensure(request.workspace===workspace&&request.payload.id===id,'Export the exact rendered report.'));
  await closeDialogs();await sources();await reportAction('refresh').click();await report().locator('[data-scientific-report-action="open"][data-id="'+id+'"]').click();
  const exported=await read('/api/source-reports/scientific-edition',{id});ensure(exported.archive,'The original complete report ZIP is absent.');
  await ticketDownload(exported.archive,'complete-scientific-report.zip');state.report.export=copy(exported.archive);await checkpoint();
 }
 try{
  await checkpoint();await artifact('authored-course-input.json',Buffer.from(JSON.stringify(control,null,2)+'\n'));
  await original();await sources();
  if(mode==='operate'){
   const first=await receiveEdition('first',control.documents[0],null);
   const second=await receiveEdition('second',control.documents[1],first.collection_id);
   ensure(second.history.length===2&&equal(second.history[0],first.record),'The actual authored revision lost its complete original history.');
   // Replaying the first original request after the later edition must return its historical result.
   const replay=await api('/api/actions',state.phases.first.request),accepted=replay.task||replay;checkTask(accepted,state.phases.first.request);
   ensure(accepted.id===state.phases.first.task_id,'The original historical task was duplicated.');
   const received=await waitTask(state.phases.first);ensure(received.result.collection_id===first.collection_id,'Historical request replay advanced to another edition.');
   state.historical_replay={task_id:accepted.id,collection_id:first.collection_id,later_collection_id:second.collection_id};await checkpoint();
   await reportCourse(second);state.operated=true;state.operated_at=now();
  }else{
   ensure(state.operated&&state.report&&state.phases.second?.result,'Reopen the original completed authored course.');
   for(const [name,document]of [['first',control.documents[0]],['second',control.documents[1]]]){
    const phase=state.phases[name],edition=await checkEdition(phase.result.collection_id,document,phase.request.payload.operation_id);
    ensure(edition.record.revision_id===phase.received_revision_id,'The independently restored authored edition differs.');
    await openSaved(edition.collection_id);await capture('cold-'+name+'-chapter.png',panel());
   }
   const detail=await read('/api/source-reports/scientific-edition',{id:state.report.id});
   ensure(equal(detail.edition,state.report.detail.edition),'The independently restored rendered edition differs.');
   await reportAction('refresh').click();await report().locator('[data-scientific-report-action="open"][data-id="'+state.report.id+'"]').click();
   await page.waitForFunction(({url,title})=>{const f=[...document.querySelectorAll('[data-scientific-report-document-host] iframe')].find(f=>!f.hidden&&f.getAttribute('src')===url);return !!f?.contentDocument?.body?.textContent.includes(title);},{url:detail.viewer_url,title:control.report.title});
   await capture('cold-scientific-report.png',report().locator('[data-scientific-report-document-host]'));
   for(const name of Object.keys(state.artifacts))await retained(name);
   state.reopened={workspace,project_id:control.project_id,at:now()};state.complete=true;
  }
  attempt.completed_at=now();await checkpoint();
  return {progress:statePath,operation_id:control.operation_id,project_id:control.project_id,operated:!!state.operated,complete:!!state.complete,report_id:state.report?.id,artifact_count:Object.keys(state.artifacts).length};
 }catch(error){attempt.error={name:error.name,message:error.message,stack:error.stack};attempt.failed_at=now();await checkpoint();throw error;}
}
