#!/usr/bin/env node
/** Operate one private browser against the existing original Eco operator. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
const config=JSON.parse(fs.readFileSync(args.config,'utf8')),originalOut=path.resolve(config.output),recaptureOnly=args.recapture==='yes';
let out=originalOut;
if(recaptureOnly)out=path.join(originalOut,'recaptures',crypto.randomUUID());
fs.mkdirSync(out,{recursive:true});
const canonical=v=>JSON.stringify(v===null||typeof v!=='object'?v:Array.isArray(v)?v.map(sorted):sorted(v));
function sorted(v){if(v===null||typeof v!=='object')return v;if(Array.isArray(v))return v.map(sorted);return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sorted(v[k])]));}
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const binding=sha(Buffer.from(canonical(config)));
const ident=f=>{const b=fs.readFileSync(f);return {bytes:b.length,sha256:sha(b)};};
function atomic(f,b,immutable=false){
 fs.mkdirSync(path.dirname(f),{recursive:true});b=Buffer.isBuffer(b)?b:Buffer.from(b);
 if(immutable&&fs.existsSync(f)){if(!fs.readFileSync(f).equals(b))throw Error('Retained artifact differs: '+f);return;}
 const temp=f+'.pending-'+process.pid;const fd=fs.openSync(temp,'w',0o600);try{fs.writeFileSync(fd,b);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 fs.renameSync(temp,f);const parent=fs.openSync(path.dirname(f),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}
}
const statePath=path.join(out,'browser-state.json');
const originalCompletion=recaptureOnly?JSON.parse(fs.readFileSync(path.join(originalOut,'result.json'),'utf8')):null;
if(recaptureOnly&&(originalCompletion.binding!==binding||!originalCompletion.closed))throw Error('Read-only recapture requires the original completed browser result.');
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{schema:'upstate.joint-delivery-browser-state/v1',binding,steps:{},artifacts:[]};
if(state.binding!==binding)throw Error('Use the exact original browser case');
const checkpoint=()=>atomic(statePath,canonical(state)+'\n');
function record(relative){const item={file:relative,...ident(path.join(out,relative))};const prior=state.artifacts.find(x=>x.file===relative);if(prior&&canonical(prior)!==canonical(item))throw Error('Retained artifact changed: '+relative);if(!prior)state.artifacts.push(item);checkpoint();return item;}
function keep(relative,raw){atomic(path.join(out,relative),raw,true);return record(relative);}
function verify(){for(const a of state.artifacts){const f=path.join(out,a.file);if(a.file.toLowerCase().endsWith('.png'))continue;if(!fs.existsSync(f)||canonical(ident(f))!==canonical({bytes:a.bytes,sha256:a.sha256}))throw Error('Original deliverable changed: '+a.file);}}
if(state.complete){verify();const r=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));if(r.binding!==binding||!r.closed)throw Error('Reconcile the original browser closure');process.stdout.write(JSON.stringify(r)+'\n');process.exit(0);}
verify();
const snapshotFile=config.downloads.find(x=>x.file.endsWith('/Pinned_Joint_Delivery_Snapshot.json'));
if(!snapshotFile)throw Error('Retain the complete original allocation snapshot.');
const snapshotRaw=fs.readFileSync(path.join(config.root,snapshotFile.file));
if(snapshotRaw.length!==snapshotFile.bytes||sha(snapshotRaw)!==snapshotFile.sha256)throw Error('The original saved snapshot changed.');
const pinned=JSON.parse(snapshotRaw);
if(pinned.review_id!==config.review_id||pinned.project.id!==config.project_id||pinned.selected_response_id!==(config.response_id??null)||canonical(pinned.definition)!==canonical(config.definition))throw Error('The browser input differs from the selected saved review.');
const secret=fs.readFileSync(config.capability_file,'utf8').trim();if(!secret)throw Error('Existing original operator capability is missing');
const loaded=await import(pathToFileURL(args.playwright).href);const playwright=loaded.default||loaded;
let context=null,closing=null,signalError=null,closeError=null,page=null;
async function close(){
 if(!context)return;if(closing)return closing;
 closing=context.close().catch(e=>{closeError=e;throw e;});return closing;
}
for(const name of ['SIGINT','SIGTERM'])process.on(name,()=>{signalError=new Error('Interrupted '+name);void close().catch(()=>{});});
function live(){if(signalError)throw signalError;if(closeError)throw closeError;}
async function step(name,operation){
 live();if(state.steps[name])return state.steps[name];const result=await operation();live();state.steps[name]=result??true;checkpoint();return result;
}
const root=()=>page.locator('.joint-delivery').first();
const button=action=>page.locator('[data-jd-action="'+action+'"]').first();
async function ready(){await page.waitForFunction(()=>{const e=document.querySelector('[data-jd-field="title"]');return e&&!e.closest('[aria-busy="true"]');});}
async function openOperator(){
 page=await context.newPage();await page.goto(config.operator_url+'/#joint-delivery',{waitUntil:'domcontentloaded'});
 await page.locator('[data-view="joint-delivery"]').first().waitFor({state:'visible'});
 await page.locator('[data-view="joint-delivery"]').first().click();await ready();live();
}
async function errorCheck(){
 const errors=await page.locator('.joint-delivery > .jd-error, .joint-delivery [role="status"].jd-error').allTextContents();
 if(errors.some(x=>x.trim()))throw Error(errors.join('\n'));
}
async function download(relative,action,wanted=null){
 const dest=path.join(out,relative);
 if(!fs.existsSync(dest)){
  const event=page.waitForEvent('download');await action();const d=await event;
  const failure=await d.failure();if(failure)throw Error(failure);
  const temp=dest+'.download';fs.mkdirSync(path.dirname(dest),{recursive:true});await d.saveAs(temp);
  const bytes=fs.readFileSync(temp);atomic(dest,bytes,true);fs.unlinkSync(temp);
 }
 const item=record(relative);
 if(wanted&&(item.bytes!==wanted.bytes||item.sha256!==wanted.sha256))throw Error('Actual browser attachment differs: '+relative);
 return dest;
}
async function screen(relative){
 const prior=state.artifacts.find(x=>x.file===relative);if(prior)return prior;
 if(!fs.existsSync(path.join(out,relative))){await page.screenshot({path:path.join(out,relative),fullPage:true});}
 return record(relative);
}
async function captureAll(viewer,prefix){
 const start=await viewer.evaluate(()=>({x:scrollX,y:scrollY}));
 const info=await viewer.evaluate(()=>({height:Math.max(document.body.scrollHeight,document.documentElement.scrollHeight),view:innerHeight,width:innerWidth,content:document.documentElement.scrollWidth}));
 const offsets=[];for(let y=0;y<info.height;y+=Math.max(1,Math.floor(info.view*.82)))offsets.push(Math.min(y,Math.max(0,info.height-info.view)));
 for(const [i,y] of [...new Set(offsets)].entries()){
  live();await viewer.evaluate(top=>scrollTo(0,top),y);
  const name=prefix+'-'+String(i+1).padStart(3,'0')+'.png';
  if(!state.artifacts.some(x=>x.file===name)){
   if(!fs.existsSync(path.join(out,name)))await viewer.screenshot({path:path.join(out,name),fullPage:false});
   record(name);
  }
 }
 await viewer.evaluate(v=>scrollTo(v.x,v.y),start);
 keep(prefix+'-visible-text.txt',await viewer.locator('body').innerText());
 return info;
}
async function openEverySavedSection(){
 for(const item of await page.locator('[data-jd-saved-allocation], [data-jd-saved-input], [data-jd-saved-profile]').all()){
  if(!(await item.evaluate(e=>e.open)))await item.locator(':scope > summary').click();
 }
}
async function imported(file){
 await page.locator('[data-jd-file="working"]').setInputFiles(file);await ready();await errorCheck();
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 await page.waitForFunction(expected=>document.querySelector('[data-jd-field="title"]')?.value===expected.title&&document.querySelector('[data-jd-field="notes"]')?.value===expected.notes,value.definition);
 return value;
}
async function saved(){
 await button('refresh').click();await ready();
 await page.locator('[data-jd-action="open"][data-id="'+config.review_id+'"]').click();
 await page.locator('[data-jd-saved="'+config.review_id+'"]').waitFor({state:'visible'});
 if(config.response_id){await page.locator('[data-jd-action="response-open"][data-id="'+config.response_id+'"]').click();}
 else await page.locator('[data-jd-action="response-open"][data-id=""]').click();
 await page.waitForFunction(({id,response})=>{
  const e=document.querySelector('[data-jd-saved="'+id+'"]');return e&&e.innerText.includes('Selected returned response '+(response||'none'));
 },{id:config.review_id,response:config.response_id});
 await errorCheck();
}
async function closePage(owned,primary){try{await owned.close();}catch(error){if(primary){(primary.cleanupErrors??=[]).push(String(error?.stack||error));}else throw error;}}
async function inspectAttachments(downloadRoot){
  for(const wanted of config.downloads.filter(x=>x.file.includes('/evidence/'))){
   const file=path.join(downloadRoot,'downloads',path.basename(wanted.file)),raw=fs.readFileSync(file);
   if(raw.length!==wanted.bytes||sha(raw)!==wanted.sha256)throw Error('Original evidence attachment differs');
   const text=new TextDecoder('utf-8',{fatal:true}).decode(raw);
   if(file.endsWith('.json')&&canonical(JSON.parse(text))!==canonical(pinned))throw Error('The complete downloaded JSON differs from the saved review');
   const viewer=await context.newPage();let viewerError=null;try{
    if(file.endsWith('.html')){
     await viewer.goto(pathToFileURL(file).href,{waitUntil:'load'});
     for(const d of await viewer.locator('details').all())if(!(await d.evaluate(e=>e.open)))await d.locator(':scope > summary').click();
     const body=await viewer.locator('body').innerText();
     for(const row of pinned.allocations)if(!body.includes(row.title))throw Error('The HTML omits an original allocation: '+row.id);
     for(const row of pinned.inputs)if(!body.includes(row.title))throw Error('The HTML omits a prime input: '+row.id);
    }else{
     const escaped=text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
     await viewer.setContent('<!doctype html><meta charset="utf-8"><title>'+path.basename(file)+'</title><style>body{background:#fff;color:#171717;font:14px/1.5 ui-monospace,monospace;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+path.basename(file)+'</h1><p>Complete unchanged downloaded text. CSV records were parsed and matched natively before this view.</p><pre>'+escaped+'</pre>');
    }
    const prefix='attachment-'+path.basename(file).replace(/[^a-zA-Z0-9_-]/g,'_');
    await viewer.setViewportSize({width:1440,height:1050});await captureAll(viewer,prefix+'-desktop');
    await viewer.setViewportSize({width:390,height:844});await captureAll(viewer,prefix+'-narrow');
   }catch(error){viewerError=error;throw error;}finally{await closePage(viewer,viewerError);}
  }return true;
}
let completed=null,failure=null;
try{
 context=await playwright.chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:args.browser,headless:true,acceptDownloads:true,timeout:10000,viewport:{width:1440,height:1050}});
 if(signalError){await close();throw signalError;}
 await context.addInitScript(({capability,workspace,origin})=>{if(location.origin===origin){sessionStorage.setItem('upstate-operator-capability',capability);sessionStorage.setItem('upstate-selected-workspace',workspace);}},{capability:secret,workspace:config.workspace_key,origin:new URL(config.operator_url).origin});
 await openOperator();
 if(recaptureOnly){
  await saved();
  const detailUrl=new URL('/api/joint-delivery/detail',config.operator_url);
  detailUrl.searchParams.set('workspace',config.workspace_key);detailUrl.searchParams.set('id',config.review_id);detailUrl.searchParams.set('response_id',config.response_id||'');
  const observed=await context.request.get(detailUrl.href,{headers:{Authorization:'Bearer '+secret,'X-Workspace':config.workspace_key}});
  let current,observationError=null;try{if(!observed.ok())throw Error('Read-only original review observation failed: '+observed.status());current=await observed.json();}catch(error){observationError=error;throw error;}finally{try{await observed.dispose();}catch(error){if(observationError)(observationError.cleanupErrors??=[]).push(String(error));else throw error;}}
  const unchanged=Object.entries(pinned).every(([key,value])=>canonical(current[key])===canonical(value));
  keep('Original_Review_Current_Observation.json',canonical({same_frozen_snapshot:unchanged,current})+'\n');
  await openEverySavedSection();await captureAll(page,unchanged?'Saved_Joint_Delivery_Desktop':'Following_Original_Review_Observation_Desktop');
  await page.setViewportSize({width:390,height:844});await captureAll(page,unchanged?'Saved_Joint_Delivery_Narrow':'Following_Original_Review_Observation_Narrow');
  await page.setViewportSize({width:1440,height:1050});
  await inspectAttachments(originalOut);
 }else{
 await step('original-working-request',async()=>{
  const original=await imported(config.working_file);
  await page.locator('[data-jd-pending="'+original.pending.request.operation_id+'"]').waitFor({state:'visible'});
  await button('retry').click();
  await page.waitForFunction(()=>!document.querySelector('[data-jd-pending]'),{},{timeout:120000});
  await errorCheck();await saved();return {operation_id:original.pending.request.operation_id,review_id:config.review_id};
 });
 await saved();
 await step('desktop-saved-joint-delivery',async()=>{
  await openEverySavedSection();await captureAll(page,'01-Saved_Joint_Delivery_Desktop');return {allocations:pinned.allocations.length,inputs:pinned.inputs.length};
 });
 await step('allocation-and-input-controls',async()=>{
  await page.locator('[data-jd-action="draft"]').click();await ready();
  for(const row of pinned.definition.allocations){
   await page.locator('[data-jd-action="allocation"][data-id="'+row.id+'"]').click();
   for(const key of ['prime','engineering','receiving','note','target_date','milestone_id','active_start_day','active_end_day','effort_hours']){
    const value=await page.locator('[data-jd-field="allocation:'+key+'"]').inputValue();
    if(value!==String(row[key]??''))throw Error('Original allocation control changed '+row.id+'/'+key);
   }
  }
  for(const row of pinned.definition.inputs){
   await page.locator('[data-jd-action="input"][data-id="'+row.id+'"]').click();
   for(const key of ['title','needed','public_context','owner','status','decision']){
    if(await page.locator('[data-jd-field="input:'+key+'"]').inputValue()!==row[key])throw Error('Original prime input control changed '+row.id+'/'+key);
   }
  }
  const first=pinned.definition.allocations[0];await page.locator('[data-jd-action="allocation"][data-id="'+first.id+'"]').click();
  await page.locator('[data-jd-field="allocation:effort_hours"]').fill('1e');
  if(!(await button('preview').isDisabled()))throw Error('Unfinished numeric text must block preview.');
  const rawFile=await download('Unfinished_Numeric_Working.json',()=>button('working-download').click());
  const rawWorking=JSON.parse(fs.readFileSync(rawFile,'utf8'));
  if(rawWorking.numericDrafts?.[first.id+'/effort_hours']!=='1e'||canonical(rawWorking.definition)!==canonical(pinned.definition))throw Error('Unfinished numeric text was lost or coerced.');
  await page.close();await openOperator();await imported(rawFile);
  await page.locator('[data-jd-action="allocation"][data-id="'+first.id+'"]').click();
  if(await page.locator('[data-jd-field="allocation:effort_hours"]').inputValue()!=='1e'||!(await button('preview').isDisabled()))throw Error('Reopening lost the actual unfinished numeric entry.');
  await screen('02a-Unfinished_Numeric_Reopened.png');
  await page.locator('[data-jd-field="allocation:effort_hours"]').fill('0');
  await page.locator('[data-jd-field="allocation:active_start_day"]').fill('1');
  await page.locator('[data-jd-field="allocation:active_end_day"]').fill('2');
  await page.locator('[data-jd-field="allocation:note"]').fill(first.note+'\nUnfinished internal allocation note; no recipient decision.');
  await button('evidence').click();await ready();await errorCheck();
  await page.locator('[data-jd-field="search"]').fill('NO_SUCH_ORIGINAL_FILE_'+config.review_id);
  if(await page.locator('[data-jd-evidence-list] tbody tr').count())throw Error('Empty evidence search did not preserve the empty state');
  await screen('02a-Empty_Evidence_Search.png');await page.locator('[data-jd-field="search"]').fill('');
  const evidence=page.locator('[data-jd-evidence]').first();if(await evidence.count()){const checked=await evidence.isChecked();await evidence.setChecked(!checked);await evidence.setChecked(checked);}
  await page.locator('[data-jd-field="row-search"]').fill('NO_SUCH_REQUIREMENT_'+config.review_id);
  if(await page.locator('[data-jd-allocation-list] button').count())throw Error('Requirement filter did not reach its empty state');
  await page.locator('[data-jd-field="row-search"]').fill('');
  const editedFile=await download('Allocation_Controls_Working.json',()=>button('working-download').click());
  const edited=JSON.parse(fs.readFileSync(editedFile,'utf8'));
  const expected=JSON.parse(JSON.stringify(pinned.definition));
  Object.assign(expected.allocations[0],{effort_hours:0,active_start_day:1,active_end_day:2,note:first.note+'\nUnfinished internal allocation note; no recipient decision.'});
  if(edited.pending||canonical(edited.definition)!==canonical(expected)||canonical(edited.profile)!==canonical(pinned.profile))throw Error('The complete edited working download changed other original allocations or inputs.');
  await captureAll(page,'02b-Edited_Allocation_Desktop');
  // Operate actual preview and its validation state; this creates no review.
  await button('preview').click();
  await page.locator('[data-jd-preview]').waitFor({state:'visible'});await errorCheck();
  await captureAll(page,'02c-Complete_Allocation_Preview');
  const definitionFile=await download('Previewed_Authored_Definition.json',()=>button('definition-download').click());
  if(canonical(JSON.parse(fs.readFileSync(definitionFile,'utf8')))!==canonical(expected))throw Error('The preview definition download changed the complete working selection.');
  await page.locator('[data-jd-field="allocation:active_start_day"]').fill('3');
  await button('preview').click();
  await page.waitForFunction(()=>{const e=document.querySelector('.joint-delivery [role="status"].jd-error');return e&&e.textContent.trim();});
  await screen('02d-Invalid_Active_Day_Order.png');
  await page.locator('[data-jd-field="allocation:active_start_day"]').fill('1');
  await button('preview').click();await page.locator('[data-jd-preview]').waitFor({state:'visible'});await errorCheck();
  // Restore all temporary edits so the retained unfinished course changes only its stated note.
  await page.locator('[data-jd-field="allocation:effort_hours"]').fill(String(first.effort_hours??''));
  await page.locator('[data-jd-field="allocation:active_start_day"]').fill(String(first.active_start_day??''));
  await page.locator('[data-jd-field="allocation:active_end_day"]').fill(String(first.active_end_day??''));
  await page.locator('[data-jd-field="allocation:note"]').fill(first.note);
  return {allocations:pinned.definition.allocations.length,inputs:pinned.definition.inputs.length,temporary_edits_saved_to_review:false};
 });
 await step('unfinished-working',async()=>{
  const retained=path.join(out,'Joint_Delivery_Unfinished_Working.json');
  if(!fs.existsSync(retained)){
   await page.locator('[data-jd-action="draft"]').click();await ready();
   await page.locator('[data-jd-field="notes"]').fill(config.definition.notes+'\nUnfinished receiving note: retain this working selection for the next evidence edition.');
   await download('Joint_Delivery_Unfinished_Working.json',()=>button('working-download').click());
  }else record('Joint_Delivery_Unfinished_Working.json');
  const expected=JSON.parse(fs.readFileSync(retained,'utf8'));
  if(expected.pending||canonical(expected.profile)!==canonical(pinned.profile)||canonical({...expected.definition,notes:config.definition.notes})!==canonical(config.definition))throw Error('The retained unfinished working copy differs from the original selection');
  await page.close();await openOperator();await imported(retained);
  await screen('02-Unfinished_Working_Reopened.png');
  return {working_id:expected.id,definition:expected.definition};
 });
 await step('saved-attachments',async()=>{
  await saved();
  for(const wanted of config.downloads.filter(x=>x.file.includes('/evidence/'))){
   const name=path.basename(wanted.file),link=page.locator('[data-jd-saved] a[download="'+name+'"]');
   if(await link.count()!==1)throw Error('Original saved evidence download is missing: '+name);
   await download('downloads/'+name,()=>link.click(),wanted);
  }
  return true;
 });
 await step('original-review-desk',async()=>{
  await saved();await page.locator('[data-jd-action="original"][data-tab="files"]').click();
  await page.waitForFunction(id=>{
   const e=document.querySelector('#detail-dialog .customer-review-detail');
   return e&&e.textContent.includes(id)&&e.querySelector('[data-action="review-tab"][data-tab="files"][aria-pressed="true"]')&&e.querySelector('table tbody tr');
  },config.review_id);
  await screen('03-Original_Review_Files.png');
  const desk=await context.newPage();let deskError=null;try{
   const url=new URL(config.desk_url,config.operator_url);if(url.origin!==new URL(config.operator_url).origin)throw Error('Original review desk leaves the selected operator');
   await desk.goto(url.href,{waitUntil:'domcontentloaded'});
   const pinned=JSON.parse(fs.readFileSync(path.join(config.root,config.downloads.find(x=>x.file.endsWith('/Pinned_Joint_Delivery_Snapshot.json')).file),'utf8'));
   await desk.waitForFunction(({id,title,requirements,artifacts})=>{
    const meta=document.querySelector('#review-meta'),list=document.querySelector('#requirements-list');
    return meta?.textContent.includes(id)&&document.querySelector('#review-title')?.textContent===title&&
     list&&requirements.every(key=>list.textContent.includes(key))&&
     artifacts.every(key=>document.querySelector('[data-artifact-id="'+key+'"]'));
   },{id:config.review_id,title:pinned.review.title,requirements:pinned.review.requirements.map(x=>x.id),artifacts:pinned.review.artifacts.map(x=>x.id)});
   await captureAll(desk,'04-Original_Recipient_Desk');
   keep('Original_Recipient_Visible_Text.txt',await desk.locator('body').innerText());
   await desk.locator('#tab-files').click();await desk.locator('#pane-files').waitFor({state:'visible'});
   await captureAll(desk,'04b-Recipient_Original_Files');
   await desk.locator('#tab-requirements').click();await desk.locator('#pane-requirements').waitFor({state:'visible'});
   await captureAll(desk,'04c-Recipient_Requirements');
  }catch(error){deskError=error;throw error;}finally{await closePage(desk,deskError);}
  await page.close();await openOperator();return true;
 });
 await step('actual-evidence-attachments-opened',()=>inspectAttachments(originalOut));
 await saved();
 await step('narrow-saved-joint-delivery',async()=>{
  await page.setViewportSize({width:390,height:844});await openEverySavedSection();await captureAll(page,'05-Saved_Joint_Delivery_390px');
  await page.locator('[data-jd-action="draft"]').click();await ready();await button('evidence').click();await ready();
  const last=pinned.definition.allocations.at(-1);await page.locator('[data-jd-action="allocation"][data-id="'+last.id+'"]').click();
  await captureAll(page,'06-Allocation_Editor_390px');
  await page.locator('[data-jd-action="input"][data-id="'+pinned.definition.inputs.at(-1).id+'"]').click();
  await captureAll(page,'07-Prime_Input_390px');
  await page.setViewportSize({width:1440,height:1050});return true;
 });
 await saved();await openEverySavedSection();
 await step('original-response-generation',async()=>{
  const text=await page.locator('[data-jd-saved]').innerText();
  for(const row of pinned.allocations)if(!text.includes(row.title))throw Error('Saved allocation is absent from actual UI: '+row.id);
  for(const row of pinned.inputs)if(!text.includes(row.title))throw Error('Saved input is absent from actual UI: '+row.id);
  if(!text.includes(pinned.summary.reviewer_disposition))throw Error('Actual selected original disposition differs');
  keep('Selected_Response_Visible_Text.txt',text);
  return {selected_response_id:pinned.selected_response_id,requirements:pinned.allocations.map(x=>x.id),inputs:pinned.inputs.map(x=>x.id)};
 });

 }
 live();completed={schema:'upstate.joint-delivery-browser-result/v1',binding,workspace_key:config.workspace_key,project_id:config.project_id,review_id:config.review_id,response_id:config.response_id,closed:true,recapture_only:recaptureOnly,artifacts:state.artifacts,visual_status:'Actual screenshots and complete attachments retained. The producing operator must open and inspect them before reporting visual acceptance.'};
}catch(error){failure=error;state.failure={message:String(error?.stack||error),at:new Date().toISOString()};try{checkpoint();}catch(saveError){error.saveError=String(saveError);}}
finally{try{await close();}catch(error){failure=failure||error;state.close_error=String(error?.stack||error);try{checkpoint();}catch(saveError){failure.saveError=String(saveError);}}}
if(signalError)failure=failure||signalError;
if(failure)throw failure;
if(!completed||closeError)throw Error('Original browser has not closed cleanly');
atomic(path.join(out,'result.json'),canonical(completed)+'\n',true);
state.complete=true;checkpoint();
if(recaptureOnly){
 const resultFile=path.join(out,'result.json');
 atomic(path.join(originalOut,'Latest_Local_Inspection.json'),canonical({original_binding:binding,result_file:path.relative(originalOut,resultFile),...ident(resultFile)})+'\n');
}
process.stdout.write(JSON.stringify(completed)+'\n');
