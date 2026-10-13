#!/usr/bin/env node
/** Complete original Operator receiving-water course. No numerical engine lives here. */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';

const clone=x=>JSON.parse(JSON.stringify(x));
const canonical=x=>JSON.stringify(x&&typeof x==='object'?(Array.isArray(x)?x.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(x).sort().map(k=>[k,JSON.parse(canonical(x[k]))]))):x);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const same=(a,b,message)=>assert.equal(canonical(a),canonical(b),message);
async function fileRecord(filename){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(filename)){hash.update(chunk);bytes+=chunk.length;}
 return {path:path.resolve(filename),bytes,sha256:hash.digest('hex')};
}
async function readMaybe(filename){try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;return null;}}
async function atomic(filename,value){
 const temp=filename+'.'+randomUUID()+'.pending';
 await fs.mkdir(path.dirname(filename),{recursive:true});
 try{const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(JSON.stringify(value,null,2)+'\n');await h.sync();}finally{await h.close();}await fs.rename(temp,filename);}
 finally{await fs.rm(temp,{force:true});}
}
async function exact(filename,bytes){
 await fs.mkdir(path.dirname(filename),{recursive:true});
 const expected=createHash('sha256').update(bytes).digest('hex');
 try{const f=await fileRecord(filename);assert.equal(f.sha256,expected);assert.equal(f.bytes,bytes.length);return f;}catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=filename+'.'+randomUUID()+'.pending';
 try{const h=await fs.open(temp,'wx',0o600);try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
  try{await fs.link(temp,filename);}catch(e){if(e.code!=='EEXIST')throw e;assert.equal((await fileRecord(filename)).sha256,expected);}
 }finally{await fs.rm(temp,{force:true});}
 return fileRecord(filename);
}
async function exactJSON(filename,value){return exact(filename,Buffer.from(JSON.stringify(value,null,2)+'\n'));}

