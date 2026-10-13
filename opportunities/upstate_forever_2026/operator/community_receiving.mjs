#!/usr/bin/env node
/**
 * Complete Communities browser continuation over the actual local operator.
 * The same retained operation includes original source intake, plan/report work,
 * full workspace backup/restore and readback. It never starts a scientific model.
 */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {parseCommunityCsv,readInterventionCsv} from './web/community.mjs';

const argv=process.argv.slice(2),options={};
const flags=new Set(['resume-failed-tasks','help']);
const names=new Set(['control','url','workspace','output','mode','node-modules','chromium','python',
 'progress','source-collection','source-id','source-sha256','registered-source','task-timeout-seconds',
 'project-id','context','source-revision','mapped-plan','mapped-report','resume-failed-tasks','help']);
for(let i=0;i<argv.length;i++){
 const key=argv[i].replace(/^--/,'');
 assert.ok(argv[i].startsWith('--')&&names.has(key),'Unknown receiving option '+argv[i]);
 if(flags.has(key))options[key.replaceAll('-','_')]=true;
 else{assert.ok(argv[i+1]&&!argv[i+1].startsWith('--'),'Supply --'+key);options[key.replaceAll('-','_')]=argv[++i];}
}
if(options.help){
 console.log('node operator/community_receiving.mjs --url ORIGINAL_OPERATOR_URL --workspace WORKSPACE_KEY --output PRIVATE_DIRECTORY [--node-modules ORIGINAL_NODE_MODULES] [--chromium ORIGINAL_CHROMIUM] [--python ORIGINAL_PYTHON] [--mode operate|reopen]\nOr supply the same original values in a private --control JSON. Add --mapped-plan ORIGINAL_PLAN_ID --mapped-report ORIGINAL_REPORT_ID to continue an existing programme through explicitly mapped original CSV columns. Reuse its output directory to continue retained tasks.');
 process.exit(0);
}
const control=options.control?JSON.parse(await fs.readFile(options.control,'utf8')):{};
const c={...control,...options};
c.url=c.url||c.operator_url||process.env.UPSTATE_COMMUNITY_URL;
c.workspace=c.workspace||c.workspace_key||process.env.UPSTATE_COMMUNITY_WORKSPACE;
c.output=c.output||process.env.UPSTATE_COMMUNITY_OUTPUT;
c.mode=c.mode==='reopened'?'reopen':(c.mode||'operate');
c.node_modules=c.node_modules||process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
c.chromium=c.chromium||process.env.UPSTATE_CHROMIUM;
c.python=c.python||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
c.task_timeout_seconds=Number(c.task_timeout_seconds||1800);
c.source_id=c.source_id||'RFP_COMMUNITIES_2024_ACS';
c.source_sha256=c.source_sha256||'377d4f860fb545215534070309b67e1d26135cdab1ee03a70c657107692b06e4';
c.source_collection=c.source_collection||c.source_collection_id;
c.registered_source=c.registered_source||c.registered_source_id;
c.context=typeof c.context==='string'?JSON.parse(await fs.readFile(c.context,'utf8')):(c.context||{});
const mappingCourse=Boolean(c.mapped_plan||c.mapped_report);
if(mappingCourse){
 assert.match(c.mapped_plan||'',/^[0-9a-f]{64}$/,'Select the original saved Community plan.');
 assert.match(c.mapped_report||'',/^[0-9a-f]{64}$/,'Select that plan’s original saved report.');
}
assert.ok(c.url&&c.workspace&&c.output,'Supply the actual original URL, workspace key and private output directory.');
assert.ok(['operate','reopen'].includes(c.mode),'Choose operate or reopen.');
if(c.source_revision)assert.match(c.source_revision,/^[0-9a-f]{40}$/,'Use the complete original application commit.');
assert.match(c.workspace,/^[0-9a-f]{64}$/,'Select the actual original workspace key.');
assert.ok(Number.isFinite(c.task_timeout_seconds)&&c.task_timeout_seconds>0,'Use a positive task observation window.');
assert.match(c.source_sha256,/^[0-9a-f]{64}$/);
const selectedURL=new URL(c.url);
assert.ok(['http:','https:'].includes(selectedURL.protocol)&&!selectedURL.username&&!selectedURL.password);
const origin=selectedURL.origin;
const capability=new URLSearchParams(selectedURL.hash.slice(1)).get('token');
assert.ok(capability,'Use the original operator_url containing its current #token.');
const output=path.resolve(c.output);
await fs.mkdir(output,{recursive:true,mode:0o700});
const stem=mappingCourse?'community-mapping-browser':'community-browser';
const statePath=path.resolve(c.progress||path.join(output,stem+'-progress.json'));
const resultPath=path.join(output,stem+'-result.json');
const operation=mappingCourse?'UPSTATE-COMMUNITY-MAPPED-ORIGINAL-264B-20261013':'UPSTATE-UTILITY-COMMUNITY-APPLICATION-64B7-20261012';
const initial={schema:'upstate.community-browser-receiving/v1',operation,
 original_workspace_key:c.workspace,source_id:c.source_id,source_sha256:c.source_sha256,stages:{},attempts:[]};
