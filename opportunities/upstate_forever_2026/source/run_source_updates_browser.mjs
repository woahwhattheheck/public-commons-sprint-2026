#!/usr/bin/env node
/** Operate real retained source editions through the original scientific operator. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, basename } from 'node:path';
import { parseArgs } from 'node:util';

const {values:args}=parseArgs({options:{
 'url-file':{type:'string'},workspace:{type:'string'},'from-collection':{type:'string'},
 'to-collection':{type:'string'},mapping:{type:'string'},title:{type:'string'},
 output:{type:'string'},'run-models':{type:'boolean',default:false},
 transfer:{type:'boolean',default:false},video:{type:'boolean',default:false},
 'expect-reuse':{type:'boolean',default:false},
 headed:{type:'boolean',default:false},'browser-channel':{type:'string'},'browser-executable':{type:'string'},
 'task-timeout-seconds':{type:'string',default:'3600'},help:{type:'boolean',default:false}
}});
if(args.help){
 console.log('node source/run_source_updates_browser.mjs --url-file PRIVATE_URL_FILE --workspace OPERATOR_KEY --from-collection ORIGINAL_EDITION --to-collection REPLACEMENT_EDITION [--mapping ORIGINAL_ID_MAP.json] [--title "Study source update"] [--run-models] [--expect-reuse] [--transfer] [--output DIRECTORY] [--video] [--browser-channel NAME | --browser-executable PATH]');
 process.exit(0);
}
const output=resolve(args.output||join('artifacts','source-updates',new Date().toISOString().replace(/[:.]/g,'-')));
const journal={schema:'upstate.source-updates-browser/v1',prepared_by:'TokenJunkieLabs engineering',started_at:new Date().toISOString(),status:'running',steps:[],screenshots:[],downloads:[],browser_errors:[]};
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const required=(value,message)=>{if(!value)throw Error(message);};
function browserRuntime(){
 required(!(args['browser-channel']&&args['browser-executable']),'Choose a browser channel or an explicit executable path.');
 return {kind:args['browser-executable']?'executable':args['browser-channel']?'channel':'bundled',
  executable_path:args['browser-executable']?resolve(args['browser-executable']):null,
  channel:args['browser-channel']||null,headless:!args.headed};
}
let browser,context,page,privateURL='',origin='',capability='',currentWorkspace='',selectedPlan=null;
function redact(value){
 let result=String(value);
 for(const value of [privateURL,origin,capability].filter(Boolean))result=result.split(value).join('[private operator]');
 return result.replace(/#token=[^\s"'<>]+/g,'#token=[redacted]');
}
function bodyOf(response){try{return response.request().postDataJSON()||{};}catch{return{};}}
function actionResponse(action){return response=>new URL(response.url()).pathname==='/api/actions'&&bodyOf(response).action===action;}
async function json(response,label){
 required(response.ok(),label+' returned HTTP '+response.status());
 const value=await response.json();required(!value.error,label+': '+redact(value.error?.message||value.error||''));return value;
}
async function record(name,details={}){
 journal.steps.push({name,completed_at:new Date().toISOString(),...details});
 await writeFile(join(output,'journey.json'),JSON.stringify(journal,null,2)+'\n');
}
async function shot(name){
 const file=join(output,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});
 const bytes=await readFile(file);journal.screenshots.push({path:relative(output,file),bytes:bytes.length,sha256:hash(bytes)});
}
async function fileIdentity(path){
 const digest=createHash('sha256');let bytes=0;
 for await(const chunk of createReadStream(path)){bytes+=chunk.length;digest.update(chunk);}
 return {bytes,sha256:digest.digest('hex')};
}
function completedReceipts(plan){
 const state=plan.state||{},runs=state.run_results||{};
 required(state.state==='complete','The update has not completed its actual successor runs: '+String(state.state));
 required(Object.keys(runs).length>0,'Select a source update with actual retained native runs for --run-models.');
 return Object.fromEntries(Object.entries(runs).sort(([a],[b])=>a.localeCompare(b)).map(([id,row])=>{
  const models=row.model_results||{},artifacts=row.artifacts||{};
  required(row.state==='complete'&&Object.keys(models).length>0&&Object.keys(artifacts).length>0,
   'The refreshed run lacks completed model stages or retained outputs: '+id);
  for(const [model,value] of Object.entries(models)){
   required(['native','reused'].includes(value.mode),'The model has no actual execution mode: '+id+'/'+model);
   if(value.mode==='reused')required(value.source_run_id,'The reused model has no retained source run: '+id+'/'+model);
   if(args['expect-reuse'])required(value.mode==='reused','The selected lineage-only course computed a native stage: '+id+'/'+model);
  }
  return [id,{from_run_id:row.from_run_id,to_run_id:row.to_run_id,state:row.state,
   model_results:models,artifacts,completed_at:row.completed_at,
   reused_model_count:row.reused_model_count,selected_model_count:row.selected_model_count}];
 }));
}
async function inspectView(name,width){
 await page.setViewportSize({width,height:width<600?844:1000});
 await choosePlan(selectedPlan.id);
 const layout=await page.locator('.source-refresh-desk').evaluate(shell=>{
  const root=shell.shadowRoot,viewport=document.documentElement.clientWidth;
  return {viewport_width:viewport,page_scroll_width:document.documentElement.scrollWidth,
   controls:['plans','prepare-plan','run-plan','report-format','download-report','download-plan','export-study'].map(id=>{
    const item=root.querySelector('#'+id),box=item.getBoundingClientRect(),style=getComputedStyle(item);
    return {id,text:(item.tagName==='SELECT'?item.selectedOptions[0]?.textContent:item.textContent)?.trim(),
     x:box.x,width:box.width,height:box.height,disabled:item.disabled,
     rendered:box.width>0&&box.height>0&&style.visibility!=='hidden',
     beyond_viewport:box.left<-.5||box.right>viewport+.5};
   })};
 });
 await shot(name);
 await record('Inspected populated source update at '+width+' pixels',{plan_id:selectedPlan.id,layout});
}
async function readPlan(workspace,id){
 return json(await page.request.get(origin+'/api/source-refresh/plan?'+new URLSearchParams({workspace,id}),{headers:{Authorization:'Bearer '+capability}}),'Retained source update');
}
async function waitTask(id){
 const seconds=Number(args['task-timeout-seconds']);required(Number.isFinite(seconds)&&seconds>0,'Choose a positive task observation period.');
 const until=Date.now()+seconds*1000;
 while(Date.now()<until){
  const task=await json(await page.request.get(origin+'/api/task?id='+encodeURIComponent(id),{headers:{Authorization:'Bearer '+capability}}),'Original queued operation');
  required(task.id===id,'The operator returned another task.');
  if(task.state==='complete')return task;
  if(['failed','interrupted','cancelled'].includes(task.state))throw Error(task.action+' is '+task.state+': '+redact(task.error?.message||'Open its original operation for continuation.'));
  await page.waitForTimeout(1500);
 }
 throw Error('The original task remains active beyond the selected observation period: '+id);
}
async function queue(selector,action){
 const pending=page.waitForResponse(actionResponse(action));await page.locator(selector).click();
 const task=await json(await pending,'Queue '+action);await record('Queued '+action,{task_id:task.id,operation_id:task.operation_id,payload:task.payload});
 const completed=await waitTask(task.id);await record('Completed '+action,{task_id:completed.id,result:completed.result});return completed;
}
async function openWorkspace(key){
 await page.locator('#workspace-select').waitFor();
 if(await page.locator('#workspace-select').inputValue()!==key){
  const pending=page.waitForResponse(async response=>{if(new URL(response.url()).pathname!=='/api/state'||!response.ok())return false;try{return(await response.json()).workspace_key===key;}catch{return false;}});
  await page.locator('#workspace-select').selectOption(key);await json(await pending,'Selected original workspace');
 }
 currentWorkspace=key;
}
async function openDesk(){
 await page.locator('[data-view="source-updates"]').click();
 await page.locator('.source-refresh-desk #from-edition').waitFor();
}
async function choosePlan(id){
 const desk=page.locator('.source-refresh-desk');
 await desk.locator('#reload').click();
 await desk.locator('#plans').selectOption(id);
 await desk.locator('#download-plan').waitFor({state:'visible'});
 await page.waitForFunction(id=>{
  const shadow=document.querySelector('.source-refresh-desk')?.shadowRoot;
  return shadow?.querySelector('#plans')?.value===id&&!shadow.querySelector('#download-plan').disabled;
 },id);
}
async function saveDownload(locator,name){
 const pending=page.waitForEvent('download');await locator.click();const download=await pending;
 const path=join(output,'exports',name||basename(download.suggestedFilename()));await download.saveAs(path);
 const identity=await fileIdentity(path);journal.downloads.push({path:relative(output,path),...identity});return{path,...identity};
}
async function closeDetail(){
 if(await page.locator('#detail-dialog').isVisible())await page.locator('#detail-dialog [data-action="detail-close"]').click();
}
async function receivingArchive(){
 const task=await queue('.source-refresh-desk #export-study','workspace.backup');
 const ticket=(task._downloads||[]).find(row=>row.filename?.endsWith('.zip'));required(ticket,'The original backup has no ZIP ticket.');
 await page.locator('.source-refresh-desk [data-open-task="'+task.id+'"]').click();
 // The exact native ticket selects the archive if labels are repeated.
 const exact=page.locator('#detail-body a[download][href="'+ticket.url+'?download=1"]');
 await exact.waitFor();const downloaded=await saveDownload(exact,basename(ticket.filename));
 required(downloaded.bytes===ticket.bytes&&downloaded.sha256===ticket.sha256,'The original downloaded archive differs from its retained ticket.');
 await closeDetail();
 await page.locator('[data-view="journey"]').click();
 await page.locator('.journey-steps [data-action="journey-step"][data-step="reopen"]').click();
 await page.locator('[data-action="journey-restore"]').click();
 await page.locator('#form-dialog input[name="restore_file"]').setInputFiles(downloaded.path);
 const restored=await queue('#form-submit','workspace.restore');
 required(restored.result?.identity==='MATCH'&&restored.result?.workspace_key,'Original workspace restore did not complete its identity check.');
 const key=restored.result.workspace_key;required(key!==currentWorkspace,'Restore must register the independent receiving workspace.');
 await closeDetail();await openWorkspace(key);await openDesk();await choosePlan(selectedPlan.id);
 const received=await readPlan(key,selectedPlan.id);
 required(canonical(received.selection)===canonical(selectedPlan.selection),'The receiving copy changed the original source selection.');
 required(canonical(received.preview)===canonical(selectedPlan.preview),'The receiving copy changed the native dependency snapshot.');
 required(canonical(received.state)===canonical(selectedPlan.state),'The receiving copy changed retained source-update progress.');
 await record('Reopened the exact update in the restored original workspace',{workspace_key:key,plan_id:received.id,archive_sha256:ticket.sha256});
 await inspectView('08-restored-source-update-desktop',1440);
 await inspectView('09-restored-source-update-phone',390);
}
async function main(){
 journal.browser_runtime=browserRuntime();
 required(!args['expect-reuse']||args['run-models'],'Use --expect-reuse with --run-models on a lineage-only update of completed original runs.');
 await mkdir(join(output,'exports'),{recursive:true});
 for(const key of ['url-file','workspace','from-collection','to-collection'])required(args[key],'Supply --'+key+' from the original operator and retained source editions.');
 required(args['from-collection']!==args['to-collection'],'Select two different original retained source editions.');
 privateURL=(await readFile(resolve(args['url-file']),'utf8')).trim();
 const parsed=new URL(privateURL);required(['http:','https:'].includes(parsed.protocol),'Choose the original HTTP/HTTPS operator URL.');
 origin=parsed.origin;capability=new URLSearchParams(parsed.hash.slice(1)).get('token')||'';
 required(capability,'Choose the original operator startup URL containing its capability fragment.');
 browser=await chromium.launch({headless:!args.headed,
  ...(args['browser-channel']?{channel:args['browser-channel']}:{ }),
  ...(args['browser-executable']?{executablePath:resolve(args['browser-executable'])}:{ })});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(args.video?{recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}}}:{})});
 page=await context.newPage();page.setDefaultTimeout(60000);
 page.on('pageerror',error=>journal.browser_errors.push(redact(error.message)));
 await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(args.workspace);await openDesk();
 let desk=page.locator('.source-refresh-desk');
 await desk.locator('#from-edition').selectOption(args['from-collection']);
 await desk.locator('#to-edition').selectOption(args['from-collection']);
 await desk.locator('#preview').click();await desk.locator('#error').filter({hasText:'different source editions'}).waitFor();
 await record('Rejected identical editions in the actual operator');
 await desk.locator('#to-edition').selectOption(args['to-collection']);
 if(args.mapping){
  const mapping=JSON.parse(await readFile(resolve(args.mapping),'utf8'));
  required(mapping&&typeof mapping==='object'&&!Array.isArray(mapping),'Source mappings must be an object of original IDs to actual replacement IDs or null.');
  for(const [id,replacement] of Object.entries(mapping)){
   const original=desk.locator('#mapping select[data-source-id="'+id.replace(/["\\]/g,'\\$&')+'"]');
   required(await original.count()===1,'The selected earlier edition has no unique original source '+id);
   await original.selectOption(replacement||'');
  }
 }
 const title=args.title||'Retained study source update';
 await desk.locator('#plan-title').fill(title);
 const previewResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/source-refresh/preview');
 await desk.locator('#preview').click();const preview=await json(await previewResponse,'Original source preview');
 required(!(preview.problems||preview.errors||[]).length,'Resolve original source dependencies: '+JSON.stringify(preview.problems||preview.errors));
 await record('Compared the original retained editions',{selection:preview.selection,summary:preview.summary});
 await shot('01-original-edition-comparison');
 const saved=await queue('.source-refresh-desk #save-plan','source.refresh.plan');
 const planId=saved.result?.id;required(planId,'The native save returned no retained plan identity.');
 await choosePlan(planId);
 const prepare=await queue('.source-refresh-desk #prepare-plan','source.refresh.apply');
 selectedPlan=await readPlan(currentWorkspace,planId);
 required(selectedPlan.id===planId,'Preparation changed the original immutable plan.');
 await choosePlan(planId);await shot('02-prepared-native-cases');
 if(args['run-models']){
  await queue('.source-refresh-desk #run-plan','source.refresh.apply');selectedPlan=await readPlan(currentWorkspace,planId);
  const receipts=completedReceipts(selectedPlan);
  await record('Retained actual completed model stages and outputs',{plan_id:planId,run_receipts:receipts});
  await choosePlan(planId);await shot('03-completed-native-source-update');
  await queue('.source-refresh-desk #prepare-plan','source.refresh.apply');
  selectedPlan=await readPlan(currentWorkspace,planId);
  required(canonical(completedReceipts(selectedPlan))===canonical(receipts),'Preparation-only continuation changed completed outputs or model reuse provenance.');
  await record('Preserved completed model receipts through preparation-only continuation',{plan_id:planId});
 }
 await inspectView('03-source-update-desktop',1440);
 await inspectView('03-source-update-phone',390);
 await desk.locator('#report-format').selectOption('html');
 await saveDownload(desk.locator('#download-report'),'source-update-report.html');
 await desk.locator('#report-format').selectOption('csv');
 await saveDownload(desk.locator('#download-report'),'source-update-cases.csv');
 const savedPlan=await saveDownload(desk.locator('#download-plan'),'source-update-plan.json');
 required(JSON.parse(await readFile(savedPlan.path,'utf8')).id===planId,'The downloaded plan identifies a different update.');
 await record('Downloaded actual native update plan and reports from the narrow view',{plan_id:planId,viewport:page.viewportSize()});
 await page.setViewportSize({width:1440,height:1000});
 await page.locator('[data-view="sources"]').click();await openDesk();desk=page.locator('.source-refresh-desk');
 required(await desk.locator('#plan-title').inputValue()===title,'Leaving the desk lost the unsaved update title.');
 await choosePlan(planId);await shot('04-reopened-source-update');
 const fresh=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const first=page;
 try{
  page=await fresh.newPage();page.setDefaultTimeout(60000);
  await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(args.workspace);await openDesk();await choosePlan(planId);
  const reopened=await readPlan(args.workspace,planId);
  required(canonical(reopened.selection)===canonical(selectedPlan.selection)&&canonical(reopened.state)===canonical(selectedPlan.state),'Fresh receiving browser changed the retained update.');
  await record('Opened the native update in a fresh browser',{plan_id:planId});
  await inspectView('05-fresh-browser-reopen-desktop',1440);
  await inspectView('06-fresh-browser-reopen-phone',390);
 }finally{await fresh.close();page=first;currentWorkspace=args.workspace;}
 if(args.transfer)await receivingArchive();
 required(!journal.browser_errors.length,'The browser reported an actual exception: '+journal.browser_errors.join('; '));
 journal.status='complete';journal.plan_id=planId;journal.workspace_key=args.workspace;
}
try{await main();}catch(error){journal.status='failed';journal.error=redact(error.stack||error.message);process.exitCode=1;
 try{if(page)await shot('failure');}catch{}}
finally{
 if(context)await context.close().catch(()=>{});
 if(browser)await browser.close().catch(()=>{});
 journal.finished_at=new Date().toISOString();await mkdir(output,{recursive:true});
 await writeFile(join(output,'journey.json'),JSON.stringify(journal,null,2)+'\n');
 process.stdout.write(JSON.stringify({status:journal.status,output,plan_id:journal.plan_id||null,error:journal.error?journal.error.split('\n')[0]:null})+'\n');
}
