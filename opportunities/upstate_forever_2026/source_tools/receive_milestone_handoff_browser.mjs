#!/usr/bin/env node
/** Operate one private browser against the existing original Eco operator. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';

const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
const config=JSON.parse(fs.readFileSync(args.config,'utf8')),out=path.resolve(config.output);
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
let state=fs.existsSync(statePath)?JSON.parse(fs.readFileSync(statePath,'utf8')):{schema:'upstate.milestone-browser-state/v1',binding,steps:{},artifacts:[]};
if(state.binding!==binding)throw Error('Use the exact original browser case');
const checkpoint=()=>atomic(statePath,canonical(state)+'\n');
function record(relative){const item={file:relative,...ident(path.join(out,relative))};const prior=state.artifacts.find(x=>x.file===relative);if(prior&&canonical(prior)!==canonical(item))throw Error('Retained artifact changed: '+relative);if(!prior)state.artifacts.push(item);checkpoint();return item;}
function keep(relative,raw){atomic(path.join(out,relative),raw,true);return record(relative);}
function verify(){for(const a of state.artifacts)if(canonical(ident(path.join(out,a.file)))!==canonical({bytes:a.bytes,sha256:a.sha256}))throw Error('Original artifact changed: '+a.file);}
if(state.complete){verify();const r=JSON.parse(fs.readFileSync(path.join(out,'result.json'),'utf8'));if(r.binding!==binding||!r.closed)throw Error('Reconcile the original browser closure');process.stdout.write(JSON.stringify(r)+'\n');process.exit(0);}
verify();
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
const root=()=>page.locator('.milestone-handoff').first();
const button=action=>page.locator('[data-mh-action="'+action+'"]').first();
async function ready(){await page.waitForFunction(()=>{const e=document.querySelector('[data-mh-field="title"]');return e&&!e.closest('[aria-busy="true"]');});}
async function openOperator(){
 page=await context.newPage();await page.goto(config.operator_url+'/#milestone-handoff',{waitUntil:'domcontentloaded'});
 await page.locator('[data-view="milestone-handoff"]').first().waitFor({state:'visible'});
 await page.locator('[data-view="milestone-handoff"]').first().click();await ready();live();
}
async function errorCheck(){
 const errors=await page.locator('.milestone-handoff > .mh-error, .milestone-handoff [role="status"].mh-error').allTextContents();
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
 if(!fs.existsSync(path.join(out,relative))){await page.screenshot({path:path.join(out,relative),fullPage:true});}
 return record(relative);
}
async function imported(file){
 await page.locator('[data-mh-file="working"]').setInputFiles(file);await ready();await errorCheck();
 const value=JSON.parse(fs.readFileSync(file,'utf8'));
 await page.waitForFunction(expected=>document.querySelector('[data-mh-field="title"]')?.value===expected.title&&document.querySelector('[data-mh-field="notes"]')?.value===expected.notes,value.definition);
 return value;
}
async function saved(){
 await button('refresh').click();await ready();
 await page.locator('[data-mh-action="open"][data-id="'+config.review_id+'"]').click();
 await page.locator('[data-mh-saved="'+config.review_id+'"]').waitFor({state:'visible'});
 if(config.response_id){await page.locator('[data-mh-action="response-open"][data-id="'+config.response_id+'"]').click();}
 else await page.locator('[data-mh-action="response-open"][data-id=""]').click();
 await page.waitForFunction(({id,response})=>{
  const e=document.querySelector('[data-mh-saved="'+id+'"]');return e&&e.innerText.includes('Selected response '+(response||'none'));
 },{id:config.review_id,response:config.response_id});
 await errorCheck();
}
let completed=null,failure=null;
try{
 context=await playwright.chromium.launchPersistentContext(path.join(out,'profile'),{executablePath:args.browser,headless:true,acceptDownloads:true,timeout:10000,viewport:{width:1440,height:1050}});
 if(signalError){await close();throw signalError;}
 await context.addInitScript(({capability,workspace})=>{sessionStorage.setItem('upstate-operator-capability',capability);sessionStorage.setItem('upstate-selected-workspace',workspace);},{capability:secret,workspace:config.workspace_key});
 await openOperator();
 await step('original-working-request',async()=>{
  const original=await imported(config.working_file);
  await page.locator('[data-mh-pending="'+original.pending.request.operation_id+'"]').waitFor({state:'visible'});
  await button('retry').click();
  await page.waitForFunction(()=>!document.querySelector('[data-mh-pending]'),{},{timeout:120000});
  await errorCheck();await saved();return {operation_id:original.pending.request.operation_id,review_id:config.review_id};
 });
 await saved();
 await step('desktop-saved-milestone',async()=>{await screen('01-Saved_Milestone_Desktop.png');keep('Saved_Milestone_Visible_Text.txt',await page.locator('[data-mh-saved]').innerText());return true;});
 await step('unfinished-working',async()=>{
  const retained=path.join(out,'Milestone_Unfinished_Working.json');
  if(!fs.existsSync(retained)){
   await page.locator('[data-mh-action="draft"]').click();await ready();
   await page.locator('[data-mh-field="notes"]').fill(config.definition.notes+'\nUnfinished receiving note: retain this working selection for the next evidence edition.');
   await download('Milestone_Unfinished_Working.json',()=>button('working-download').click());
  }else record('Milestone_Unfinished_Working.json');
  const expected=JSON.parse(fs.readFileSync(retained,'utf8'));
  if(expected.pending||expected.definition.milestone_id!==config.definition.milestone_id||canonical(expected.definition.selection)!==canonical(config.definition.selection))throw Error('The retained unfinished working copy differs from the original selection');
  await page.close();await openOperator();await imported(retained);
  await screen('02-Unfinished_Working_Reopened.png');
  return {working_id:expected.id,definition:expected.definition};
 });
 await step('saved-attachments',async()=>{
  await saved();
  for(const wanted of config.downloads.filter(x=>x.file.includes('/evidence/'))){
   const name=path.basename(wanted.file),link=page.locator('[data-mh-saved] a[download="'+name+'"]');
   if(await link.count()!==1)throw Error('Original saved evidence download is missing: '+name);
   await download('downloads/'+name,()=>link.click(),wanted);
  }
  return true;
 });
 await step('original-review-desk',async()=>{
  await saved();await page.locator('[data-mh-action="original"][data-tab="files"]').click();
  await page.waitForFunction(id=>{
   const e=document.querySelector('#detail-dialog .customer-review-detail');
   return e&&e.textContent.includes(id)&&e.querySelector('[data-action="review-tab"][data-tab="files"][aria-pressed="true"]')&&e.querySelector('table tbody tr');
  },config.review_id);
  await screen('03-Original_Review_Files.png');
  const desk=await context.newPage();try{
   const url=new URL(config.desk_url,config.operator_url);if(url.origin!==new URL(config.operator_url).origin)throw Error('Original review desk leaves the selected operator');
   await desk.goto(url.href,{waitUntil:'domcontentloaded'});
   const pinned=JSON.parse(fs.readFileSync(path.join(config.root,config.downloads.find(x=>x.file.endsWith('/Pinned_Milestone_Snapshot.json')).file),'utf8'));
   await desk.waitForFunction(({id,title,requirements,artifacts})=>{
    const meta=document.querySelector('#review-meta'),list=document.querySelector('#requirements-list');
    return meta?.textContent.includes(id)&&document.querySelector('#review-title')?.textContent===title&&
     list&&requirements.every(key=>list.textContent.includes(key))&&
     artifacts.every(key=>document.querySelector('[data-artifact-id="'+key+'"]'));
   },{id:config.review_id,title:pinned.review.title,requirements:pinned.review.requirements.map(x=>x.id),artifacts:pinned.review.artifacts.map(x=>x.id)});
   if(!fs.existsSync(path.join(out,'04-Original_Recipient_Desk.png')))await desk.screenshot({path:path.join(out,'04-Original_Recipient_Desk.png'),fullPage:true});record('04-Original_Recipient_Desk.png');
   keep('Original_Recipient_Visible_Text.txt',await desk.locator('body').innerText());
   await desk.locator('#tab-files').click();await desk.locator('#pane-files').waitFor({state:'visible'});
   if(!fs.existsSync(path.join(out,'04b-Recipient_Original_Files.png')))await desk.screenshot({path:path.join(out,'04b-Recipient_Original_Files.png'),fullPage:true});record('04b-Recipient_Original_Files.png');
   await desk.locator('#tab-requirements').click();await desk.locator('#pane-requirements').waitFor({state:'visible'});
   if(!fs.existsSync(path.join(out,'04c-Recipient_Requirements.png')))await desk.screenshot({path:path.join(out,'04c-Recipient_Requirements.png'),fullPage:true});record('04c-Recipient_Requirements.png');
  }finally{await desk.close();}
  await page.close();await openOperator();return true;
 });
 await step('actual-evidence-attachments-viewed',async()=>{
  for(const wanted of config.downloads.filter(x=>x.file.includes('/evidence/'))){
   const file=path.join(out,'downloads',path.basename(wanted.file));
   const raw=fs.readFileSync(file);if(raw.length!==wanted.bytes||sha(raw)!==wanted.sha256)throw Error('Original evidence attachment differs');
   const viewer=await context.newPage();try{
    if(file.endsWith('.html'))await viewer.goto(pathToFileURL(file).href,{waitUntil:'load'});
    else{
     const text=raw.toString('utf8'),escaped=text.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
     await viewer.setContent('<!doctype html><meta charset="utf-8"><title>'+path.basename(file)+'</title><style>body{background:#fff;color:#171717;font:15px/1.5 ui-monospace,monospace;margin:28px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+path.basename(file)+'</h1><pre>'+escaped+'</pre>');
    }
    const name='attachment-'+path.basename(file).replace(/[^a-zA-Z0-9_-]/g,'_')+'.png';
    if(!fs.existsSync(path.join(out,name)))await viewer.screenshot({path:path.join(out,name),fullPage:true});record(name);
   }finally{await viewer.close();}
  }return true;
 });
 await saved();
 await step('narrow-saved-milestone',async()=>{await page.setViewportSize({width:390,height:844});await screen('05-Saved_Milestone_390px.png');await page.setViewportSize({width:1440,height:1050});return true;});
 await step('original-response-generation',async()=>{
  const expected=JSON.parse(fs.readFileSync(path.join(config.root,config.downloads.find(x=>x.file.endsWith('/Pinned_Milestone_Snapshot.json')).file),'utf8'));
  const text=await page.locator('[data-mh-saved]').innerText();
  for(const c of expected.criteria)if(!text.includes(c.id))throw Error('Saved criterion is absent from actual UI: '+c.id);
  if(!text.includes(expected.summary.reviewer_disposition))throw Error('Actual selected original disposition differs');
  keep('Selected_Response_Visible_Text.txt',text);return {selected_response_id:expected.selected_response_id,criteria:expected.criteria.map(x=>x.id)};
 });
 live();completed={schema:'upstate.milestone-browser-result/v1',binding,workspace_key:config.workspace_key,project_id:config.project_id,review_id:config.review_id,response_id:config.response_id,closed:true,artifacts:state.artifacts,visual_status:'Actual screenshots and complete attachments retained. The producing operator must open and inspect them before reporting visual acceptance.'};
}catch(error){failure=error;state.failure={message:String(error?.stack||error),at:new Date().toISOString()};checkpoint();}
finally{try{await close();}catch(error){failure=failure||error;state.close_error=String(error?.stack||error);checkpoint();}}
if(signalError)failure=failure||signalError;
if(failure)throw failure;
if(!completed||closeError)throw Error('Original browser has not closed cleanly');
atomic(path.join(out,'result.json'),canonical(completed)+'\n',true);
state.complete=true;checkpoint();process.stdout.write(JSON.stringify(completed)+'\n');