let saved;
try{saved=JSON.parse(await fs.readFile(statePath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;saved=initial;}
assert.equal(saved.schema,initial.schema);assert.equal(saved.operation,operation);
assert.equal(saved.source_id,c.source_id);assert.equal(saved.source_sha256,c.source_sha256);
if(mappingCourse){
 const selection={plan_id:c.mapped_plan,report_id:c.mapped_report};
 if(saved.mapping_selection)assert.deepEqual(saved.mapping_selection,selection,'Continue the same original plan/report pair.');
 else saved.mapping_selection=selection;
}
if(c.mode==='operate')assert.equal(saved.original_workspace_key,c.workspace,'Continue the same original workspace.');
else assert.ok(saved.received&&saved.report,'Complete the original operate segment before reopening its saved output.');
saved.complete=false;
const attempt={mode:c.mode,started_at:new Date().toISOString(),workspace_key:c.workspace,
 page_errors:[],http_errors:[],screenshots:[],original_actions:[]};
saved.attempts.push(attempt);
let checkpointTail=Promise.resolve();
const redact=value=>String(value??'').split(capability).join('[operator capability]').replace(/#token=[^\s"'<>]+/g,'#token=[operator capability]');
async function atomicJSON(filename,value){
 const temporary=filename+'.'+randomUUID()+'.pending';
 try{
  const handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  await fs.rename(temporary,filename);
 }finally{await fs.rm(temporary,{force:true});}
}
function checkpoint(){
 const snapshot=JSON.parse(JSON.stringify(saved));
 const pending=checkpointTail.then(()=>atomicJSON(statePath,snapshot));
 checkpointTail=pending.catch(()=>{});return pending;
}
async function fileRecord(filename){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(filename)){hash.update(chunk);bytes+=chunk.length;}
 return {path:path.resolve(filename),bytes,sha256:hash.digest('hex')};
}
async function screenshot(label){
 const filename=path.join(output,c.mode+'-'+saved.attempts.length+'-'+label+'.png');
 await page.screenshot({path:filename,fullPage:true});
 attempt.screenshots.push(await fileRecord(filename));await checkpoint();
}
function publicItem(value){const copy=structuredClone(value);delete copy._downloads;return copy;}
async function retainedJSON(filename,value){
 const destination=path.join(output,filename),body=Buffer.from(JSON.stringify(value,null,2)+'\n');
 try{
  const existing=await fs.readFile(destination);assert.ok(existing.equals(body),'Retained receiving artifact changed: '+filename);
 }catch(error){
  if(error.code!=='ENOENT')throw error;
  const file=await fs.open(destination,'wx',0o600);
  try{await file.writeFile(body);await file.sync();}finally{await file.close();}
 }
 return fileRecord(destination);
}
await checkpoint();
await atomicJSON(resultPath,{schema:'upstate.community-browser-result/v1',operation,complete:false,state:'running',mode:c.mode,attempt:saved.attempts.length,progress:statePath});
let library;
if(c.node_modules)library=await import(pathToFileURL(path.join(c.node_modules,'playwright/index.mjs')).href);
else library=await import('playwright');
const browser=await library.chromium.launch({headless:true,...(c.chromium?{executablePath:c.chromium}:{}),
 args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,
 locale:'en-US',timezoneId:'America/New_York'});
const page=await context.newPage();
page.setDefaultTimeout(60000);
page.on('pageerror',error=>attempt.page_errors.push(redact(error.stack||error)));
page.on('response',response=>{
 const url=new URL(response.url());
 if(url.origin===origin&&url.pathname.startsWith('/api/')&&response.status()>=400)
  attempt.http_errors.push({status:response.status(),path:url.pathname});
});
page.on('request',request=>{
 if(request.method()==='POST'&&request.url()===origin+'/api/actions'){
  const value=request.postDataJSON();
  attempt.original_actions.push({action:value.action,operation_id:value.operation_id,workspace:value.workspace});
 }
});
let workspace=c.workspace;
async function api(route,body){
 const response=await context.request.fetch(origin+route,{method:body===undefined?'GET':'POST',
  headers:{Authorization:'Bearer '+capability,'Content-Type':'application/json'},data:body,timeout:60000});
 const value=await response.json();
 assert.ok(response.ok(),'Original API '+route.split('?')[0]+': '+redact(JSON.stringify(value)));
 return value;
}
const endpoint=(route,params={})=>route+'?'+new URLSearchParams({workspace,...params});
const getState=()=>api(endpoint('/api/state'));
const item=(kind,id)=>api(endpoint('/api/item',{kind,id}));
async function closeOverlays(){
 for(const [dialog,button]of [['#form-dialog','form-close'],['#detail-dialog','detail-close']]){
  if(await page.locator(dialog).evaluate(node=>node.open))
   await page.locator(dialog+' [data-action="'+button+'"]').first().click();
 }
 if(await page.locator('#task-panel').isVisible())
  await page.locator('#task-panel [data-action="tasks-close"]').click();
}
async function refresh(){
 await closeOverlays();
 const response=page.waitForResponse(r=>r.url().startsWith(origin+'/api/state')&&r.ok());
 await page.locator('[data-action="refresh"]').first().click();await response;
}
async function navigate(view){
 await closeOverlays();await page.locator('[data-view="'+view+'"]').click();
 await page.waitForFunction(v=>document.querySelector('[data-view="'+v+'"]')?.getAttribute('aria-current')==='page',view);
}
async function chooseWorkspace(key){
 assert.match(key,/^[0-9a-f]{64}$/);
 await closeOverlays();
 await page.locator('#workspace-select').selectOption(key);workspace=key;
 await page.waitForFunction(value=>document.querySelector('#workspace-select')?.value===value,key);
 const state=await getState();assert.equal(state.workspace_key,key);return state;
}
async function showTask(id){
 await closeOverlays();
 if(!(await page.locator('#task-panel').isVisible()))await page.locator('[data-action="tasks"]').first().click();
 let target=page.locator('[data-action="task-open"][data-id="'+id+'"]');
 if(!(await target.count())){
  await refresh();
  if(!(await page.locator('#task-panel').isVisible()))await page.locator('[data-action="tasks"]').first().click();
  target=page.locator('[data-action="task-open"][data-id="'+id+'"]');
 }
 await target.click();await page.locator('#detail-dialog[open]').waitFor();
}
async function retainedStage(name,action,fill){
 let stage=saved.stages[name];
 if(stage?.result)return stage;
 if(stage?.request){
  assert.equal(stage.request.workspace,workspace,'The original task workspace changed.');
  assert.equal(stage.request.action,action);
  const state=await getState();
  let task=stage.task_id?await api('/api/task?id='+stage.task_id):state.tasks.find(row=>row.operation_id===stage.request.operation_id);
  if(!task)task=await api('/api/actions',stage.request);
  assert.equal(task.workspace,stage.request.workspace);assert.equal(task.action,stage.request.action);
  assert.deepEqual(task.payload,stage.request.payload,'Retain the exact original task selection.');
  if(stage.accepted_operation_id)assert.equal(task.operation_id,stage.accepted_operation_id);
  stage.task_id=task.id;stage.accepted_operation_id=task.operation_id;await checkpoint();
 }else{
  stage=saved.stages[name]={action,started_at:new Date().toISOString()};await checkpoint();
  let captured=false;
  const capture=async route=>{
   const value=route.request().postDataJSON();
   if(value.action===action&&!captured){
    assert.equal(value.workspace,workspace);captured=true;stage.request=value;await checkpoint();
   }
   await route.continue();
  };
  await page.route('**/api/actions',capture);
  try{
   await closeOverlays();await fill();
   const response=page.waitForResponse(r=>r.url()===origin+'/api/actions'&&r.request().postDataJSON()?.action===action);
   await page.locator('#form-submit').click();
   const returned=await response,value=await returned.json();
   assert.ok(returned.ok(),redact(JSON.stringify(value)));assert.ok(captured,'Retain the original UI request before dispatch.');
   assert.equal(value.workspace,stage.request.workspace);assert.equal(value.action,stage.request.action);
   assert.deepEqual(value.payload,stage.request.payload);
   stage.task_id=value.id;stage.accepted_operation_id=value.operation_id;await checkpoint();
   await page.locator('#form-dialog').waitFor({state:'hidden'});
   await page.locator('#detail-dialog[open]').waitFor();
  }finally{await page.unroute('**/api/actions',capture);}
 }
 let resumed=false;
 const deadline=Date.now()+c.task_timeout_seconds*1000;
 while(true){
  const task=await api('/api/task?id='+stage.task_id);
  stage.last_state=task.state;stage.last_observed_at=new Date().toISOString();await checkpoint();
  if(task.state==='complete'){
   stage.result=task.result;stage.completed_at=task.ended_at;await checkpoint();
   console.log(JSON.stringify({operation,stage:name,task_id:task.id,state:task.state}));return stage;
  }
  if((task.state==='interrupted'||(task.state==='failed'&&c.resume_failed_tasks))&&!resumed){
   await showTask(task.id);
   await page.locator('#detail-dialog [data-action="task-resume"]').click();resumed=true;
  }else if(['failed','cancelled'].includes(task.state)){
   throw Error('Original '+action+' task '+task.id+' '+task.state+': '+JSON.stringify(task.error));
  }
  assert.ok(Date.now()<deadline,'The original task is still active: '+stage.task_id);
  await page.waitForTimeout(500);
 }
}
async function setChecks(scope,name,values){
 const boxes=scope.locator('[name="'+name+'"]'),all=await boxes.evaluateAll(nodes=>nodes.map(node=>node.value));
 for(const value of values)assert.ok(all.includes(value),'Original form choice missing: '+name+' / '+value);
 for(let index=0;index<all.length;index++)await scope.locator('[name="'+name+'"][value="'+all[index]+'"]').setChecked(values.includes(all[index]));
}
const form=()=>page.locator('#operation-form');
const input=(name,value,scope=form())=>scope.locator('[name="'+name+'"]').fill(value==null?'':String(value));
async function openCommunityTab(tab){
 await navigate('communities');await page.locator('[data-action="community-tab-'+tab+'"]').click();
}
async function openPlan(id){
 await openCommunityTab('plans');
 await page.locator('[data-action="community-plan-open"][data-id="'+id+'"]').first().click();
 await page.locator('#detail-dialog[open]').waitFor();
}
async function openReport(id){
 await openCommunityTab('reports');
 await page.locator('[data-action="community-report-open"][data-id="'+id+'"]').first().click();
 await page.locator('#detail-dialog[open]').waitFor();
}
async function download(ticket,destination){
 assert.ok(ticket.url.startsWith('/api/file/'),'Use the original file ticket.');
 assert.match(ticket.sha256,/^[0-9a-f]{64}$/);
 await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
 try{
  const old=await fileRecord(destination);assert.equal(old.bytes,ticket.bytes);assert.equal(old.sha256,ticket.sha256);return old;
 }catch(error){if(error.code!=='ENOENT')throw error;}
 const temporary=destination+'.'+randomUUID()+'.pending';
 try{
  const event=page.waitForEvent('download',{timeout:c.task_timeout_seconds*1000});
  await page.locator('a[href="'+ticket.url+'?download=1"]').first().click();
  const transfer=await event;assert.equal(await transfer.failure(),null);
  await transfer.saveAs(temporary);
  const actual=await fileRecord(temporary);assert.equal(actual.bytes,ticket.bytes);assert.equal(actual.sha256,ticket.sha256);
  const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}
  try{await fs.link(temporary,destination);}catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await fileRecord(destination);assert.equal(existing.bytes,ticket.bytes);assert.equal(existing.sha256,ticket.sha256);
  }
  return {path:path.resolve(destination),bytes:actual.bytes,sha256:actual.sha256};
 }finally{await fs.rm(temporary,{force:true});}
}
function sourceChoice(state){
 if(saved.source?.collection_id&&c.source_collection)assert.equal(saved.source.collection_id,c.source_collection,'Continue the original selected source edition.');
 const selectedCollection=saved.source?.collection_id||c.source_collection;
 const choices=state.data.sources.flatMap(collection=>collection.entries.filter(entry=>
  entry.id===c.source_id&&entry.kind==='table'&&entry.body?.sha256===c.source_sha256&&entry.community_metadata)
  .map(entry=>({collection,entry}))).filter(value=>!selectedCollection||value.collection.id===selectedCollection);
 return choices.sort((a,b)=>a.collection.id.localeCompare(b.collection.id))[0];
}
async function retainOriginalSource(){
 let state=await getState(),selected=sourceChoice(state);
 if(saved.source){
  assert.equal(selected?.collection.id,saved.source.collection_id,'The retained original source edition must remain available.');
 }else if(!selected||saved.stages.source?.request){
  await retainedStage('source','source.import',async()=>{
   await navigate('sources');await page.locator('[data-action="source-open"]').first().click();
   await form().locator('[name="source_mode"]').selectOption('registered');
   const available=state.registered_sources.filter(row=>c.registered_source?row.id===c.registered_source:
    row.title==='RFP Appendix F community and utility context');
   assert.equal(available.length,1,'Choose the original registered RFP community manifest.');
   await form().locator('[name="registered_id"]').selectOption(available[0].id);
   const previewResponse=page.waitForResponse(r=>r.url()===origin+'/api/source-preview');
   await page.locator('#form-submit').click();const response=await previewResponse;
   const preview=await response.json();assert.ok(response.ok(),JSON.stringify(preview));
   assert.ok(preview.entries.some(row=>row.id===c.source_id&&row.kind==='table'),'Preview the original complete table.');
   saved.source_preview={registered_id:available[0].id,manifest_sha256:preview.manifest_sha256,
    preview_id:preview.id,source_id:c.source_id};await checkpoint();
   await page.waitForFunction(()=>document.querySelector('#form-submit')?.textContent==='Import this source edition');
  });
  await refresh();state=await getState();selected=sourceChoice(state);
 }
 assert.ok(selected,'The original RFP table is not retained in this workspace.');
 const doc=selected.entry.community_metadata.source_document;
 assert.equal(doc.sha256,'a519d33190eefaef7ec082c19642fc6b8ef89329ad3c648a561699c7dd277e74');
 assert.equal(doc.pdf_page,16);
 saved.source={collection_id:selected.collection.id,source_id:selected.entry.id,sha256:selected.entry.body.sha256,
  original_document:doc,manifest_sha256:selected.collection.original_manifest.sha256};
 await checkpoint();return selected;
}
function assertTable(table){
 assert.equal(table.source.sha256,c.source_sha256);assert.equal(table.source.source_id,c.source_id);
 assert.equal(table.source.collection_id,saved.source.collection_id);
 assert.equal(table.groups.length,17);assert.equal(table.rows.length,17);
 assert.equal(new Set(table.groups.map(row=>row.geoid)).size,17);
 assert.equal(table.summaries.all.population_total,27448);assert.equal(table.summaries.all.households_total,11001);
 assert.equal(table.summaries.all.poverty_households_total,1014);assert.equal(table.summaries.all.below_state_median_count,10);
 assert.equal(table.metadata.income_reference.threshold,'72350');
 for(const [id,population,households,poverty,groups,below]of [
  ['ARJWS',20088,8650,702,11,5],['PRWD',7360,2351,312,6,5]]){
  const value=table.summaries.utilities.find(row=>row.scope_id===id);assert.ok(value);
  assert.equal(value.population_total,population);assert.equal(value.households_total,households);
  assert.equal(value.poverty_households_total,poverty);assert.equal(value.geoid_count,groups);
  assert.equal(value.below_state_median_count,below);
 }
}
async function compareCommunities(table){
 await openCommunityTab('explore');
 await page.locator('[name="community_table"]').selectOption(table.id);
 await page.locator('[data-action="community-reset-filters"]').click();
 const observed=[];
 for(const [utility,groups,population,households,poverty]of [
  ['',17,27448,11001,1014],['ARJWS',11,20088,8650,702],['PRWD',6,7360,2351,312]]){
  await page.locator('[name="community_utility"]').selectOption(utility);
  await page.waitForFunction(count=>document.querySelectorAll('#community-explore-results [data-community-compare]').length===count,groups);
  const metrics=await page.locator('#community-explore-results .community-metric').evaluateAll(nodes=>
   Object.fromEntries(nodes.map(node=>[node.querySelector('span').textContent,node.querySelector('strong').textContent])));
  assert.equal(Number(metrics['Block groups'].replaceAll(',','')),groups);
  assert.equal(Number(metrics['Whole-block-group population'].replaceAll(',','')),population);
  assert.equal(Number(metrics['Households'].replaceAll(',','')),households);
  assert.equal(Number(metrics['Households below poverty'].replaceAll(',','')),poverty);
  observed.push({utility:utility||'all',groups,population,households,poverty,rendered:metrics});
 }
 const serviceCards=await page.locator('.community-utility-cards article').evaluateAll(nodes=>nodes.map(node=>({
  title:node.querySelector('h3').textContent,population:Number(node.querySelector('strong').textContent.replaceAll(',',''))})));
 assert.deepEqual(serviceCards.map(row=>row.population).sort((a,b)=>a-b),[7000,210000]);
 await page.locator('[data-action="community-clear-comparison"]').click();
 const comparisonGeoids=['450730309011','450730309041'];
 for(const geoid of comparisonGeoids){
  await page.locator('[data-community-compare="'+geoid+'"]').focus();await page.keyboard.press('Space');
  await page.waitForFunction(id=>{
   const node=document.querySelector('[data-community-compare="'+id+'"]');
   return node?.checked&&document.activeElement===node;
  },geoid);
 }
 await page.locator('[data-action="community-compare"]').click();
 await page.locator('#detail-dialog[open]').waitFor();
 assert.equal(await page.locator('#detail-title').innerText(),'Community comparison');
 const population=await page.locator('#detail-body .community-metric').filter({hasText:'Whole-block-group population'}).locator('strong').innerText();
 assert.equal(Number(population.replaceAll(',','')),3141);
 await screenshot('original-community-comparison');
 await closeOverlays();await page.locator('[data-action="community-clear-comparison"]').click();
 await screenshot('prwd-community-workspace');
 await page.setViewportSize({width:390,height:844});
 const mobile=await page.evaluate(()=>({body:document.body.scrollWidth,viewport:innerWidth}));
 assert.ok(mobile.body<=mobile.viewport,'Communities should fit the mobile viewport.');
 await screenshot('community-mobile');await page.setViewportSize({width:1440,height:1080});
 saved.comparison={observed,service_populations:serviceCards,selected_geoids:comparisonGeoids,population:3141,mobile};await checkpoint();
}
const work=[
 {title:'Choestoea source-water protection screening',watershed:'030601020502',
  geoids:['450730309011','450730309041'],priority:'high',strategy:'investigate',
  reason:'The original RFP records 3,141 residents and 994 households across these two Choestoea block groups, with household income medians below the stated state reference. Use that community context when screening source-water protection options.',
  next:'Join the retained watershed and utility-source selections to completed erosion and nutrient outputs, then prepare a ranked screening sheet for utility technical review.',
  notes:'Use complete original block-group values alongside the selected model coverage; retain site and parcel choices in their original spatial review.'},
 {title:'Lower Tugaloo utility-source monitoring design',watershed:'030601020507',
  geoids:['450730309012','450730310001'],priority:'medium',strategy:'monitor',
  reason:'The retained Lower Tugaloo source rows identify 2,252 residents and 674 households across two block groups. Organize those communities with the original utility and watershed relationship when scoping the monitoring work.',
  next:'Review the original utility source locations and retained watershed selections, then prepare a sampling-site and data-collection work plan.',
  notes:'Keep monitoring coverage, original community counts and any future measured results as explicit source fields.'}
];
async function fillWork(row,value){
 await input('intervention_title',value.title,row);
 await row.locator('[name="intervention_utility"]').selectOption('PRWD');
 await row.locator('[name="intervention_watershed"]').selectOption(value.watershed);
 await setChecks(row,'intervention_geoids',value.geoids);
 await row.locator('[name="intervention_priority"]').selectOption(value.priority);
 await row.locator('[name="intervention_strategy"]').selectOption(value.strategy);
 await row.locator('[name="intervention_status"]').selectOption('proposed');
 await input('intervention_cost','',row);await input('intervention_reason',value.reason,row);
 await input('intervention_owner','Project planning team',row);await input('intervention_next_step',value.next,row);
 await input('intervention_notes',value.notes,row);
}
async function initialPlanForm(){
 await openCommunityTab('plans');await page.locator('[data-action="community-plan-new"]').first().click();
 await input('community_plan_title','Pioneer source-water community intervention plan');
 await input('community_plan_purpose','Use the complete RFP community edition to organize proposed source-water protection and monitoring work for Pioneer Rural Water District across the Choestoea and Lower Tugaloo focus watersheds.');
 await setChecks(form(),'community_plan_utilities',['PRWD']);
 await setChecks(form(),'community_plan_watersheds',[]);
 await setChecks(form(),'community_plan_geoids',[]);
 const selectedContext={...c.context,source_collection_ids:[...new Set([saved.source.collection_id,...(c.context.source_collection_ids||[])])]};
 await setChecks(form(),'community_sources',selectedContext.source_collection_ids);
 for(const [name,key]of [['community_grid','grid_id'],['community_baseline','baseline_run_id'],['community_delivery','delivery_id']])
  await form().locator('[name="'+name+'"]').selectOption(selectedContext[key]||'');
 await setChecks(form(),'community_alternatives',selectedContext.scenario_run_ids||[]);
 for(const value of work){
  await form().locator('[data-action="community-intervention-add"]').click();
  await fillWork(form().locator('[data-community-intervention]').last(),value);
 }
 await input('community_plan_notes','Proposed internal work program assembled from the original RFP Table 1 and its retained utility/HUC12 metadata.\nScope work against the retained original model and spatial selections before assigning field implementation costs.');
 saved.plan_context=selectedContext;await checkpoint();
}
function assertPlan(plan,previous=null){
 assert.equal(plan.table_id,saved.table.id);assert.equal(plan.source.sha256,c.source_sha256);
 assert.deepEqual(plan.selection.utility_ids,['PRWD']);assert.equal(plan.selected_groups.length,6);
 assert.equal(plan.summaries.all.population_total,7360);assert.equal(plan.summaries.all.households_total,2351);
 assert.equal(plan.summaries.all.poverty_households_total,312);assert.equal(plan.interventions.length,2);
 assert.ok(plan.context.source_collection_ids.includes(saved.source.collection_id));
 assert.equal(plan.revision_number,previous?2:1);assert.equal(plan.previous_plan_id,previous?.id||null);
 for(let i=0;i<work.length;i++){
  const row=plan.interventions[i];assert.equal(row.title,work[i].title);
  assert.equal(row.utility_id,'PRWD');assert.equal(row.watershed_id,work[i].watershed);
  assert.deepEqual([...row.geoids].sort(),[...work[i].geoids].sort());assert.equal(row.cost_estimate_usd,null);
  assert.equal(row.status,'proposed');if(previous)assert.equal(row.id,previous.interventions[i].id);
 }
}
async function revisedPlanForm(){
 await openPlan(saved.initial_plan.id);
 await page.locator('#detail-dialog [data-action="community-plan-revise"]').click();
 await input('community_plan_title','Pioneer source-water community intervention plan — technical revision');
 const row=form().locator('[data-community-intervention]').first();
 assert.equal(await row.getAttribute('data-community-intervention'),saved.initial_plan.interventions[0].id);
 await input('intervention_next_step','First retain the original drinking-water source and watershed intersection review, then join each screened location to the completed sediment and nutrient outputs for the same model edition.',row);
 await input('community_plan_notes','Proposed internal work program assembled from the original RFP Table 1 and its retained utility/HUC12 metadata.\nTechnical revision: retain the source-location intersection review before ranking specific protection sites.\nIntervention estimates remain unset until a site-level scope is prepared.');
}
async function inspectReport(report,plan,folder='report'){
 assert.equal(report.plan_id,plan.id);assert.equal(report.table_id,saved.table.id);
 await openReport(report.id);
 const html=report._downloads.find(row=>row.filename==='community-report.html');assert.ok(html);
 const response=page.waitForResponse(row=>new URL(row.url()).pathname===html.url);
 await page.locator('#detail-dialog [data-action="community-report-preview"]').click();
 const received=await response;assert.ok(received.ok());
 assert.match(received.headers()['content-disposition']||'',/^inline/);
 assert.match(received.headers()['content-security-policy']||'',/style-src 'unsafe-inline'/);
 assert.match(received.headers()['content-security-policy']||'',/sandbox/);
 const frame=page.frameLocator('iframe.community-report-preview');
 await frame.locator('h1').waitFor();assert.equal(await frame.locator('h1').innerText(),report.title);
 const presentation=await frame.locator('main').evaluate(node=>({padding:getComputedStyle(node).paddingTop,text:node.textContent}));
 assert.ok(parseFloat(presentation.padding)>0,'The original report stylesheet should render.');
 if(!mappingCourse)assert.ok(presentation.text.includes('7,360'));
 assert.ok(presentation.text.includes(c.source_sha256));
 if(mappingCourse){assert.ok(report.format_version>=7);assert.ok(presentation.text.includes('Original intervention field mapping'));}
 assert.equal(await page.locator('iframe.community-report-preview').getAttribute('sandbox'),'');
 await screenshot(folder+'-preview');
 if(mappingCourse){
  await page.setViewportSize({width:390,height:844});
  await screenshot(folder+'-preview-mobile');
  await page.setViewportSize({width:1440,height:1080});
 }
 const records={};
 for(const ticket of report._downloads){
  assert.equal(path.basename(ticket.filename),ticket.filename);
  records[ticket.filename]=await download(ticket,path.join(output,folder,ticket.filename));
 }
 const expected=['community-report.html','community-report.md','community-report.json','communities.csv','utilities.csv',
  'watersheds.csv','interventions.csv','scientific-context.csv','plan.json','original-community-source.csv','REPORT.json','community-report.zip'];
 for(const name of expected)assert.ok(records[name],'Complete report member '+name);
 if(mappingCourse){
  for(const name of ['received-interventions.csv','INTERVENTION_IMPORT.json'])assert.ok(records[name],'Complete mapped report member '+name);
 }
 if(plan.previous_plan_id&&report.format_version>=7){
  for(const name of ['plan-revision-summary.json','previous-plan.json','plan-revision-changes.csv'])
   assert.ok(records[name],'Complete saved-plan revision member '+name);
 }
 assert.equal(records['original-community-source.csv'].sha256,c.source_sha256);
 const payload=JSON.parse(await fs.readFile(records['community-report.json'].path,'utf8'));
 assert.equal(payload.schema,'upstate.community-report/v1');
 assert.deepEqual(payload.original_table,publicItem(saved.table));assert.deepEqual(payload.plan,publicItem(plan));
 if(mappingCourse){
  assert.equal(payload.communities.length,plan.selected_groups.length);assert.equal(payload.interventions.length,plan.interventions.length);
  assert.equal(await fs.readFile(records['received-interventions.csv'].path,'utf8'),saved.mapping_input.text);
  const imported=JSON.parse(await fs.readFile(records['INTERVENTION_IMPORT.json'].path,'utf8'));
  assert.deepEqual(imported.column_mapping,saved.mapping_input.column_mapping);
  assert.deepEqual(imported.field_provenance,plan.intervention_import.field_provenance);
 }else{assert.equal(payload.communities.length,6);assert.equal(payload.interventions.length,2);}
 const manifest=JSON.parse(await fs.readFile(records['REPORT.json'].path,'utf8'));
 assert.deepEqual(Object.keys(records).sort(),[...Object.keys(manifest.files),'REPORT.json','community-report.zip'].sort());
 for(const [name,value]of Object.entries(manifest.files)){
  assert.equal(records[name]?.sha256,value.sha256,'Downloaded report member '+name);
  assert.equal(records[name]?.bytes,value.bytes,'Downloaded report size '+name);
 }
 const expectedZip=Object.entries(records).filter(([name])=>name!=='community-report.zip')
  .map(([name,value])=>({name,bytes:value.bytes,sha256:value.sha256}));
 const zipScript='import hashlib,json,sys,zipfile\np=json.load(sys.stdin)\nwith zipfile.ZipFile(p["archive"]) as z:\n'
  +' names=z.namelist()\n assert len(names)==len(set(names))\n assert set(names)=={v["name"] for v in p["files"]}\n'
  +' for v in p["files"]:\n  b=z.read(v["name"])\n  assert len(b)==v["bytes"] and hashlib.sha256(b).hexdigest()==v["sha256"],v["name"]\n'
  +'print(json.dumps({"members":len(names),"original_members":"MATCH"}))\n';
 const zip=spawnSync(c.python,['-B','-c',zipScript],{input:JSON.stringify({archive:records['community-report.zip'].path,files:expectedZip}),encoding:'utf8',maxBuffer:1024*1024,timeout:60000});
 assert.equal(zip.status,0,redact(zip.stderr||zip.error));
 const zipResult=JSON.parse(zip.stdout);
 return {files:records,archive_members:zipResult,html_presentation:{padding:presentation.padding,status:received.status()},plan_id:plan.id,report_id:report.id};
}


