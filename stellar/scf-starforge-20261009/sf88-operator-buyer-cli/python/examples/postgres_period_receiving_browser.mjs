#!/usr/bin/env node
/** Receive a real complete period report through the existing private operator. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

process.umask(0o077);
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const need=(value,message)=>{if(!value)throw new Error(message);};
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const same=(left,right)=>{
  if(left===null||right===null||typeof left!=='object'||typeof right!=='object')return left===right;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&
    left.length===right.length&&left.every((value,index)=>same(value,right[index]));
  const keys=Object.keys(left).sort(),following=Object.keys(right).sort();
  return same(keys,following)&&keys.every(key=>same(left[key],right[key]));
};
need(config.schema==='stellar-forge.postgres-period-browser-input.v1'&&config.expected_rows===32,
     'Select the original complete period browser input.');
need(config.selection.schema==='stellar-forge.postgres-period-selection.v1',
     'The original period selection differs.');
const original={warehouse_id:config.warehouse_id,warehouse_schema:config.warehouse_schema,
  selection:config.selection,expected_rows:config.expected_rows};
const directory=path.resolve(config.directory);
await fs.mkdir(directory,{recursive:true,mode:0o700});
const statePath=path.join(directory,'receiving.json');
const sourceSha=sha(await fs.readFile(new URL(import.meta.url)));
need(sourceSha===config.source_sha256,'The selected complete browser source differs.');
let previous;
try{previous=JSON.parse(await fs.readFile(statePath,'utf8'));}
catch(error){if(error.code!=='ENOENT')throw error;}
if(previous)need(previous.schema==='stellar-forge.postgres-period-browser.v1'&&
  same(previous.input,original),'Continue the same original browser report.');
async function identity(filename){
  const raw=await fs.readFile(filename);
  return {path:filename,bytes:raw.length,sha256:sha(raw)};
}
async function validFiles(rows){
  for(const row of rows){
    const actual=await identity(row.path);
    need(actual.bytes===row.bytes&&actual.sha256===row.sha256,'A retained browser file changed: '+row.path);
  }
}
if(previous?.state==='COMPLETE'&&previous.source_sha256===sourceSha&&previous.browser_closed){
  await validFiles([...previous.downloads,...previous.screenshots]);
  console.log(JSON.stringify({state:'COMPLETE',retained_completion:true,result:statePath,
    request_id:previous.request.request_id,browser_closed:true}));
  process.exit(0);
}
const attempt=(previous?.attempt||0)+1;
const attemptDirectory=path.join(directory,'attempts',String(attempt).padStart(4,'0'));
await fs.mkdir(attemptDirectory,{recursive:true,mode:0o700});
const result={schema:'stellar-forge.postgres-period-browser.v1',state:'RUNNING',
  input:original,source_sha256:sourceSha,started_at:new Date().toISOString(),attempt,
  request:previous?.request||null,views:[],downloads:[],screenshots:[],errors:[],browser_closed:false,
  prior_attempts:previous?[...(previous.prior_attempts||[]),{
    state:previous.state,attempt:previous.attempt,started_at:previous.started_at,
    completed_at:previous.completed_at,source_sha256:previous.source_sha256,
    views:previous.views,downloads:previous.downloads,screenshots:previous.screenshots,error:previous.error
  }]:[]};
let writeSerial=Promise.resolve();
function saved(){
  const raw=JSON.stringify(result,null,2)+'\n';
  const job=writeSerial.then(async()=>{
    const temporary=path.join(directory,'.period-browser-'+process.pid+'-'+crypto.randomBytes(6).toString('hex'));
    try{
      const file=await fs.open(temporary,'wx',0o600);
      try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
      await fs.rename(temporary,statePath);
      const folder=await fs.open(directory,'r');
      try{await folder.sync();}finally{await folder.close();}
    }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  });
  writeSerial=job.catch(()=>{});
  return job;
}
await saved();
const require=createRequire(path.join(config.node_modules,'package.json'));
const {chromium}=require('playwright');
let browser,page,closing,interruption,failure;
async function closeBrowser(){
  if(!browser)return;
  closing??=browser.close();
  await closing;
  result.browser_closed=true;
}
const handlers=new Map(['SIGTERM','SIGINT','SIGHUP'].map(name=>[name,()=>{
  interruption??=name;
  if(browser)void closeBrowser().catch(error=>{result.close_error=error.message;});
}]));
for(const [name,handler] of handlers)process.on(name,handler);
async function ready(){
  await page.waitForFunction(id=>document.getElementById('warehouse-id')?.textContent.includes(id),
    config.warehouse_id);
  await idle();
}
async function idle(){
  await page.waitForFunction(()=>document.getElementById('refresh')&&!document.getElementById('refresh').disabled);
  const error=page.locator('#message[data-level="error"]:not([hidden])');
  if(await error.count())throw new Error(await error.innerText());
  need(!interruption,'Browser receiving was interrupted by '+interruption);
}
async function screen(name){
  await page.locator('[data-screen="'+name+'"]').click();
  await page.locator('#screen-'+name).waitFor({state:'visible'});
}
async function api(route,body){
  return page.evaluate(async({route,body})=>{
    const response=await fetch(route,{
      method:body===undefined?'GET':'POST',
      headers:{'X-Postgres-Capability':sessionStorage.getItem('postgres-capability'),
        ...(body===undefined?{}:{'Content-Type':'application/json'})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.error||'The original operator request failed.');
    return result;
  },{route,body});
}
function requireRequest(record){
  need(record.state==='COMPLETE'&&record.route==='/api/period-reports'&&
       same(record.body,result.request),'The original browser request differs or is incomplete.');
  const report=record.result.report;
  need(report.warehouse_id===config.warehouse_id&&report.warehouse_schema===config.warehouse_schema&&
       same(report.selection,config.selection)&&report.previous.row_count===32&&report.current.row_count===32&&
       same(report.totals,{ADDED:0,REMOVED:0,CHANGED:0,UNCHANGED:32}),
       'The browser report omitted original rows or changed the source comparison.');
}
async function existingRequest(id){
  let before;
  while(true){
    const values=await api('/api/requests?limit=100'+(before?'&before='+encodeURIComponent(before):''));
    if(values.requests.some(row=>row.record_id===id))return api('/api/requests/'+id);
    if(values.next_before===null)return null;
    need(values.next_before!==before,'The original request cursor did not advance.');
    before=values.next_before;
  }
}
async function selectOriginalEditions(){
  const ids=[config.selection.previous_version,config.selection.current_version];
  while(true){
    const known=await page.locator('#compare-previous option').evaluateAll(options=>options.map(option=>option.value));
    if(ids.every(id=>known.includes(id)))break;
    await screen('editions');
    need(await page.locator('#more-editions').isVisible(),'An original edition is absent from the complete list.');
    await page.locator('#more-editions').click();await idle();
  }
  await screen('compare');
  await page.locator('#compare-previous').selectOption(ids[0]);
  await page.locator('#compare-current').selectOption(ids[1]);
  await page.locator('#period-previous-label').fill(config.selection.previous_label);
  await page.locator('#period-current-label').fill(config.selection.current_label);
  await page.locator('#period-report-title').fill(config.selection.title);
}
async function view(name,screenshotName){
  const geometry=await page.evaluate(()=>({
    viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth
  }));
  need(geometry.document<=geometry.viewport+2&&geometry.body<=geometry.viewport+2,
       'The '+name+' view exceeds its viewport.');
  result.views.push({name,...geometry});
  const filename=path.join(attemptDirectory,screenshotName);
  await page.screenshot({path:filename,fullPage:true});
  result.screenshots.push(await identity(filename));
  await saved();
}
async function openSavedRequest(record){
  await page.locator('#refresh').click();await idle();
  await screen('recovery');
  while(true){
    const cards=page.locator('#request-list .item').filter({hasText:record.created_at});
    for(let index=0;index<await cards.count();index++){
      await cards.nth(index).getByRole('button',{name:'Open saved result',exact:true}).click();
      await idle();
      await page.locator('#request-panel').waitFor({state:'visible'});
      if((await page.locator('#request-details').innerText()).includes(record.record_id))return;
    }
    const more=page.locator('#more-requests');
    need(await more.isVisible(),'The original report is absent from the complete saved operations list.');
    await more.click();await idle();
  }
}
async function download(scope,filename,expected){
  const waiting=page.waitForEvent('download');
  await scope.getByRole('button',{name:'Download complete report',exact:true}).click();
  const received=await waiting;
  const destination=path.join(attemptDirectory,filename);
  await received.saveAs(destination);
  const actual=await identity(destination);
  need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,
       'The browser did not save the complete original report ZIP.');
  result.downloads.push({...actual,suggested_name:received.suggestedFilename()});
  await idle();await saved();
}
try{
  browser=await chromium.launch({
    executablePath:config.chromium,headless:true,
    handleSIGTERM:false,handleSIGINT:false,handleSIGHUP:false,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--renderer-process-limit=1',
      '--disable-blink-features=FileSystemAccessLocal']
  });
  result.browser_version=browser.version();
  result.download_mode='Native browser download; FileSystemAccessLocal disabled for unattended receiving';
  need(!interruption,'Browser receiving was interrupted before opening.');
  page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});
  page.setDefaultTimeout(30000);
  page.on('pageerror',error=>result.errors.push(error.message));
  await page.route('**/api/period-reports',async route=>{
    try{
      const request=route.request();
      need(request.method()==='POST','The period form used a different method.');
      const body=request.postDataJSON();
      need(body&&Object.keys(body).sort().join(',')==='request_id,selection'&&
           /^[a-f0-9]{32}$/.test(body.request_id)&&same(body.selection,config.selection),
           'The actual browser form changed the selected original periods.');
      need(result.request===null||same(result.request,body),'The browser reused a different original request.');
      result.request=body;
      // Preserve the actual UI-selected request before permitting its native dispatch.
      await saved();
      await route.continue();
    }catch(error){
      result.errors.push(error.message);
      await route.abort('failed');
    }
  });
  await page.goto(config.url,{waitUntil:'domcontentloaded'});
  await ready();
  need(await page.evaluate(()=>typeof window.showSaveFilePicker)!=='function',
       'This unattended Chromium run requires the standard browser download mode.');
  const state=await api('/api/state');
  need(state.identity.warehouse_id===config.warehouse_id&&
       state.identity.warehouse_schema===config.warehouse_schema,'The original operator warehouse differs.');
  result.operator_id=state.identity.operator_id;
  await selectOriginalEditions();
  await view('Complete period selection — desktop','period-selection-desktop.png');
  let record;
  if(result.request===null){
    await page.locator('#period-report-form').getByRole('button',{
      name:'Create complete period report',exact:true}).click();
    await page.locator('#period-report-result').getByRole('heading',{
      name:config.selection.title,exact:true}).waitFor();
    await idle();
    need(result.request!==null,'The real browser request was not retained.');
    record=await api('/api/requests/'+result.request.request_id);
    requireRequest(record);
    await view('Complete period report — desktop','period-report-desktop.png');
    await download(page.locator('#period-report-result'),'period-report-desktop.zip',record.result.artifact);
  }else{
    const retained=await existingRequest(result.request.request_id);
    if(retained){
      need(retained.route==='/api/period-reports'&&same(retained.body,result.request),
           'The retained original browser report request changed.');
      record=await api('/api/requests/'+result.request.request_id+'/resume',{});
    }else record=await api('/api/period-reports',result.request);
    requireRequest(record);
    result.original_request_recovered=true;
    await openSavedRequest(record);
    await view('Reopened complete period report — desktop','period-report-desktop.png');
    await download(page.locator('#request-details'),'period-report-desktop.zip',record.result.artifact);
  }
  // Reopen through the real saved-operations controls, then retain the full ZIP at 390px.
  await page.reload({waitUntil:'domcontentloaded'});await ready();
  record=await api('/api/requests/'+result.request.request_id);
  requireRequest(record);
  await page.setViewportSize({width:390,height:844});
  await openSavedRequest(record);
  await view('Saved complete period report — 390px','period-report-390.png');
  await download(page.locator('#request-details'),'period-report-390.zip',record.result.artifact);
  await selectOriginalEditions();
  await view('Original period selection — 390px','period-selection-390.png');
  need(result.errors.length===0,'The original receiving page reported a JavaScript or request error.');
  result.report={request_id:record.record_id,artifact:record.result.artifact,
    totals:record.result.report.totals,selection:record.body.selection};
}catch(error){
  failure=error;
  result.error=error.message;
}finally{
  try{await closeBrowser();}
  catch(error){failure??=error;result.close_error=error.message;}
  for(const [name,handler] of handlers)process.removeListener(name,handler);
  if(interruption){failure??=new Error('Receiving interrupted by '+interruption);result.interruption=interruption;}
  result.state=failure?'INTERRUPTED':'COMPLETE';
  result.completed_at=new Date().toISOString();
  await saved();
}
if(failure){
  console.error(JSON.stringify({state:result.state,result:statePath,error:result.error||failure.message,
    request_id:result.request?.request_id,browser_closed:result.browser_closed}));
  process.exitCode=1;
}else console.log(JSON.stringify({state:'COMPLETE',result:statePath,request_id:result.request.request_id,
  downloads:result.downloads.length,views:result.views.length,browser_closed:result.browser_closed}));
