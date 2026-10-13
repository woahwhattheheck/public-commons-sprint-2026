#!/usr/bin/env node
/** Receive the actual completed WO07 native case through its original operator and report. */
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';

const sha=body=>createHash('sha256').update(body).digest('hex');
const canonical=value=>JSON.stringify(value&&typeof value==='object'
  ?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))]))
  :value);
const equal=(a,b,message)=>assert.equal(canonical(a),canonical(b),message);
const attr=(name,value)=>'['+name+'='+JSON.stringify(String(value))+']';
const metrics=['stable_ha','changed_ha','returned_to_initial_ha','persistent_final_ha','unconfirmed_final_ha',
  'forest_internal_only_ha','forest_entry_ha','forest_exit_ha','forest_returned_ha'];
async function fileRecord(filename){
 const hash=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(filename)){hash.update(chunk);bytes+=chunk.length;}
 return {path:path.resolve(filename),bytes,sha256:hash.digest('hex')};
}
async function readJSON(filename){return JSON.parse(await fs.readFile(filename,'utf8'));}
async function main(){
 assert.equal(process.argv.length,3,'Usage: node operator/landcover_timeline_browser.mjs PRIVATE_CONTROL.json');
 const controlPath=path.resolve(process.argv[2]),c=await readJSON(controlPath),base=path.dirname(controlPath);
 const resolve=value=>path.resolve(base,value);
 for(const field of ['output','model_receiving','selection_file','workspace_key','workspace_path'])
  assert.ok(typeof c[field]==='string'&&c[field], 'Select the explicit original '+field+'.');
 assert.ok(c.ready_file||c.operator_url,'Select the current original operator ready file or private operator URL.');
 assert.ok(c.mode===undefined||['existing','build-if-identical'].includes(c.mode),'Use existing or build-if-identical mode.');
 const mode=c.mode||'existing',applicationRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 const modelFile=resolve(c.model_receiving),selectionFile=resolve(c.selection_file);
 const native=await readJSON(modelFile),selected=await readJSON(selectionFile);
 assert.equal(native.schema,'upstate.landcover-timeline-receiving/v1');assert.equal(native.state,'complete');
 assert.ok(native.source_edition_reopened&&native.portable_report?.path,'First finish the unchanged original native receiving operation.');
 assert.equal(selected.input_mode,'timeline');
 assert.ok(/^[a-f0-9]{64}$/.test(native.edition_id)&&/^[a-f0-9]{64}$/.test(native.signature));
 equal(selected.annual_sources.map(x=>x.year),native.observation_years,'Use the original selected observation years.');
 assert.equal(await fs.realpath(resolve(c.workspace_path)),await fs.realpath(native.workspace),
  'This course operates only the explicitly selected native case, never another populated Workspace.');
 const workspacePath=await fs.realpath(native.workspace),workspace=c.workspace_key;
 const project=await readJSON(path.join(workspacePath,'workspace.json'));
 assert.equal(project.schema,'upstate.workspace/v1','Select the original scientific Workspace manifest.');
 const editionPath=path.join(workspacePath,'landcover-ledgers',native.edition_id);
 const originalEdition=await readJSON(path.join(editionPath,'edition.json'));
 assert.equal(originalEdition.workspace_id,project.id);
 equal(originalEdition.selection,selected,'Select the exact native input file retained with receiving.json.');
 const originalReport=await readJSON(path.join(editionPath,originalEdition.files['ledger.json'].path));
 assert.equal(originalReport.signature,native.signature);assert.equal(originalReport.complete,true);
 equal(originalReport.timeline.years,native.observation_years);
 const output=resolve(c.output);
 assert.ok(output!==workspacePath&&!output.startsWith(workspacePath+path.sep)&&!workspacePath.startsWith(output+path.sep),'Keep the browser output and scientific Workspace in separate directories.');
 await fs.mkdir(output,{recursive:true,mode:0o700});
 const lock=path.join(output,'.landcover-browser-active');
 await fs.mkdir(lock,{mode:0o700}).catch(error=>{throw Error('This receiving output is already owned by a process; reconcile its original lock before resuming. '+error.message);});
 let ready,operatorURL,capability,origin,browser,context,page,child,stopRequested=null;
 const ownedContexts=new Set();let ownsBrowser=false,report,attempt,failure;
 const progress=path.join(output,'landcover-timeline-browser.json');
 const checkStop=()=>{if(stopRequested)throw Error('Operator requested '+stopRequested+'; retained original task is not cancelled.');};
 async function checkpoint(){
  if(!report)return;
  const temporary=progress+'.'+randomUUID()+'.pending';
  try{const f=await fs.open(temporary,'wx',0o600);try{await f.writeFile(JSON.stringify(report,null,2)+'\n');await f.sync();}finally{await f.close();}await fs.rename(temporary,progress);}
  finally{await fs.rm(temporary,{force:true});}
 }
 const onSignal=signal=>{
  stopRequested=signal;if(child&&!child.killed)child.kill('SIGTERM');
  for(const own of ownedContexts)void own.close().catch(()=>{});
 };
 const onINT=()=>onSignal('SIGINT'),onTERM=()=>onSignal('SIGTERM');
 process.on('SIGINT',onINT);process.on('SIGTERM',onTERM);
 async function retainFile(name,body){
  const destination=path.join(output,name);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
  try{await fs.writeFile(destination,body,{flag:'wx',mode:0o600});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.equal(sha(await fs.readFile(destination)),sha(body),'Retained output changed: '+name);}
  return fileRecord(destination);
 }
 function safeRelative(name){
  assert.ok(typeof name==='string'&&name&&!name.includes('\\')&&!path.isAbsolute(name)&&name.split('/').every(s=>s&&s!=='.'&&s!=='..'),'Invalid original relative file name.');
  return name;
 }
 const endpoint=(route,values={})=>route+'?'+new URLSearchParams({workspace,...values});
 async function api(route,body){
  checkStop();const response=await context.request.fetch(origin+route,{method:body===undefined?'GET':'POST',
   headers:{Authorization:'Bearer '+capability,'Content-Type':'application/json'},data:body,timeout:60000});
  const value=await response.json();assert.ok(response.ok(),JSON.stringify({path:new URL(origin+route).pathname,status:response.status(),value}));return value;
 }
 async function sourceGET(url,expected){
  const response=await context.request.get(origin+url,{headers:{Authorization:'Bearer '+capability},timeout:60000});
  assert.ok(response.ok(),'Original served file is unavailable: '+url);const body=await response.body();
  assert.equal(body.length,expected.bytes,'Served source length changed: '+url);assert.equal(sha(body),expected.sha256,'Served source changed: '+url);
 }
 async function closeContext(){
  if(context){const old=context;context=null;await old.close();ownedContexts.delete(old);}
 }
 async function newContext(width){
  checkStop();context=await browser.newContext({viewport:{width,height:width===390?844:1080},acceptDownloads:true,locale:'en-US',timezoneId:'America/New_York'});
  ownedContexts.add(context);
  await context.addInitScript(({origin,workspace})=>{if(location.origin===origin)sessionStorage.setItem('upstate-selected-workspace',workspace);},{origin,workspace});
  page=await context.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',error=>attempt.page_errors.push(String(error)));
  page.on('response',response=>{if(response.url().startsWith(origin+'/api/')&&response.status()>=400)
   attempt.http_errors.push({status:response.status(),path:new URL(response.url()).pathname});});
  // This is a private receiving context. No unrelated scientific or workspace mutation is admitted.
  await context.route('**/api/actions',async route=>{
   const request=route.request().postDataJSON();
   if(mode!=='build-if-identical'||request.action!=='landcover.ledger.build'||request.workspace!==workspace){
    attempt.blocked_action={action:request.action,workspace:request.workspace};await checkpoint();await route.abort('blockedbyclient');return;
   }
   equal(request.payload,selected,'A browser action must retain the complete original native selection.');
   report.build ||= {action:'landcover.ledger.build'};
   if(report.build.request)equal(request,report.build.request,'Do not dispatch a second operation identity.');
   else report.build.request=request;
   await checkpoint();await route.continue();
  });
  for(const row of report.application_files.filter(x=>x.name.startsWith('operator/web/')))
   await sourceGET('/web/'+row.name.slice('operator/web/'.length),row);
  await page.goto(operatorURL.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(key=>document.querySelector('#workspace-select')?.value===key,workspace);
  const state=await api(endpoint('/api/state'));assert.equal(state.workspace_key,workspace);assert.equal(state.data.project.id,project.id);
  const catalog=await api(endpoint('/api/landcover-ledger/catalog'));assert.equal(catalog.workspace_id,project.id);
  assert.ok(catalog.editions.some(x=>x.id===native.edition_id),'The selected original native edition is not in this Workspace.');
  await page.locator('[data-view="landcover-ledger"]').click();
  await page.locator('.landcover-extension [data-action="check"]:enabled').waitFor();
  return catalog;
 }
 const root=()=>page.locator('.landcover-extension');
 async function capture(label,target=page){
  checkStop();const filename=path.join(output,'images','attempt-'+report.attempts.length+'-'+label+'.png');
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  await target.screenshot({path:filename,...(target===page?{fullPage:true}:{})});
  attempt.images.push({label,...await fileRecord(filename)});await checkpoint();
 }
 async function download(locator,name,descriptor){
  checkStop();const pending=page.waitForEvent('download',{timeout:60000});
  await locator.click();const transfer=await pending;assert.equal(await transfer.failure(),null);
  const temporary=path.join(output,'.download-'+randomUUID());
  try{
   await transfer.saveAs(temporary);const observed=await fileRecord(temporary);
   if(descriptor){assert.equal(observed.bytes,descriptor.bytes);assert.equal(observed.sha256,descriptor.sha256);}
   const destination=path.join(output,safeRelative(name));await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});
   try{await fs.link(temporary,destination);}catch(error){if(error.code!=='EEXIST')throw error;const old=await fileRecord(destination);assert.equal(old.bytes,observed.bytes);assert.equal(old.sha256,observed.sha256);}
   return {...observed,path:destination,suggested_filename:transfer.suggestedFilename()};
  }finally{await fs.rm(temporary,{force:true});}
 }
 async function fillInputs(){
  const r=root(),d=selected;
  await r.locator('[name="input_mode"]').selectOption('timeline');
  while(await r.locator('[data-timeline-row]').count()<d.annual_sources.length)await r.locator('[data-action="add-year"]').click();
  while(await r.locator('[data-timeline-row]').count()>d.annual_sources.length)await r.locator('[data-action="remove-year"]').last().click();
  await r.locator('[name="title"]').fill(d.title);
  for(let i=0;i<d.annual_sources.length;i++){
   const row=r.locator('[data-timeline-row]').nth(i),item=d.annual_sources[i];
   await row.locator('[data-year-source]').selectOption(JSON.stringify([item.source_collection_id,item.source_id]));
   await row.locator('[data-year-value]').fill(String(item.year));await row.locator('[data-year-band]').fill(String(item.band));
  }
  await r.locator('[name="zones"]').selectOption(JSON.stringify([d.zones.source_collection_id,d.zones.source_id]));
  for(const [name,value]of [['id_field',d.zones.id_field??'huc12'],['name_field',d.zones.name_field??'name'],['layer',d.zones.layer||''],['ids',(d.zones.ids||[]).join('\n')]])await r.locator('[name="'+name+'"]').fill(value);
  await r.locator('[name="unknown"]').selectOption(d.options?.unknown_policy||'error');
  await r.locator('[name="overlap"]').setChecked(Boolean(d.options?.allow_overlap));
  await r.locator('[name="projected_area"]').setChecked(Boolean(d.options?.allow_projected_area));
  assert.equal(await r.locator('[name="support"]').inputValue(),'all');
  assert.ok(await r.locator('[name="support"]').isDisabled());
 }
 async function exerciseInputPreservation(){
  const r=root(),first=r.locator('[data-timeline-row]').first();
  await first.locator('[data-year-band]').fill('');
  await first.locator('[data-action="year-down"]').click();
  assert.equal(await r.locator('[data-timeline-row]').nth(1).locator('[data-year-band]').inputValue(),'');
  const refreshed=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/landcover-ledger/catalog');
  await r.locator('[data-action="refresh"]').click();assert.ok((await refreshed).ok());
  await page.waitForFunction(()=>document.querySelector('.landcover-extension [data-note]')?.textContent.includes('retained raster sources'));
  assert.equal(await r.locator('[data-timeline-row]').nth(1).locator('[data-year-band]').inputValue(),'','Unfinished band must survive refresh.');
  await r.locator('[data-timeline-row]').nth(1).locator('[data-year-band]').fill(String(selected.annual_sources[0].band));
  await r.locator('[data-action="check"]').click();
  await r.locator('[data-note][role="alert"]').waitFor();
  assert.match(await r.locator('[data-note]').innerText(),/strictly increasing/);
  await r.locator('[data-timeline-row]').nth(1).locator('[data-action="year-up"]').click();
  attempt.input_order_and_blank_preserved=true;await checkpoint();
 }
 async function checkedInputs(){
  const response=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/landcover-ledger/inputs'&&x.request().method()==='POST');
  await root().locator('[data-action="check"]').click();
  const returned=await response,value=await returned.json();assert.ok(returned.ok(),JSON.stringify(value));
  equal(value.selection.annual_sources,selected.annual_sources);equal(value.selection.zones,selected.zones);
  assert.equal(value.selection.title,selected.title);assert.equal(value.selection.options.support_scope,'all');
  await root().locator('[data-input-preview]:not([hidden]) h2').first().waitFor();
  assert.match(await root().locator('[data-input-preview]').innerText(),/Checked observation sequence/);
  report.visible_input_preview=value;await checkpoint();return value;
 }
 async function taskResult(stage){
  const until=Date.now()+(c.task_timeout_seconds||1800)*1000;
  for(;;){
   checkStop();const task=await api('/api/task?id='+encodeURIComponent(stage.task_id));
   assert.equal(task.workspace,workspace);assert.equal(task.action,'landcover.ledger.build');equal(task.payload,selected);
   stage.state=task.state;await checkpoint();
   if(task.state==='complete'){assert.equal(task.result.id,native.edition_id);stage.result=task.result;await checkpoint();return;}
   assert.ok(['queued','running'].includes(task.state),'Original task '+task.id+' is '+task.state+'. Reconcile/resume that original task before continuing.');
   assert.ok(Date.now()<until,'Original task remains active. It is retained; rerun this exact control/progress after it completes.');
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
 }
 async function buildOrReturn(preview){
  if(mode==='existing'){
   report.build={mode:'existing',edition_id:native.edition_id,reason:'The unchanged native receiving operation has already built and independently reopened this exact edition.'};await checkpoint();return;
  }
  equal(preview.selection,selected,'The visible UI selection differs from retained native options. Use existing mode; never substitute another calculation.');
  if(report.build?.request&&!report.build.task_id){
   const state=await api(endpoint('/api/state'));
   const existing=state.tasks.find(x=>x.operation_id===report.build.request.operation_id);
   const task=existing||await api('/api/actions',report.build.request);
   report.build.task_id=task.id;await checkpoint();
  }
  if(!report.build?.task_id){
   const response=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/actions'&&x.request().postDataJSON()?.action==='landcover.ledger.build');
   await root().locator('form [type="submit"]').click();const returned=await response,value=await returned.json();
   assert.ok(returned.ok(),JSON.stringify(value));assert.ok(report.build?.request,'Original UI operation must be retained before dispatch.');
   report.build.task_id=value.id;await checkpoint();
  }
  await taskResult(report.build);
 }
 async function openEdition(){
  const r=root();
  const refreshed=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/landcover-ledger/catalog');
  await r.locator('[data-action="refresh"]').click();assert.ok((await refreshed).ok());
  await r.locator('[name="edition"] option'+attr('value',native.edition_id)).waitFor({state:'attached'});
  await r.locator('[name="edition"]').selectOption(native.edition_id);
  const response=page.waitForResponse(x=>new URL(x.url()).pathname==='/api/landcover-ledger/edition'&&new URL(x.url()).searchParams.get('id')===native.edition_id);
  await r.locator('[data-action="open"]').click();const returned=await response,value=await returned.json();
  assert.ok(returned.ok(),JSON.stringify(value));equal(value.edition,originalEdition);equal(value.report,originalReport);
  const iframe=r.locator('[data-result] iframe');await iframe.waitFor();
  const frame=await iframe.contentFrame();
  await frame.locator('#metric option[value="timeline:forest_returned_ha"]').waitFor({state:'attached'});
  equal(await frame.locator('#ledger-data').evaluate(el=>JSON.parse(el.textContent)),originalReport);
  assert.equal(await frame.locator('#error').isVisible(),false);
  return {value,iframe,frame};
 }
 async function inspectMetrics(frame,width,label,iframe){
  const available=await frame.locator('#metric option').evaluateAll(options=>options.map(x=>x.value));
  for(const key of metrics)assert.ok(available.includes('timeline:'+key),'Current original history metric '+key);
  const expectedRows=originalReport.timeline.rows.filter(x=>x.zone_id!=='__domain__');
  const readValues=()=>frame.locator('#map-value-table tbody tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(x=>x.textContent)));
  for(const key of metrics){
   checkStop();await frame.locator('#metric').selectOption('timeline:'+key);
   const note=await frame.locator('#map-metric-note').innerText();assert.ok(note.includes(originalReport.timeline.years.join(' → ')));assert.match(note,/not interpolated/);
   if((await frame.locator('#map-values').getAttribute('open'))===null)await frame.locator('#map-values > summary').click();
   const values=await readValues();
   assert.equal(values.length,expectedRows.length);
   for(const row of expectedRows){
    const found=values.find(v=>v[0]===row.zone_id);assert.ok(found,'Retained original area '+row.zone_id);
    const value=key==='forest_returned_ha'?row.groups?.forest?.returned_ha:row.summary?.[key];
    const shown=typeof value==='number'&&Number.isFinite(value)?value.toLocaleString('en-US',{minimumFractionDigits:4,maximumFractionDigits:4})+' ha':'Unavailable';
    assert.equal(found.at(-1),shown,'Displayed original map quantity '+row.zone_id+'/'+key);
   }
   if(originalReport.scenarios.length>1){
    const before=await readValues();
    await frame.locator('#scenario').selectOption(originalReport.scenarios.at(-1));
    equal(await readValues(),before,'History map must remain independent of the selected pair.');
    assert.ok((await frame.locator('#comparison-detail-note').innerText()).includes(await frame.locator('#scenario option:checked').innerText()));
    await frame.locator('#scenario').selectOption(originalReport.scenarios[0]);
   }
   await frame.locator('#map').scrollIntoViewIfNeeded();
   await capture(label+'-'+width+'-'+key,iframe||page);
   attempt.metric_views.push({label,width,metric:key,areas:values.length});
  }
  const feature=frame.locator('#map path.zone').first();
  if(await feature.count()){
   await feature.focus();await feature.press('Enter');
   assert.ok(await frame.locator('#map path.zone.selected').count(),'Keyboard selection keeps the original mapped reporting area.');
  }
  await frame.locator('#search').fill('__no_original_area_'+randomUUID());
  assert.equal(await frame.locator('#map-value-table tbody tr td').innerText(),'No watershed matches this search.');
  await frame.locator('#reset').click();
  const layout=await frame.locator('body').evaluate(el=>({scroll:el.scrollWidth,width:innerWidth}));
  assert.ok(layout.scroll<=layout.width+1,'Original report overflows its viewport: '+JSON.stringify(layout));
  await checkpoint();
 }
 async function receivePortable(archive){
  assert.ok(typeof c.python==='string'&&c.python,'Supply the existing Python runtime for the original portable report reader.');
  const destination=path.join(output,'portable-received');
  if(report.portable_received){
   assert.equal(report.portable_received.signature,native.signature);equal(await readJSON(path.join(destination,'ledger.json')),originalReport);return destination;
  }
  try{await fs.access(destination);throw Error('An interrupted portable receive directory exists. Retain it and select a fresh output, or reconcile its original receive before resuming.');}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const code='import json,sys\nfrom model.landcover_exports import receive_portable\nprint(json.dumps(receive_portable(sys.argv[1],sys.argv[2])))\n';
  const stdout=[],stderr=[];
  const owned=spawn(c.python,['-c',code,archive.path,destination],{cwd:applicationRoot,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
  child=owned;
  const done=new Promise((resolve,reject)=>{owned.once('error',reject);owned.once('close',(code,signal)=>resolve({code,signal}));});
  owned.stdout.on('data',x=>stdout.push(x));owned.stderr.on('data',x=>stderr.push(x));
  if(stopRequested)owned.kill('SIGTERM');
  const result=await done;child=null;
  report.portable_process={...result,stderr:Buffer.concat(stderr).toString('utf8')};await checkpoint();
  assert.equal(result.code,0,'Original portable receiving failed; complete archive and returned process state are retained.');
  const received=JSON.parse(Buffer.concat(stdout).toString('utf8'));assert.equal(received.signature,native.signature);
  equal(await readJSON(path.join(destination,'ledger.json')),originalReport);
  report.portable_received=received;await checkpoint();return destination;
 }
 try{
  let readyText=c.ready_file?await fs.readFile(resolve(c.ready_file),'utf8'):null;
  if(readyText){try{ready=JSON.parse(readyText);}catch{for(const line of readyText.split(/\r?\n/).reverse()){try{const row=JSON.parse(line);if(row.operator_url){ready=row;break;}}catch{}}}}
  operatorURL=new URL(c.operator_url||ready?.operator_url);
  assert.ok(['http:','https:'].includes(operatorURL.protocol)&&!operatorURL.username&&!operatorURL.password);
  assert.ok(['127.0.0.1','localhost','[::1]'].includes(operatorURL.hostname),'Use the existing local operator capability; no replacement server or guessed remote endpoint.');
  origin=operatorURL.origin;capability=new URLSearchParams(operatorURL.hash.slice(1)).get('token');assert.ok(capability);
  if(ready?.workspace_key)assert.equal(ready.workspace_key,workspace,'Select this original server primary workspace explicitly.');
  if(ready?.project?.id)assert.equal(ready.project.id,project.id);
  const applicationNames=['operator/landcover_timeline_browser.mjs','operator/LANDCOVER_TIMELINE_BROWSER.md',
   'operator/web/index.html','operator/web/app.mjs','operator/web/landcover_ledger.mjs','operator/web/landcover_ledger.css',
   'operator/extensions/landcover-ledger.json','operator/landcover_operator.py','model/landcover_timeline_receiving.py','model/landcover_report.html'];
  const applicationFiles=[];
  for(const name of applicationNames){
   const body=await fs.readFile(path.join(applicationRoot,name));applicationFiles.push({name,bytes:body.length,sha256:sha(body)});
   await retainFile('source/'+name,body);
  }
  const modelIdentity=await fileRecord(modelFile),selectionIdentity=await fileRecord(selectionFile);
  const identity=sha(canonical({workspace,project_id:project.id,edition_id:native.edition_id,signature:native.signature,mode,
   model_sha256:modelIdentity.sha256,selection_sha256:selectionIdentity.sha256,application_files:applicationFiles}));
  try{report=await readJSON(progress);assert.equal(report.identity,identity,'Keep the same complete native selection and application source on resume.');}
  catch(error){if(error.code!=='ENOENT')throw error;report={schema:'upstate.landcover-timeline-browser/v1',identity,workspace_key:workspace,project_id:project.id,
   native_receiving:{...modelIdentity,input_kind:native.input_kind},selection_file:selectionIdentity,edition_id:native.edition_id,
   signature:native.signature,observation_years:native.observation_years,application_files:applicationFiles,attempts:[],downloads:[]};}
  attempt={started_at:new Date().toISOString(),images:[],metric_views:[],page_errors:[],http_errors:[],stage:'original_source'};
  report.attempts.push(attempt);report.complete=false;report.visual_review='PENDING_PRODUCING_PEER_IMAGE_INSPECTION';await checkpoint();
  await retainFile('original-receiving.json',await fs.readFile(modelFile));await retainFile('original-selected-inputs.json',await fs.readFile(selectionFile));
  await retainFile('original-edition.json',Buffer.from(JSON.stringify(originalEdition,null,2)+'\n'));
  let modulePath=c.playwright_module?resolve(c.playwright_module):c.node_modules?path.join(resolve(c.node_modules),'playwright/index.mjs'):null;
  const {chromium}=modulePath?await import(pathToFileURL(modulePath).href):await import('playwright');
  if(c.cdp_endpoint){
   assert.ok(modulePath,'For an attached browser supply the installed Playwright module path so its noDefaults version can be checked.');
   let directory=path.dirname(modulePath),version;
   for(let i=0;i<4&&!version;i++){try{const pkg=await readJSON(path.join(directory,'package.json'));if(/^playwright(?:-core)?$/.test(pkg.name))version=pkg.version;}catch(error){if(error.code!=='ENOENT')throw error;}directory=path.dirname(directory);}
   const parts=String(version||'').split('.').map(Number);assert.ok(parts[0]>1||parts[0]===1&&parts[1]>=60,'Attached private contexts require installed Playwright 1.60 or later.');
   browser=await chromium.connectOverCDP(c.cdp_endpoint,{noDefaults:true});ownsBrowser=false;
  }else{
   assert.ok(c.chromium,'Supply the existing Chromium executable; this course installs no runtime.');
   browser=await chromium.launch({headless:true,executablePath:c.chromium,args:['--no-sandbox','--disable-dev-shm-usage']});ownsBrowser=true;
  }
  attempt.stage='original_operator';await checkpoint();await newContext(1440);
  await fillInputs();await exerciseInputPreservation();const preview=await checkedInputs();
  await capture('desktop-checked-inputs');
  report.input_selection_download=await download(root().locator('[data-action="save-selection"]'),'land-cover-input-selection.json');
  const savedSelection=await readJSON(report.input_selection_download.path);
  assert.equal(savedSelection.workspace_key,workspace);assert.equal(savedSelection.workspace_id,project.id);
  equal(savedSelection.draft.annual_sources,selected.annual_sources.map(x=>({ref:JSON.stringify([x.source_collection_id,x.source_id]),year:String(x.year),band:String(x.band)})));
  await buildOrReturn(preview);let opened=await openEdition();
  await sourceGET(opened.value.preview_url,originalEdition.files['report.html']);
  await capture('desktop-original-edition');
  await inspectMetrics(opened.frame,1440,'embedded',opened.iframe);
  attempt.stage='original_downloads';await checkpoint();
  for(const [name,descriptor]of Object.entries(originalEdition.files)){
   const candidates=opened.value._downloads.filter(x=>x.sha256===descriptor.sha256&&x.bytes===descriptor.bytes);
   const ticket=candidates.find(x=>x.filename===path.basename(descriptor.path))||candidates[0];
   assert.ok(ticket,'Original visible file ticket '+name);
   const received=await download(root().locator('.lc-downloads a'+attr('href',ticket.url||ticket.href)).first(),
    'downloads/'+safeRelative(path.basename(descriptor.path)),descriptor);
   report.downloads=report.downloads.filter(x=>x.name!==name);report.downloads.push({name,...received});await checkpoint();
  }
  const archive=report.downloads.find(x=>x.name==='archive');assert.ok(archive);
  const portable=await receivePortable(archive);
  attempt.stage='cold_phone_operator';await checkpoint();await closeContext();await newContext(390);
  const dialog=page.waitForEvent('dialog');const opening=root().locator('[data-open-selection]').setInputFiles(report.input_selection_download.path);
  const confirmation=await dialog;assert.match(confirmation.message(),/Replace the current input fields/);await confirmation.accept();await opening;
  await page.waitForFunction(()=>document.querySelector('.landcover-extension [data-note]')?.textContent.includes('Original saved input fields reopened.'));
  await checkedInputs();await capture('phone-reopened-inputs');opened=await openEdition();
  await inspectMetrics(opened.frame,390,'embedded-cold',opened.iframe);await capture('phone-reopened-edition');
  const phoneLayout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth}));
  assert.ok(phoneLayout.scroll<=phoneLayout.width+1,'Operator page overflows 390 pixels.');
  attempt.phone_layout=phoneLayout;
  await closeContext();
  attempt.stage='portable_report_reopen';await checkpoint();
  for(const width of [1440,390]){
   checkStop();context=await browser.newContext({viewport:{width,height:width===390?844:1080},acceptDownloads:true,locale:'en-US'});
   ownedContexts.add(context);page=await context.newPage();page.setDefaultTimeout(60000);
   page.on('pageerror',error=>attempt.page_errors.push(String(error)));
   const reportFile=path.join(portable,'report.html'),body=await fs.readFile(reportFile);
   assert.equal(body.length,originalEdition.files['report.html'].bytes);assert.equal(sha(body),originalEdition.files['report.html'].sha256);
   // Open the complete original received standalone HTML on our owned blank document; no origin is invented.
   await page.setContent(body.toString('utf8'),{waitUntil:'load'});
   await page.locator('#metric option[value="timeline:forest_returned_ha"]').waitFor({state:'attached'});
   equal(await page.locator('#ledger-data').evaluate(el=>JSON.parse(el.textContent)),originalReport);
   await page.locator('#load').setInputFiles(path.join(portable,'ledger.json'));
   await page.waitForFunction(()=>document.querySelector('#downloads')?.textContent.includes('Companion CSV, raster and geometry files'));
   assert.equal(await page.locator('#downloads a').count(),1);
   assert.equal(await page.locator('#error').isVisible(),false);
   const received=await download(page.locator('#downloads a[download="ledger.json"]'),'portable-loaded-'+width+'.json');
   equal(await readJSON(received.path),originalReport,'Original report JSON open/download must retain every field.');
   await inspectMetrics(page,width,'portable');
   await capture('portable-full-'+width);await closeContext();
  }
  assert.deepEqual(attempt.page_errors,[]);assert.deepEqual(attempt.http_errors,[]);assert.ok(!attempt.blocked_action);
  checkStop();attempt.complete=true;attempt.completed_at=new Date().toISOString();report.complete=true;await checkpoint();
 }catch(error){
  failure=error;
  if(capability){failure.message=String(failure.message).replaceAll(capability,'[private capability]');if(failure.stack)failure.stack=String(failure.stack).replaceAll(capability,'[private capability]');}
  if(attempt){attempt.error={name:error.name,message:String(error.message).replaceAll(capability||'\0','[private capability]'),
   stack:String(error.stack).replaceAll(capability||'\0','[private capability]')};attempt.completed_at=new Date().toISOString();report.complete=false;await checkpoint();}
 }finally{
  for(const own of [...ownedContexts]){try{await own.close();}catch{}ownedContexts.delete(own);}
  if(ownsBrowser&&browser){try{await browser.close();}catch{}}
  if(child&&!child.killed)child.kill('SIGTERM');
  process.off('SIGINT',onINT);process.off('SIGTERM',onTERM);
  await fs.rm(lock,{recursive:true,force:true});
 }
 if(failure)throw failure;
 console.log(JSON.stringify({complete:report.complete,project_id:project.id,edition_id:native.edition_id,
  images:attempt.images.length,downloads:report.downloads.length,progress,visual_review:report.visual_review}));
}
try{await main();process.exit(0);}catch(error){console.error(error?.stack||String(error));process.exit(1);}