const mappedNames={id:'Original intervention identifier',title:'Original work title',priority:'Original priority',
 strategy:'Original strategy',status:'Original status',utility_id:'Original utility identifier',
 watershed_id:'Original watershed HUC12',geoids:'Original block group identifiers',reason:'Original reason',
 owner:'Original work owner',next_step:'Original next action',cost_estimate_usd:'Original estimate USD',notes:'Original work notes'};
function assertMappedPlan(plan,previous){
 assert.equal(plan.previous_plan_id,previous.id);assert.equal(plan.revision_number,previous.revision_number+1);
 for(const key of ['table_id','title','purpose','selection','context','interventions','cost_summary','notes'])
  assert.deepEqual(plan[key],previous[key],'Mapped intake must preserve original '+key);
 const imported=plan.intervention_import;
 assert.equal(imported.source.text,saved.mapping_input.text);
 assert.equal(imported.source.sha256,saved.mapping_input.sha256);
 assert.equal(imported.source.bytes,Buffer.byteLength(saved.mapping_input.text,'utf8'));
 assert.deepEqual(imported.column_mapping,saved.mapping_input.column_mapping);
 assert.deepEqual(imported.source_headers,saved.mapping_input.headers);
 assert.deepEqual(imported.imported_interventions,previous.interventions);
 assert.deepEqual(imported.summary.added_ids,[]);assert.deepEqual(imported.summary.removed_ids,[]);
 assert.deepEqual(imported.summary.changed_ids,[]);
 assert.equal(imported.summary.unchanged_ids.length,previous.interventions.length);
 for(const row of imported.field_provenance){
  assert.equal(row.source_column,mappedNames[row.field]);
  assert.equal(row.source_column_number,saved.mapping_input.headers.indexOf(row.source_column)+1);
  assert.equal(row.basis,'original-column');
 }
}
async function operateMappedOriginal(){
 const original=await item('community_plans',c.mapped_plan),originalReport=await item('community_reports',c.mapped_report);
 assert.equal(originalReport.plan_id,original.id,'Use the report of the selected retained original plan.');
 assert.ok(original.interventions.length,'Select an existing programme with original intervention data.');
 const table=await item('community_tables',original.table_id);
 saved.source={collection_id:table.source.collection_id,id:table.source.source_id,sha256:table.source.sha256};
 saved.table=table;saved.initial_plan=original;saved.mapping_original_report=originalReport;assertTable(table);
 await navigate('communities');await page.locator('[name="community_table"]').selectOption(table.id);
 const ticket=originalReport._downloads.find(row=>row.filename==='interventions.csv');assert.ok(ticket);
 await openReport(originalReport.id);
 const originalFile=await download(ticket,path.join(output,'mapping-original-interventions.csv'));
 const originalText=await fs.readFile(originalFile.path,'utf8');
 const parsed=parseCommunityCsv(originalText),headers=parsed[0]?.cells;
 assert.ok(headers?.length);assert.equal(new Set(headers).size,headers.length);
 for(const field of Object.keys(mappedNames))assert.ok(headers.includes(field),'Original report field '+field);
 const order=headers.map((_,index)=>index).reverse();
 const renamed=headers.map(name=>mappedNames[name]||'Original exported '+name);
 const newHeaders=order.map(index=>renamed[index]);
 const cells=parsed.slice(1).filter(row=>row.cells.some(value=>value.trim()));
 for(const row of cells)assert.equal(row.cells.length,headers.length);
 const encode=value=>'"'+String(value).replaceAll('"','""')+'"';
 const text=[newHeaders,...cells.map(row=>order.map(index=>row.cells[index]))].map(row=>row.map(encode).join(',')).join('\r\n')+'\r\n';
 const checksum=createHash('sha256').update(text,'utf8').digest('hex');
 const mappingInput={filename:'original-interventions-remapped.csv',text,sha256:checksum,bytes:Buffer.byteLength(text,'utf8'),
  headers:newHeaders,column_mapping:mappedNames,original_report_id:originalReport.id,original_csv:originalFile,
  transformation:'Original CSV columns reversed and explicitly renamed; every original cell and row order retained.'};
 if(saved.mapping_input)assert.deepEqual(saved.mapping_input,mappingInput,'The original mapping input changed.');
 else saved.mapping_input=mappingInput;
 const mappedPath=path.join(output,mappingInput.filename);
 try{assert.equal(await fs.readFile(mappedPath,'utf8'),text);}catch(error){
  if(error.code!=='ENOENT')throw error;await fs.writeFile(mappedPath,text,{flag:'wx',mode:0o600});
 }
 const preview=readInterventionCsv(text,table,original.interventions,checksum,original.selection,mappedNames);
 for(const key of ['added_ids','removed_ids','changed_ids'])assert.deepEqual(preview.summary[key],[]);
 assert.equal(preview.records.length,original.interventions.length);
 await retainedJSON('original-column-mapping.json',mappingInput);await checkpoint();
 const revisionStage=await retainedStage('mapped-original-revision','community.plan.save',async()=>{
  await openPlan(original.id);await page.locator('#detail-dialog [data-action="community-plan-revise"]').click();
  await input('community_plan_title',original.title);
  await form().locator('[name="community_intervention_csv"]').setInputFiles(mappedPath);
  await form().locator('[data-action="community-intervention-import-columns"]').click();
  await form().locator('[name="community_import_map_id"]').waitFor();
  for(const [field,column]of Object.entries(mappedNames))
   await form().locator('[name="community_import_map_'+field+'"]').selectOption(column);
  await form().locator('[data-action="community-intervention-import-preview"]').click();
  await form().locator('[data-action="community-intervention-import-apply"]').waitFor();
  await screenshot('original-mapped-columns-preview');
  await page.setViewportSize({width:390,height:844});await screenshot('original-mapped-columns-preview-mobile');
  await page.setViewportSize({width:1440,height:1080});
  await form().locator('[data-action="community-intervention-import-apply"]').click();
  await form().locator('#community-import-applied').filter({hasText:'interventions loaded'}).waitFor();
  assert.equal(await form().locator('[data-community-intervention]').count(),original.interventions.length);
 });
 saved.revised_plan=await item('community_plans',revisionStage.result.id);
 assertMappedPlan(saved.revised_plan,original);await checkpoint();await refresh();
 const reportStage=await retainedStage('mapped-original-report','community.report.build',async()=>{
  await openPlan(saved.revised_plan.id);await page.locator('#detail-dialog [data-action="community-report-new"]').click();
  await input('community_report_title',originalReport.title);
 });
 saved.report=await item('community_reports',reportStage.result.id);
 await checkpoint();await refresh();
}