export async function runReceivingWaterBrowser(c,{browser:borrowedBrowser=null}={}){
 assert.ok(['operate','editable','reopened','attachments'].includes(c.mode));
 const output=path.resolve(c.output),statePath=path.join(output,'browser-'+c.mode+'.json');
 const input=c.input;assert.equal(input.operation_id,'ECO-RECEIVING-WATER-9B2C-20261013');
 await fs.mkdir(output,{recursive:true});
 const identity={schema:'upstate.receiving-water-browser/v1',operation_id:input.operation_id,
   input_sha256:c.input_sha256,mode:c.mode,workspace_id:input.workspace_id};
 let saved=await readMaybe(statePath)||{...identity,stages:{},seasons:[],attempts:[],complete:false};
 for(const [k,v]of Object.entries(identity))same(saved[k],v,'Continue the original '+k);
 if(saved.complete)return {complete:true,result:await fileRecord(statePath)};
 const attempt={id:randomUUID(),started_at:new Date().toISOString(),page_errors:[],screenshots:[]};
 saved.attempts.push(attempt);
 const checkpoint=()=>atomic(statePath,saved);
 await checkpoint();
 const {chromium}=await import(pathToFileURL(path.join(c.node_modules,'playwright/index.mjs')));
 const browser=borrowedBrowser||await chromium.launch({headless:true,executablePath:c.chromium,
   args:['--no-sandbox','--disable-dev-shm-usage']});
 const context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true,timezoneId:'UTC'});
 const page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',e=>attempt.page_errors.push(String(e)));
 const origin=new URL(c.operator_url).origin;
 const token=new URLSearchParams(new URL(c.operator_url).hash.slice(1)).get('token');
 assert.ok(token,'Use the actual original Operator startup receipt');
 const workspace=c.workspace_key,deadlineMs=c.task_timeout_seconds*1000;
 const endpoint=(route,q={})=>route+'?'+new URLSearchParams({workspace,...q});
 async function api(route,body){
  const response=await context.request.fetch(origin+route,{method:body===undefined?'GET':'POST',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},data:body,timeout:60000});
  const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));return value;
 }
 const read=(kind,q={})=>api(endpoint('/api/chemistry/'+kind,q));
 async function screenshot(name){
  const target=path.join(output,'screenshots',c.mode,attempt.id,name+'.png');
  await fs.mkdir(path.dirname(target),{recursive:true});await page.screenshot({path:target,fullPage:true});
  attempt.screenshots.push(await fileRecord(target));await checkpoint();
 }
 async function closeDialogs(){
  for(const [dialog,button]of [['#form-dialog','form-close'],['#detail-dialog','detail-close']]){
   const d=page.locator(dialog);if(await d.count()&&await d.evaluate(n=>n.open))await d.locator('[data-action="'+button+'"]').first().click();
  }
 }
 async function chemistry(){
  await closeDialogs();
  await page.locator('[data-view="chemistry"]').click();
  await page.locator('[data-water-desk]').waitFor();
  await page.waitForFunction(()=>!!document.querySelector('[data-water-template]'));
 }
 async function refresh(){
  await chemistry();
  const response=page.waitForResponse(r=>r.url().startsWith(origin+'/api/chemistry/catalog?'));
  await page.locator('[data-action="chemistry-refresh"]').click();
  assert.ok((await response).ok());
  await page.waitForFunction(()=>!!document.querySelector('[data-water-template]'));
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 }
 async function showTask(id){
  await closeDialogs();
  const panel=page.locator('#task-panel');
  if(!await panel.isVisible())await page.locator('[data-action="tasks"]').first().click();
  if(!await page.locator('[data-action="task-open"][data-id="'+id+'"]').count()){
   await page.locator('[data-action="refresh"]').first().click();
  }
  await page.locator('[data-action="task-open"][data-id="'+id+'"]').click();
  await page.locator('#detail-dialog[open]').waitFor();
 }
 async function awaitTask(stage){
  const deadline=Date.now()+deadlineMs;let resumed=false;
  while(true){
   const task=await api('/api/task?id='+encodeURIComponent(stage.task_id));
   assert.equal(task.action,stage.request.action);
   if(task.operation_id!==undefined){if(stage.native_operation_id)assert.equal(task.operation_id,stage.native_operation_id);else stage.native_operation_id=task.operation_id;}
   if(task.payload!==undefined)same(task.payload,stage.request.payload);
   if(task.state==='complete'){
    stage.result=task.result;stage.completed_at=task.ended_at;stage.state='complete';await checkpoint();return task.result;
   }
   stage.state=task.state;stage.last_observed_at=new Date().toISOString();await checkpoint();
   if((task.state==='interrupted'||task.state==='failed'&&c.resume_failed_tasks)&&!resumed){
    await showTask(task.id);await page.locator('#detail-dialog [data-action="task-resume"]').click();resumed=true;
   }else if(['failed','cancelled'].includes(task.state)){
    throw Error('Original task '+task.id+' '+task.state+': '+JSON.stringify(task.error));
   }
   assert.ok(Date.now()<deadline,'Original task remains active; continue the same saved course: '+stage.task_id);
   await page.waitForTimeout(1200);
  }
 }
 async function mutation(name,action,checkPayload,trigger,{loseResponse=false}={}){
  let stage=saved.stages[name];
  if(stage?.result)return stage.result;
  if(!stage){stage=saved.stages[name]={action,created_at:new Date().toISOString()};await checkpoint();}
  assert.equal(stage.action,action);
  if(!stage.request){
   let resolveSeen,rejectSeen;
   const seen=new Promise((resolve,reject)=>{resolveSeen=resolve;rejectSeen=reject});
   // Attach rejection immediately; actual UI can finish its click later.
   seen.catch(()=>{});
   const handler=async route=>{
    let body;
    try{
     body=route.request().postDataJSON();
     if(body.action!==action){await route.continue();return;}
     assert.equal(body.workspace,workspace);checkPayload(body.payload);
     assert.ok(typeof body.operation_id==='string'&&body.operation_id);
     if(stage.request)same(stage.request,body,'Keep the original complete UI request');
     else {stage.request=clone(body);await checkpoint();}
     if(loseResponse&&!stage.lost_response){
      const response=await route.fetch({timeout:60000});
      const value=await response.json();assert.ok(response.ok(),JSON.stringify(value));
      stage.lost_response={task_id:value.id,retained_at:new Date().toISOString()};
      stage.task_id=value.id;await checkpoint();await route.abort('failed');resolveSeen();
     }else{await route.continue();resolveSeen();}
    }catch(error){rejectSeen(error);try{await route.abort('failed');}catch{}}
   };
   await page.route('**/api/actions',handler);
   let timer;
   try{
    await trigger();
    await Promise.race([seen,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('No matching original UI action was sent; inspect the visible selection before resuming.')),60000);})]);
   }finally{clearTimeout(timer);await page.unroute('**/api/actions',handler);}
   assert.ok(stage.request,'Retain the exact request before sending it');
  }
  checkPayload(stage.request.payload);
  assert.equal(stage.request.workspace,workspace);
  // Same complete native request is the recovery authority, including after a deliberately lost response.
  const task=await api('/api/actions',stage.request);
  assert.ok(task.id);if(stage.task_id)assert.equal(task.id,stage.task_id);
  stage.task_id=task.id;stage.recovered_same_request=true;await checkpoint();
  return awaitTask(stage);
 }
 async function setValue(root,name,value,select=false){
  const n=root.locator('[data-w="'+name+'"]');
  if(select)await n.selectOption(String(value));else await n.fill(String(value));
  await n.dispatchEvent('change');
 }
 function selectionMatches(actual,expected){
  for(const k of ['schema','template_case_id','title','reason','begin','end','period_hours','template_period_policy','signed_value_policy'])
   same(actual[k],expected[k],'Source selection '+k);
  for(const kind of ['flow_bindings','storage_bindings']){
   assert.equal(actual[kind].length,expected[kind].length);
   for(let i=0;i<actual[kind].length;i++)for(const [k,v]of Object.entries(expected[kind][i]))
    same(actual[kind][i][k],v,'Original binding '+kind+'/'+i+'/'+k);
  }
 }
 async function fillSelection(season){
  const s=season.selection;
  await refresh();
  await page.locator('[data-water-template]').selectOption(s.template_case_id);
  await page.locator('[data-action="chemistry-water-template"]').click();
  await page.locator('[data-w="title"]').waitFor();
  for(const k of ['title','reason','begin','end','period_hours'])await setValue(page,k,s[k]);
  for(const k of ['template_period_policy','signed_value_policy'])await setValue(page,k,s[k],true);
  for(const [type,rows,idfield]of [['flow',s.flow_bindings,'flow_id'],['storage',s.storage_bindings,'reach_id']]){
   for(const b of rows){
    const area=page.locator('[data-water-binding][data-type="'+type+'"][data-id="'+b[idfield]+'"]');
    await area.evaluate(n=>n.open=true);
    await area.locator('[data-w="enabled"]').check();
    await area.locator('[data-w="sources"]').selectOption(b.sources.map(x=>JSON.stringify(x)));
    await area.locator('[data-action="chemistry-water-inspect"]').click();
    await area.locator('[data-water-original] code').waitFor();
    for(const k of ['name','office','interval_seconds'])await setValue(area,k,b[k]);
    for(const k of ['format','units','value_support','quality_type'])await setValue(area,k,b[k],true);
    await setValue(area,'quality_codes',b.quality_codes.join(','));
   }
  }
  // Deliberately incomplete ordinary scientific selection, then corrected on the same visible draft.
  const one=page.locator('[data-water-binding][data-type="flow"]').first();
  await setValue(one,'quality_codes','');
  let response=page.waitForResponse(r=>r.url()===origin+'/api/chemistry/water-preview');
  await page.locator('[data-action="chemistry-water-preview"]').click();
  const invalid=await response;assert.ok(!invalid.ok(),'Empty eligible quality codes must be rejected');
  await page.waitForFunction(()=>document.querySelector('[data-chemistry-status]')?.getAttribute('role')==='alert'
    ||document.querySelector('[data-water-status]')?.getAttribute('role')==='alert');
  await screenshot(season.quarter+'-explicit-quality-correction');
  await setValue(one,'quality_codes',s.flow_bindings[0].quality_codes.join(','));
  response=page.waitForResponse(r=>r.url()===origin+'/api/chemistry/water-preview');
  await page.locator('[data-action="chemistry-water-preview"]').click();
  const native=await response;assert.ok(native.ok());const preview=await native.json();
  assert.equal(preview.workspace_key,workspace);assert.equal(preview.state,'ready');
  selectionMatches(preview.support.selection,s);
  assert.equal(preview.support.periods.length,3);
  for(const p of preview.support.periods)for(const flow of Object.values(p.flows)){
   assert.equal(flow.expected_values,168);assert.equal(flow.missing_count,0);
   assert.equal(flow.rejected_quality_count,0);assert.equal(flow.off_grid_count??0,0);
  }
  if(season.quarter==='q4'){
   const observation=preview.support.periods.at(-1).storage[0];
   assert.equal(observation.observed_storage.state,'quality-excluded');
   assert.equal(observation.observed_storage.quality_code,-2147480957);
   assert.equal(observation.observed_minus_predicted_m3,null);
  }
  await page.waitForFunction(()=>document.querySelector('[data-water-preview]')?.textContent.includes('Source periods ready'));
  await screenshot(season.quarter+'-source-periods-desktop');
  await page.setViewportSize({width:390,height:844});await screenshot(season.quarter+'-source-periods-narrow');
  const layout=await page.evaluate(()=>({width:innerWidth,scroll:document.body.scrollWidth}));
  assert.ok(layout.scroll<=layout.width+1,'The source desk must fit the narrow viewport');
  await page.setViewportSize({width:1440,height:1080});
  const selected=clone(preview.support.selection);
  saved.stages[season.quarter+'-preview']={selection:selected,preview};await checkpoint();
  return selected;
 }
 async function openCase(id){
  await refresh();await page.locator('[data-case]').selectOption(id);
  const response=page.waitForResponse(r=>r.url().startsWith(origin+'/api/chemistry/case?')&&new URL(r.url()).searchParams.get('case_id')===id);
  await page.locator('[data-action="chemistry-open"]').click();
  const returned=await response;assert.ok(returned.ok());const native=await returned.json();
  await page.waitForFunction(project=>{
   try{return JSON.stringify(JSON.parse(document.querySelector('[data-project]')?.value))===JSON.stringify(project)}catch{return false}
  },native.project);
  const raw=JSON.parse(await page.locator('[data-project]').inputValue());same(raw,native.project);
  return native;
 }
 async function openRun(id){
  await chemistry();
  const initial=page.waitForResponse(r=>r.url().startsWith(origin+'/api/chemistry/page?')&&new URL(r.url()).searchParams.get('run_id')===id);
  await page.locator('[data-action="chemistry-run-open"][data-id="'+id+'"]').first().click();
  assert.ok((await initial).ok());
  await page.locator('[data-result-field]').waitFor();
  const fields=['final','samples','budgets','storage','storage_budgets'];
  for(const field of fields){
   const response=page.waitForResponse(r=>r.url().startsWith(origin+'/api/chemistry/page?')&&new URL(r.url()).searchParams.get('field')===field);
   await page.locator('[data-result-field]').selectOption(field);
   const native=await response;assert.ok(native.ok());const value=await native.json();
   assert.equal(value.run_id,id);assert.equal(value.field,field);assert.ok(value.total>0,'Original '+field+' rows retained');
   if(field==='storage'||field==='budgets')await screenshot(id.slice(0,10)+'-'+field);
  }
 }
 async function download(ticket,directory){
  assert.ok(ticket.filename&&Number.isInteger(ticket.bytes)&&ticket.sha256);
  const name=ticket.sha256+'-'+path.basename(ticket.filename),destination=path.join(directory,name);
  try{const old=await fileRecord(destination);assert.equal(old.bytes,ticket.bytes);assert.equal(old.sha256,ticket.sha256);return old;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  await fs.mkdir(directory,{recursive:true});
  const url=ticket.url+'?download=1';
  let anchor=page.locator('a[href="'+url+'"]').first();
  if(!await anchor.count()){
   // The same original ticket opens a native download in this authenticated browser.
   await page.evaluate(({url,label})=>{
    let panel=document.querySelector('#receiving-course-downloads');
    if(!panel){panel=document.createElement('section');panel.id='receiving-course-downloads';document.body.append(panel);}
    const a=document.createElement('a');a.href=url;a.textContent=label;a.download='';panel.append(a);
   },{url,label:ticket.filename});
   anchor=page.locator('#receiving-course-downloads a[href="'+url+'"]').first();
  }
  const wait=page.waitForEvent('download',{timeout:deadlineMs});await anchor.click();const got=await wait;
  assert.equal(await got.failure(),null);
  const temp=destination+'.'+randomUUID()+'.pending';
  try{
   await got.saveAs(temp);const d=await fileRecord(temp);assert.equal(d.bytes,ticket.bytes);assert.equal(d.sha256,ticket.sha256);
   const h=await fs.open(temp,'r');try{await h.sync();}finally{await h.close();}
   try{await fs.link(temp,destination);}catch(e){if(e.code!=='EEXIST')throw e;assert.equal((await fileRecord(destination)).sha256,ticket.sha256);}
  }finally{await fs.rm(temp,{force:true});}
  return fileRecord(destination);
 }
 async function allDownloads(value,directory){
  const found=[];
  for(const ticket of value._downloads||[])found.push(await download(ticket,directory));
  assert.ok(found.length,'The original result exposes complete downloadable files');
  return found;
 }
 async function report(id,name){
  await chemistry();
  const response=page.waitForResponse(r=>r.url().startsWith(origin+'/api/chemistry/report?')&&new URL(r.url()).searchParams.get('report_id')===id);
  await page.locator('[data-action="chemistry-report-open"][data-id="'+id+'"]').first().click();
  assert.ok((await response).ok());
  await page.locator('[data-chemistry-report-frame]').waitFor();
  await page.frameLocator('[data-chemistry-report-frame]').locator('body').waitFor();
  const native=await read('report',{report_id:id});
  await screenshot(name+'-scientific-report-desktop');
  await page.setViewportSize({width:390,height:844});await screenshot(name+'-scientific-report-narrow');
  await page.setViewportSize({width:1440,height:1080});
  return native;
 }
 async function inspectCurrent(cases,runs,reports=[]){
  await refresh();
  for(const id of cases){await openCase(id);await screenshot('reopened-case-'+id.slice(0,10));}
  for(const id of runs)await openRun(id);
  for(const id of reports)await report(id,'reopened-'+id.slice(0,10));
 }
 try{
  await page.goto(c.operator_url,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>document.querySelector('#workspace-select')?.options.length>0);
  const state=await api(endpoint('/api/state'));
  assert.equal(state.data.project.id,c.mode==='editable'?c.editable.project.id:input.workspace_id);
  if(c.mode==='operate'){
   for(const season of input.seasons){
    let existing=saved.seasons.find(x=>x.quarter===season.quarter);
    if(existing)continue;
    const key=season.quarter;
    let selected=saved.stages[key+'-prepare']?.request?.payload?.selection;
    if(!selected)selected=await fillSelection(season);
    const prepared=await mutation(key+'-prepare','chemistry.water.prepare',
      p=>selectionMatches(p.selection,season.selection),
      ()=>page.locator('[data-action="chemistry-water-prepare"]').click(),{loseResponse:key==='q1'});
    assert.ok(prepared.case_id);await closeDialogs();
    const prep=await read('water-preparation',{preparation_id:prepared.id});
    await refresh();await page.locator('[data-action="chemistry-water-open"][data-id="'+prepared.id+'"]').click();
    await page.locator('[data-water-opened] h3').waitFor();
    const downloads=await allDownloads(prep,path.join(output,'downloads',key,'preparation'));
    await openCase(prepared.case_id);
    await page.locator('[data-mode]').selectOption(input.request.mode);
    await page.locator('[data-sample-days]').fill(input.request.sample_days.join(', '));
    await page.locator('[data-sample-days]').dispatchEvent('change');
    const run=await mutation(key+'-run','chemistry.run',
      p=>{assert.equal(p.case_id,prepared.case_id);same(p.request,input.request);},
      ()=>page.locator('[data-action="chemistry-execute"]').click());
    assert.equal(run.state,'complete');assert.equal(run.case_id,prepared.case_id);
    await refresh();await openRun(run.id);
    const runView=await read('run',{run_id:run.id});
    downloads.push(...await allDownloads(runView,path.join(output,'downloads',key,'analysis')));
    const scientific=await mutation(key+'-report','chemistry.report.prepare',
      p=>assert.equal(p.run_id,run.id),
      ()=>page.locator('[data-action="chemistry-report-prepare"][data-id="'+run.id+'"]').click());
    await refresh();const reportView=await report(scientific.id,key);
    downloads.push(...await allDownloads(reportView,path.join(output,'downloads',key,'report')));
    await openCase(prepared.case_id);
    const exported=await mutation(key+'-export','chemistry.export',
      p=>{assert.equal(p.case_id,prepared.case_id);assert.ok(p.run_ids.includes(run.id));},
      ()=>page.locator('[data-action="chemistry-export"]').click(),{loseResponse:key==='q4'});
    await showTask(saved.stages[key+'-export'].task_id);
    const exportTask=await api('/api/task?id='+saved.stages[key+'-export'].task_id);
    const exportedFiles=await allDownloads(exportTask,path.join(output,'downloads',key,'editable'));
    const editable=exportedFiles.find(x=>x.sha256===exported.artifact.sha256);
    assert.ok(editable,'Retain the original complete editable ZIP');
    downloads.push(...exportedFiles);
    const item={quarter:key,preparation_id:prepared.id,case_id:prepared.case_id,run_id:run.id,
      report_id:scientific.id,export_id:exported.id,editable,downloads,
      source_selection_sha256:prep.selection_sha256};
    saved.seasons.push(item);await checkpoint();
   }
   assert.equal(saved.seasons.length,4);
   // Cold browser reload preserves all original source/case/run identities.
   await page.reload({waitUntil:'domcontentloaded'});
   await page.waitForFunction(()=>document.querySelector('#workspace-select')?.options.length>0);
   await inspectCurrent(saved.seasons.map(x=>x.case_id),saved.seasons.map(x=>x.run_id),[saved.seasons[0].report_id]);
  }else if(c.mode==='editable'){
   for(const season of c.editable.seasons){
    await refresh();
    const selected={source_collection_id:c.editable.receive_source_collection_id,source_id:season.quarter};
    await page.locator('[data-source]').selectOption(JSON.stringify(selected));
    const received=await mutation('recipient-'+season.quarter,'chemistry.receive',
      p=>same(p,selected),()=>page.locator('[data-action="chemistry-receive"]').click());
    const {_downloads,...retainedReceipt}=received;
    same(retainedReceipt,season.receipt,'The actual recipient UI reopens the original archive receipt');
    await closeDialogs();
   }
   const cases=c.editable.seasons.map(x=>x.receipt.case_id);
   const runs=c.editable.seasons.flatMap(x=>x.receipt.adopted_runs.map(r=>r.run_id));
   await inspectCurrent([...cases,c.editable.later_case.id],runs);
   saved.receiving=clone(c.editable);
  }else if(c.mode==='reopened'){
   const rows=c.original_browser.seasons;
   await inspectCurrent(rows.map(x=>x.case_id),rows.map(x=>x.run_id),rows.map(x=>x.report_id));
   saved.seasons=clone(rows);
  }else{
   await closeDialogs();
   const unique=[...new Map(c.attachments.map(x=>[x.path,x])).values()];
   saved.attachment_views||=[];
   // Every report's complete archive has already been retained and extracted by the native course.
   for(const f of unique){
    same(await fileRecord(f.path),{path:f.path,bytes:f.bytes,sha256:f.sha256});
    if(/\.zip$/i.test(f.path))continue;
    if(saved.attachment_views.some(x=>x.path===f.path&&x.sha256===f.sha256))continue;
    const extension=path.extname(f.path).toLowerCase();
    const viewer=await context.newPage();
    const requestErrors=[];
    viewer.on('pageerror',e=>requestErrors.push(String(e)));
    await viewer.route('**/*',route=>/^(?:file|data|about):/.test(route.request().url())?route.continue():route.abort());
    const shots=[];
    try{
     if(['.html','.htm','.svg','.png','.jpg','.jpeg','.pdf'].includes(extension)){
      await viewer.goto(pathToFileURL(f.path).href,{waitUntil:'load'});
     }else{
      const bytes=await fs.readFile(f.path);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const html='<!doctype html><html><meta charset="utf-8"><title>'+esc(path.basename(f.path))+'</title><style>body{font:15px system-ui;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}code{overflow-wrap:anywhere}</style><h1>'+esc(path.basename(f.path))+'</h1><p>'+f.bytes+' bytes · <code>'+f.sha256+'</code></p><pre>'+esc(text)+'</pre></html>';
      const viewFile=path.join(output,'attachment-views',f.sha256+'.html');
      await exact(viewFile,Buffer.from(html));await viewer.goto(pathToFileURL(viewFile).href);
     }
     await viewer.locator('body').waitFor();
     for(const width of [1440,390]){
      await viewer.setViewportSize({width,height:width===1440?1080:844});
      const img=path.join(output,'screenshots','attachments',f.sha256+'-'+width+'.png');
      await fs.mkdir(path.dirname(img),{recursive:true});
      await viewer.screenshot({path:img,fullPage:true});shots.push(await fileRecord(img));
     }
     assert.deepEqual(requestErrors,[]);
     saved.attachment_views.push({...f,screenshots:shots,rendered:true});
     await checkpoint();
    }finally{await viewer.close();}
   }
  }
  assert.deepEqual(attempt.page_errors,[]);
  attempt.complete=true;attempt.completed_at=new Date().toISOString();
  saved.complete=true;saved.completed_at=attempt.completed_at;
  saved.producer_view_required='The original producing owner must open these screenshots and inspect the exact outgoing reports and controls; automated capture is not a human/agent visual review.';
  await checkpoint();return {complete:true,result:await fileRecord(statePath),seasons:saved.seasons};
 }catch(error){
  attempt.error={name:error.name,message:error.message,stack:error.stack};await checkpoint();throw error;
 }finally{
  await context.close();if(!borrowedBrowser)await browser.close();
 }
}

if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)){
 if(process.argv.length!==3)throw Error('Usage: node receiving_water_browser.mjs PRIVATE_CONTROL.json');
 const c=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
 console.log(JSON.stringify(await runReceivingWaterBrowser(c)));
}
