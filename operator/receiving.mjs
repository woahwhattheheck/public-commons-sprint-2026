#!/usr/bin/env node
/** One browser receiving segment over completed, original native model results. */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

if(process.argv.length!==3)throw Error('Usage: node operator/receiving.mjs PRIVATE_CONTROL.json');
const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {chromium}=await import(pathToFileURL(path.join(c.node_modules,'playwright/index.mjs')));
const origin=new URL(c.operator_url).origin;
const capability=new URLSearchParams(new URL(c.operator_url).hash.slice(1)).get('token');
assert.ok(capability,'Select the actual original operator URL.');
const statePath=path.resolve(c.progress),output=path.resolve(c.output);
await fs.mkdir(output,{recursive:true,mode:0o700});
const initial={schema:'upstate.operator-browser-receiving/v1',model_receiving_sha256:c.model_receiving_sha256,
  workspace_id:c.model.workspace_id,stages:{},attempts:[]};
let saved;
try{saved=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;saved=initial;}
assert.equal(saved.schema,initial.schema);assert.equal(saved.model_receiving_sha256,initial.model_receiving_sha256);
assert.equal(saved.workspace_id,c.model.workspace_id);
const attempt={mode:c.mode,source_revision:c.source_revision,started_at:new Date().toISOString(),page_errors:[],http_errors:[],screenshots:[]};
saved.attempts.push(attempt);
async function checkpoint(){
 const temp=statePath+'.'+randomUUID()+'.pending';
 try{
  const file=await fs.open(temp,'wx',0o600);
  try{await file.writeFile(JSON.stringify(saved,null,2)+'\n');await file.sync();}finally{await file.close();}
  await fs.rename(temp,statePath);
 }finally{await fs.rm(temp,{force:true});}
}
async function fileRecord(filename){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(filename)){hash.update(chunk);bytes+=chunk.length;}
 return {path:path.resolve(filename),bytes,sha256:hash.digest('hex')};
}
await checkpoint();
const browser=await chromium.launch({headless:true,executablePath:c.chromium,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,timezoneId:'America/New_York'});
const page=await context.newPage();page.setDefaultTimeout(60000);
page.on('pageerror',error=>attempt.page_errors.push(String(error)));
page.on('response',response=>{if(response.url().startsWith(origin+'/api/')&&response.status()>=400)attempt.http_errors.push({status:response.status(),url:new URL(response.url()).pathname});});
const modelRunActions=[];
page.on('request',request=>{if(request.url()===origin+'/api/actions'){try{const body=request.postDataJSON();if(['run.start','run.prepare','grid.prepare'].includes(body.action))modelRunActions.push(body.action);}catch{}}});
let workspace=c.workspace_key;
async function api(route,body){
 const response=await context.request.fetch(origin+route,{method:body===undefined?'GET':'POST',
  headers:{Authorization:'Bearer '+capability,'Content-Type':'application/json'},data:body,timeout:60000});
 const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;
}
const endpoint=(route,params={})=>route+'?'+new URLSearchParams({workspace,...params});
async function getState(){return api(endpoint('/api/state'));}
async function closeDialogs(){
 for(const [dialog,button]of [['#form-dialog','form-close'],['#detail-dialog','detail-close']])
  if(await page.locator(dialog).evaluate(el=>el.open))await page.locator(dialog+' [data-action="'+button+'"]').first().click();
}
async function navigate(view){
 await closeDialogs();await page.locator('[data-view="'+view+'"]').click();
 await page.waitForFunction(v=>document.querySelector('[data-view="'+v+'"]')?.getAttribute('aria-current')==='page',view);
}
async function openItem(kind,id){
 await closeDialogs();
 await page.locator('[data-action="item"][data-kind="'+kind+'"][data-id="'+id+'"]').click();
 await page.locator('#detail-dialog[open]').waitFor();
}
async function screenshot(name){
 const file=path.join(output,c.mode+'-'+String(saved.attempts.length)+'-'+name+'.png');
 await page.screenshot({path:file,fullPage:true});
 attempt.screenshots.push(await fileRecord(file));await checkpoint();
}
function bindOriginal(value){
 assert.equal(value.data.project.id,c.model.workspace_id);
 assert.ok(value.data.sources.some(x=>x.id===c.model.source_collection_id));
 assert.ok(value.data.grids.some(x=>x.id===c.model.grid_id&&x.state==='complete'));
 for(const [name,id]of Object.entries(c.model.runs)){
  const run=value.data.runs.find(x=>x.id===id);assert.ok(run&&run.state==='complete','Complete original run '+name);
  assert.equal(run.selection.grid_id,c.model.grid_id);
 }
 for(const id of Object.values(c.model.profiles))assert.ok(value.data.profiles.some(x=>x.id===id));
 for(const id of Object.values(c.model.scenarios))assert.ok(value.data.scenarios.some(x=>x.id===id));
 assert.ok(value.data.comparisons.some(x=>x.id===c.model.comparison_id));
}
async function inspectViews(){
 const first=await getState();bindOriginal(first);
 await navigate('sources');await openItem('sources',c.model.source_collection_id);
 const collection=first.data.sources.find(x=>x.id===c.model.source_collection_id);
 const selected=[collection.entries.find(x=>x.kind==='table'),collection.entries.find(x=>x.kind==='vector')].filter(Boolean);
 const inspections=[];
 for(const entry of selected){
  if(!(await page.locator('[data-action="source-inspect"][data-source="'+entry.id+'"]').count())){await closeDialogs();await openItem('sources',collection.id);}
  const response=page.waitForResponse(r=>r.url().startsWith(origin+'/api/source-info?'));
  await page.locator('[data-action="source-inspect"][data-source="'+entry.id+'"]').click();
  const returned=await response;assert.ok(returned.ok());const native=await returned.json();
  assert.equal(native.source.body.sha256,entry.body.sha256);
  assert.ok(native.sample?.length||native.feature_count===0,'Original source schema/sample returned');
  await page.waitForFunction(expected=>{
   const body=document.querySelector('#detail-body');
   return body?.textContent.includes('Original source preview')&&body.textContent.includes(expected);
  },entry.body.sha256);
  inspections.push({source_id:entry.id,kind:entry.kind,sha256:entry.body.sha256,columns:native.columns,
   feature_count:native.feature_count,geometry_type:native.geometry_type,sample_rows:native.sample?.length});
 }
 for(const view of ['profiles','grids','scenarios','runs','comparisons','observations','deliveries','overview'])await navigate(view);
 await screenshot('overview');
 await navigate('profiles');await openItem('profiles',Object.values(c.model.profiles)[0]);
 assert.ok((await page.locator('#detail-body').innerText()).includes('Nutrient delivery ratio'));
 await navigate('runs');await screenshot('native-runs');
 await openItem('runs',Object.values(c.model.runs)[0]);assert.match(await page.locator('#detail-body').innerText(),/sediment/i);
 await navigate('comparisons');await openItem('comparisons',c.model.comparison_id);await screenshot('run-comparison');
 await closeDialogs();await page.setViewportSize({width:390,height:844});await navigate('overview');
 const layout=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth}));
 assert.ok(layout.body<=layout.viewport,'Mobile layout exceeds its viewport');
 await screenshot('mobile');await page.setViewportSize({width:1440,height:1080});
 attempt.inspections=inspections;attempt.mobile=layout;await checkpoint();
}
async function showTask(id){
 await closeDialogs();
 const list=page.locator('#task-panel');
 if(!(await list.isVisible()))await page.locator('[data-action="tasks"]').first().click();
 const target=page.locator('[data-action="task-open"][data-id="'+id+'"]');
 if(!(await target.count()))await page.locator('[data-action="refresh"]').click();
 await target.click();await page.locator('#detail-dialog[open]').waitFor();
}
async function retainedStage(name,action,fill){
 let stage=saved.stages[name];
 if(stage?.result)return stage;
 const current=await getState();
 if(stage?.request){
  assert.equal(stage.request.workspace,workspace,'Original task workspace changed.');
  let task=current.tasks.find(x=>x.operation_id===stage.request.operation_id);
  if(!task)task=await api('/api/actions',stage.request);
  stage.task_id=task.id;await checkpoint();
 }else{
  stage=saved.stages[name]={action,started_at:new Date().toISOString()};await checkpoint();
  let captured=false;
  const route='**/api/actions';
  const capture=async route=>{
   const request=route.request().postDataJSON();
   if(request.action===action&&!captured){captured=true;stage.request=request;await checkpoint();}
   await route.continue();
  };
  await page.route(route,capture);
  try{
   await closeDialogs();await fill();
   const response=page.waitForResponse(r=>r.url()===origin+'/api/actions'&&r.request().postDataJSON()?.action===action);
   await page.locator('#form-submit').click();
   const returned=await response;const task=await returned.json();assert.ok(returned.ok(),JSON.stringify(task));
   assert.ok(captured,'Original UI request was retained before sending.');
   stage.task_id=task.id;await checkpoint();
   await page.locator('#form-dialog').waitFor({state:'hidden'});
   await page.locator('#detail-dialog[open]').waitFor();
  }finally{await page.unroute(route,capture);}
 }
 let resumed=false;
 const deadline=Date.now()+c.task_timeout_seconds*1000;
 while(true){
  const task=await api('/api/task?id='+stage.task_id);
  stage.last_state=task.state;stage.last_observed_at=new Date().toISOString();await checkpoint();
  if(task.state==='complete'){stage.result=task.result;stage.completed_at=task.ended_at;await checkpoint();return stage;}
  if((task.state==='interrupted'||(task.state==='failed'&&c.resume_failed_tasks))&&!resumed){
   await showTask(task.id);await page.locator('#detail-dialog [data-action="task-resume"]').click();resumed=true;
  }else if(['failed','cancelled'].includes(task.state))throw Error('Original '+action+' task '+task.id+' '+task.state+': '+JSON.stringify(task.error));
  assert.ok(Date.now()<deadline,'Original task remains active beyond this receiving observation window: '+stage.task_id);
  await page.waitForTimeout(1500);
 }
}
async function fillInput(name,value){await page.locator('#operation-form [name="'+name+'"]').fill(value==null?'':String(value));}
async function fillFilter(name,where={}){
 const box=page.locator('[data-filter="'+name+'"]');
 for(const [key,value]of Object.entries(where)){
  await box.locator('[data-action="filter-add"]').click();const row=box.locator('[data-filter-row]').last();
  await row.locator('[name="filter_field"]').fill(key);
  const type=value===null?'null':typeof value==='number'?'number':typeof value==='boolean'?'boolean':'text';
  await row.locator('[name="filter_type"]').selectOption(type);
  await row.locator('[name="filter_value"]').fill(value===null?'':String(value));
 }
}
async function chooseSource(name,selected,optional=false){
 if(optional)await page.locator('[name="'+name+'_enabled"]').setChecked(Boolean(selected));
 if(!selected)return;
 await page.locator('[name="'+name+'_collection"]').selectOption(selected.source_collection_id);
 await page.locator('[name="'+name+'_source"]').selectOption(selected.source_id);
 if(await page.locator('[name="'+name+'_layer"]').count()){
  await fillInput(name+'_layer',selected.layer||'');await fillFilter(name,selected.where);
 }
}
async function fillDelivery(){
 const selected=c.model.delivery_selection;
 await navigate('deliveries');await page.locator('[data-action="delivery-new"]').first().click();
 await fillInput('title',selected.title);await page.locator('[name="baseline"]').selectOption(selected.baseline_run_id);
 for(const id of selected.scenario_run_ids)await page.locator('[name="alternatives"][value="'+id+'"]').check();
 for(const role of ['PROTECTED_LANDS','PARCEL','NHD','NWI'])await chooseSource('role_'+role,selected.source_roles[role]);
 for(const name of ['drinking_water','high_quality_waters','protected_lands','parcels'])
  await chooseSource('overlay_'+name,selected.overlays[name],['protected_lands','parcels'].includes(name));
 for(const name of ['nitrogen_export','phosphorus_export','sediment_export']){
  await fillInput('weight_'+name,selected.map_settings?.weights?.[name]??1);
  await fillInput('cap_'+name,selected.map_settings?.caps?.[name]??'');
 }
 await fillInput('dpi',selected.map_settings?.dpi??200);await fillInput('map_title',selected.map_settings?.title??'');
 for(const id of selected.observation_comparison_ids||[])await page.locator('[name="observation_comparisons"][value="'+id+'"]').check();
 for(const key of ['name','organization','email'])await fillInput('contact_'+key,selected.contact[key]);
 await fillInput('notes',(selected.notes||[]).join('\n'));
}
async function download(ticket,name){
 const destination=path.join(output,name);
 try{
  const current=await fileRecord(destination);
  assert.equal(current.bytes,ticket.bytes);assert.equal(current.sha256,ticket.sha256);return current;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=destination+'.'+randomUUID()+'.pending';
 try{
  const event=page.waitForEvent('download',{timeout:c.task_timeout_seconds*1000});
  await page.locator('a[href="'+ticket.url+'?download=1"]').first().click();
  const transfer=await event;assert.equal(await transfer.failure(),null);
  await transfer.saveAs(temporary);
  const retained=await fileRecord(temporary);assert.equal(retained.bytes,ticket.bytes);assert.equal(retained.sha256,ticket.sha256);
  const file=await fs.open(temporary,'r');try{await file.sync();}finally{await file.close();}
  try{await fs.link(temporary,destination);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await fileRecord(destination);assert.equal(existing.bytes,ticket.bytes);assert.equal(existing.sha256,ticket.sha256);
  }
  return {path:destination,bytes:retained.bytes,sha256:retained.sha256};
 }finally{await fs.rm(temporary,{force:true});}
}
try{
 await page.goto(c.operator_url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#workspace-select')?.options.length>0);
 assert.equal(new URL(page.url()).hash,'#overview');
 await inspectViews();
 if(c.mode==='operate'){
  const delivery=await retainedStage('delivery','delivery.build',fillDelivery);
  await closeDialogs();await page.locator('[data-action="refresh"]').click();await navigate('deliveries');await openItem('deliveries',delivery.result.id);
  const item=await api(endpoint('/api/item',{kind:'deliveries',id:delivery.result.id}));
  const families=['future_sediment_loss','future_nutrient_runoff','critical_drinking_water','high_quality_waters','current_nutrient_export','current_sediment_export','combined_pollutant_export'];
  for(const family of families)assert.ok(Object.keys(item.maps).some(x=>x===family||x.startsWith(family+'-')),'Original map family '+family);
  await screenshot('seven-map-delivery');
  const carrier=item._downloads.find(x=>/delivery.*\.zip$/i.test(x.filename)&&!/working|workspace/i.test(x.filename))
   ||item._downloads.find(x=>/\.zip$/i.test(x.filename)&&!/working|workspace/i.test(x.filename));
  assert.ok(carrier,'Original complete delivery ZIP is available in the operator.');
  saved.delivery_archive=await download(carrier,'upper-savannah-map-delivery.zip');await checkpoint();
  const backup=await retainedStage('backup','workspace.backup',async()=>{
   await page.locator('[data-action="backup"]').first().click();
   await page.locator('[name="include_intermediates"]').setChecked(c.include_intermediates);
  });
  await showTask(backup.task_id);
  const task=await api('/api/task?id='+backup.task_id);
  assert.equal(task._downloads.length,1);
  saved.workspace_archive=await download(task._downloads[0],'upper-savannah-scientific-workspace.zip');await checkpoint();
  const restore=await retainedStage('restore','workspace.restore',async()=>{
   await page.locator('[data-action="restore"]').first().click();
   await page.locator('[name="restore_file"]').setInputFiles(saved.workspace_archive.path);
  });
  assert.equal(restore.result.project.id,c.model.workspace_id);assert.equal(restore.result.identity,'MATCH');
  assert.equal(restore.result.archive_sha256,saved.workspace_archive.sha256);
  saved.received=restore.result;await showTask(restore.task_id);
  await page.locator('#detail-dialog [data-action="workspace-select"]').click();
  workspace=restore.result.workspace_key;bindOriginal(await getState());await navigate('overview');await screenshot('restored-workspace');
 }
 assert.deepEqual(modelRunActions,[]);assert.deepEqual(attempt.page_errors,[]);assert.deepEqual(attempt.http_errors,[]);
 attempt.complete=true;attempt.completed_at=new Date().toISOString();
 if(c.mode==='reopened')saved.complete=true;
 await checkpoint();
 console.log(JSON.stringify({mode:c.mode,complete:true,workspace_id:c.model.workspace_id,stages:Object.keys(saved.stages),progress:statePath}));
}catch(error){
 attempt.error={name:error.name,message:error.message,stack:error.stack};attempt.completed_at=new Date().toISOString();
 await checkpoint();throw error;
}finally{await context.close();await browser.close();}