async function retainCommunityJourney(edition){
 if(edition.community_journey){saved.community_journey=edition.community_journey;return;}
 await openCommunityTab('explore');
 await page.locator('[name="community_table"]').selectOption(saved.table.id);
 const utility=mappingCourse?(saved.initial_plan.selection.utility_ids.length===1?saved.initial_plan.selection.utility_ids[0]:''):'PRWD';
 const watershed=mappingCourse?(saved.initial_plan.selection.watershed_ids.length===1?saved.initial_plan.selection.watershed_ids[0]:''):'030601020502';
 await page.locator('[name="community_utility"]').selectOption(utility);
 await page.locator('[name="community_watershed"]').selectOption(watershed);
 await page.locator('[name="community_sort"]').selectOption('income_asc');
 const query=mappingCourse?'':'450730309';
 await page.locator('[name="community_query"]').fill(query);
 await page.locator('[data-action="community-clear-comparison"]').click();
 const geoids=mappingCourse?[]:['450730309011','450730309041'];
 for(const geoid of geoids)await page.locator('[data-community-compare="'+geoid+'"]').setChecked(true);
 await openReport(saved.report.id);await closeOverlays();
 await navigate('journey');
 await page.locator('[data-action="journey-step"][data-step="reopen"]').click();
 const field=page.locator('[data-journey-field="notes"]');
 const previous=await field.inputValue();
 const marker='Community receiving: retain original table '+saved.table.id+', revised plan '+saved.revised_plan.id+
  ' and report '+saved.report.id+'. The selected whole block groups and proposed interventions remain linked to their original source edition.';
 const notes=previous.includes(marker)?previous:[previous,marker].filter(Boolean).join('\n\n');
 await field.fill(notes);
 const posted=page.waitForResponse(r=>r.url()===origin+'/api/operator-session'&&r.request().method()==='POST');
 await page.locator('[data-action="journey-save-view"]').click();
 assert.ok((await posted).ok(),'Save the original Community view and operating notes.');
 const state=await getState(),session=state.data.operator_session;
 assert.equal(session?.project_id,saved.project_id);
 const expected={schema:'upstate.community-view/v1',project_id:saved.project_id,table_id:saved.table.id,
  tab:'reports',utility_id:utility,watershed_id:watershed,query,sort:'income_asc',
  compare_geoids:geoids,plan_id:saved.revised_plan.id,report_id:saved.report.id};
 assert.deepEqual(session.journey.community,expected);
 assert.equal(session.journey.notes,notes);
 edition.community_journey={revision:session.revision,community:expected,notes};
 saved.community_journey=edition.community_journey;
 await checkpoint();
}
async function verifyCommunityJourney(state){
 const expected=saved.community_journey;
 assert.ok(expected,'Continue the original operation with the complete saved Community view before receiving it.');
 assert.equal(state.data.operator_session?.revision,expected.revision);
 assert.deepEqual(state.data.operator_session.journey.community,expected.community);
 assert.equal(state.data.operator_session.journey.notes,expected.notes);
 await navigate('communities');
 await page.waitForFunction(id=>document.querySelector('[name="community_table"]')?.value===id,expected.community.table_id);
 assert.equal(await page.locator('[data-action="community-tab-'+expected.community.tab+'"]').getAttribute('aria-pressed'),'true');
 assert.equal(await page.locator('[data-community-saved-selection] [data-action="community-plan-open"]').getAttribute('data-id'),expected.community.plan_id);
 assert.equal(await page.locator('[data-community-saved-selection] [data-action="community-report-open"]').getAttribute('data-id'),expected.community.report_id);
 await page.locator('[data-action="community-tab-explore"]').click();
 for(const [name,value]of [['community_utility',expected.community.utility_id],['community_watershed',expected.community.watershed_id],
  ['community_query',expected.community.query],['community_sort',expected.community.sort]])
  assert.equal(await page.locator('[name="'+name+'"]').inputValue(),value);
 const checked=await page.locator('[data-community-compare]:checked').evaluateAll(nodes=>nodes.map(node=>node.dataset.communityCompare).sort());
 assert.deepEqual(checked,[...expected.community.compare_geoids].sort());
 await navigate('journey');
 await page.locator('[data-action="journey-step"][data-step="reopen"]').click();
 assert.equal(await page.locator('[data-journey-field="notes"]').inputValue(),expected.notes);
 await page.locator('[data-action="journey-open-saved-view"]').click();
 await page.waitForFunction(()=>document.querySelector('#toast')?.textContent.includes('Saved project view opened'));
 await page.locator('[data-action="journey-community-open"]').click();
 await page.waitForFunction(()=>document.querySelector('[data-view="communities"]')?.getAttribute('aria-current')==='page');
 assert.equal(await page.locator('[data-action="community-tab-'+expected.community.tab+'"]').getAttribute('aria-pressed'),'true');
}

async function verifyReopened(){
 const state=await getState();assert.equal(state.data.project.id,saved.project_id);
 await verifyCommunityJourney(state);
 for(const [kind,id]of [['sources',saved.source.collection_id],['community_tables',saved.table.id],
  ['community_plans',saved.initial_plan.id],['community_plans',saved.revised_plan.id],['community_reports',saved.report.id]])
  assert.ok(state.data[kind].some(row=>row.id===id),'Original retained '+kind+' / '+id);
 const table=await item('community_tables',saved.table.id);assertTable(table);
 assert.deepEqual(publicItem(table),publicItem(saved.table));
 const original=await item('community_plans',saved.initial_plan.id),revision=await item('community_plans',saved.revised_plan.id);
 assert.deepEqual(publicItem(original),publicItem(saved.initial_plan));
 assert.deepEqual(publicItem(revision),publicItem(saved.revised_plan));
 if(mappingCourse)assertMappedPlan(revision,original);else assertPlan(revision,original);
 const report=await item('community_reports',saved.report.id);
 assert.deepEqual(publicItem(report),publicItem(saved.report));
 await openPlan(revision.id);
 await page.locator('#detail-dialog [data-action="community-plan-open"][data-id="'+original.id+'"]').click();
 await page.waitForFunction(title=>document.querySelector('#detail-title')?.textContent===title,original.title);
 assert.ok((await page.locator('#detail-body').innerText()).includes(original.interventions[0].next_step));
 const outputFiles=await inspectReport(report,revision,c.mode==='reopen'?'reopened-report':'restored-report');
 saved.reopened={workspace_key:workspace,project_id:state.data.project.id,table_id:table.id,initial_plan_id:original.id,
  revised_plan_id:revision.id,report_id:report.id,files:outputFiles,checked_at:new Date().toISOString()};
 await checkpoint();await closeOverlays();await page.reload({waitUntil:'domcontentloaded'});
 await page.waitForFunction(key=>document.querySelector('#workspace-select')?.value===key,workspace);
 await navigate('communities');await page.locator('[name="community_table"]').selectOption(table.id);
 await screenshot(c.mode==='reopen'?'new-server-reopened-workspace':'restored-workspace-reloaded');
}
try{
 await page.goto(c.url,{waitUntil:'domcontentloaded'});
 await page.waitForFunction(()=>document.querySelector('#workspace-select')?.options.length>0);
 const first=await chooseWorkspace(c.workspace);
 if(c.project_id)assert.equal(first.data.project.id,c.project_id);
 if(saved.project_id)assert.equal(first.data.project.id,saved.project_id);
 else saved.project_id=first.data.project.id;
 await checkpoint();
 if(c.mode==='operate'){
  if(mappingCourse){await operateMappedOriginal();}else{
  await retainOriginalSource();
  const tableStage=await retainedStage('table','community.table.import',async()=>{
   await navigate('communities');await page.locator('[data-action="community-import"]').first().click();
   await form().locator('[name="community_source"]').selectOption(JSON.stringify([saved.source.collection_id,c.source_id]));
   await input('community_title','Complete RFP Table 1 — original community and utility edition');
  });
  saved.table=await item('community_tables',tableStage.result.id);assertTable(saved.table);await checkpoint();
  await refresh();await compareCommunities(saved.table);
  const planStage=await retainedStage('plan','community.plan.save',initialPlanForm);
  saved.initial_plan=await item('community_plans',planStage.result.id);assertPlan(saved.initial_plan);await checkpoint();
  await refresh();
  const revisionStage=await retainedStage('revision','community.plan.save',revisedPlanForm);
  saved.revised_plan=await item('community_plans',revisionStage.result.id);assertPlan(saved.revised_plan,saved.initial_plan);
  assert.notEqual(saved.revised_plan.id,saved.initial_plan.id);
  assert.notEqual(saved.revised_plan.interventions[0].next_step,saved.initial_plan.interventions[0].next_step);
  await checkpoint();await refresh();
  const reportStage=await retainedStage('report','community.report.build',async()=>{
   await openPlan(saved.revised_plan.id);
   await page.locator('#detail-dialog [data-action="community-report-new"]').click();
   await input('community_report_title','Pioneer source-water community work program');
  });
  saved.report=await item('community_reports',reportStage.result.id);await checkpoint();await refresh();
  }
  saved.report_downloads=await inspectReport(saved.report,saved.revised_plan);
  saved.original_records=await retainedJSON('original-community-records.json',{
   schema:'upstate.community-browser-original-records/v1',project_id:saved.project_id,source:saved.source,
   table:publicItem(saved.table),initial_plan:publicItem(saved.initial_plan),revised_plan:publicItem(saved.revised_plan),report:publicItem(saved.report)});
  await checkpoint();
  const editionKey=c.source_revision||'legacy';
  saved.delivery_editions??={};
  if(saved.workspace_archive&&!saved.active_application_edition&&!saved.delivery_editions.legacy)
   saved.delivery_editions.legacy={source_revision:null,workspace_archive:saved.workspace_archive,received:saved.received,reopened:saved.reopened};
  saved.active_application_edition=editionKey;
  const edition=saved.delivery_editions[editionKey]??={source_revision:c.source_revision??null};
  const deliveryStage=name=>editionKey==='legacy'?name:name+':'+editionKey;
  const deliveryPath=editionKey==='legacy'?output:path.join(output,'application-editions',editionKey);
  await checkpoint();
  await retainCommunityJourney(edition);
  const backup=await retainedStage(deliveryStage('backup'),'workspace.backup',async()=>{
   await page.locator('[data-action="backup"]').first().click();
   await form().locator('[name="include_intermediates"]').setChecked(true);
  });
  await showTask(backup.task_id);
  const backupTask=await api('/api/task?id='+backup.task_id);assert.equal(backupTask._downloads.length,1);
  saved.workspace_archive=await download(backupTask._downloads[0],path.join(deliveryPath,'complete-community-workspace.zip'));
  edition.workspace_archive=saved.workspace_archive;await checkpoint();
  const restore=await retainedStage(deliveryStage('restore'),'workspace.restore',async()=>{
   await page.locator('[data-action="restore"]').first().click();
   await form().locator('[name="restore_file"]').setInputFiles(saved.workspace_archive.path);
  });
  assert.equal(restore.result.project.id,saved.project_id);assert.equal(restore.result.identity,'MATCH');
  assert.equal(restore.result.archive_sha256,saved.workspace_archive.sha256);
  assert.notEqual(restore.result.workspace_key,saved.original_workspace_key);
  saved.received=restore.result;edition.received=saved.received;await checkpoint();await showTask(restore.task_id);
  await page.locator('#detail-dialog [data-action="workspace-select"]').click();
  workspace=restore.result.workspace_key;
  await page.waitForFunction(key=>document.querySelector('#workspace-select')?.value===key,workspace);
  await verifyReopened();
  edition.reopened=saved.reopened;saved.operated_application_revision=c.source_revision??null;await checkpoint();
 }else{
  assert.equal(c.workspace,saved.received.workspace_key,'Reopen the same received workspace directory.');
  await verifyReopened();
 }
 const unexpected=attempt.original_actions.filter(row=>!['source.import','community.table.import','community.plan.save',
  'community.report.build','workspace.backup','workspace.restore'].includes(row.action));
 assert.deepEqual(unexpected,[]);assert.deepEqual(attempt.page_errors,[]);assert.deepEqual(attempt.http_errors,[]);
 attempt.complete=true;attempt.completed_at=new Date().toISOString();saved.complete=true;await checkpoint();
 const result={schema:'upstate.community-browser-result/v1',operation,complete:true,mode:c.mode,
  project_id:saved.project_id,original_workspace_key:saved.original_workspace_key,source:saved.source,
  table_id:saved.table.id,initial_plan_id:saved.initial_plan.id,revised_plan_id:saved.revised_plan.id,report_id:saved.report.id,
  task_ids:Object.fromEntries(Object.entries(saved.stages).map(([name,row])=>[name,row.task_id])),
  comparison:saved.comparison,report_downloads:saved.report_downloads,workspace_archive:saved.workspace_archive,
  received:saved.received,reopened:saved.reopened,community_journey:saved.community_journey,original_records:saved.original_records,progress:statePath,
  source_revision:c.source_revision??null,delivery_editions:saved.delivery_editions??{},
  ...(mappingCourse?{mapping_selection:saved.mapping_selection,mapping_input:saved.mapping_input}:{}),
  attempts:saved.attempts.map(row=>({mode:row.mode,started_at:row.started_at,completed_at:row.completed_at,
   complete:Boolean(row.complete),error:row.error,screenshots:row.screenshots,page_errors:row.page_errors,http_errors:row.http_errors}))};
 await atomicJSON(resultPath,result);
 console.log(JSON.stringify({operation,complete:true,mode:c.mode,project_id:saved.project_id,
  report_id:saved.report.id,received_workspace:saved.received.workspace,result:resultPath}));
}catch(error){
 attempt.error={name:error.name,message:redact(error.message),stack:redact(error.stack)};
 attempt.completed_at=new Date().toISOString();await checkpoint();
 await atomicJSON(path.join(output,stem+'-failure.json'),{operation,attempt:attempt.error,progress:statePath,
  original_task_ids:Object.fromEntries(Object.entries(saved.stages).map(([name,row])=>[name,row.task_id]))});
 await atomicJSON(resultPath,{schema:'upstate.community-browser-result/v1',operation,complete:false,state:'failed',mode:c.mode,error:attempt.error,progress:statePath,received:saved.received});
 throw Error(attempt.error.message,{cause:attempt.error.name});
}finally{await context.close();await browser.close();}
