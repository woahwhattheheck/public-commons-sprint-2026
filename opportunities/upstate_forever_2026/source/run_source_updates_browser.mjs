#!/usr/bin/env node
/** Operate real retained source editions through the original scientific operator. */
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, relative, basename, dirname, isAbsolute } from 'node:path';
import { parseArgs } from 'node:util';

const {values:args}=parseArgs({options:{
 'url-file':{type:'string'},workspace:{type:'string'},'from-collection':{type:'string'},
 'to-collection':{type:'string'},mapping:{type:'string'},title:{type:'string'},
 'plan-id':{type:'string'},'report-selection':{type:'string'},
 output:{type:'string'},'run-models':{type:'boolean',default:false},
 transfer:{type:'boolean',default:false},video:{type:'boolean',default:false},
 'expect-reuse':{type:'boolean',default:false},
 headed:{type:'boolean',default:false},'browser-channel':{type:'string'},'browser-executable':{type:'string'},
 'task-timeout-seconds':{type:'string',default:'3600'},help:{type:'boolean',default:false}
}});
if(args.help){
 console.log('node source/run_source_updates_browser.mjs --url-file PRIVATE_URL_FILE --workspace OPERATOR_KEY --from-collection ORIGINAL_EDITION --to-collection REPLACEMENT_EDITION [--mapping ORIGINAL_ID_MAP.json] [--title "Study source update"] | --plan-id RETAINED_PLAN [--report-selection ACTUAL_REPORT_INPUT.json] [--run-models] [--expect-reuse] [--transfer] [--output DIRECTORY] [--video] [--browser-channel NAME | --browser-executable PATH]');
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
let browser,context,page,privateURL='',origin='',capability='',currentWorkspace='',selectedPlan=null,reportReceipt=null,reportEditionId=null,reportFileIdentities=null,reportViewerURL=null;
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
 await record('Captured populated source update for visual review at '+width+' pixels',{plan_id:selectedPlan.id,layout});
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
 const response=await json(await pending,'Queue '+action),task=response.task||response;
 required(task.id&&(!task.workspace||task.workspace===currentWorkspace),'The queued operation belongs to another workspace.');await record('Queued '+action,{task_id:task.id,operation_id:task.operation_id,payload:task.payload});
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
 const root=join(output,'exports'),path=resolve(root,name||basename(download.suggestedFilename())),member=relative(root,path);
 required(member&&!isAbsolute(member)&&!member.split(/[\\/]/).includes('..'),'The downloaded member escapes its retained output directory.');
 await mkdir(dirname(path),{recursive:true});await download.saveAs(path);
 const identity=await fileIdentity(path);journal.downloads.push({path:relative(output,path),...identity});return{path,...identity};
}
async function closeDetail(){
 if(await page.locator('#detail-dialog').isVisible())await page.locator('#detail-dialog [data-action="detail-close"]').click();
}
async function standaloneWorkspaceSwitch(restoredWorkspace){
 const previousPage=page,previousWorkspace=currentWorkspace;
 const receiving=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 let release,timeout,routeFailure=null;
 const released=new Promise(resolve=>{release=resolve;});
 try{
  page=await receiving.newPage();page.setDefaultTimeout(60000);
  page.on('pageerror',error=>journal.browser_errors.push(redact(error.message)));
  const direct=new URL('/web/source-refresh.html',origin);
  direct.search=new URLSearchParams({workspace:args.workspace,plan_id:selectedPlan.id}).toString();
  direct.hash=new URLSearchParams({token:capability}).toString();
  await page.goto(direct.href,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(id=>document.querySelector('#plans')?.value===id&&
   !document.querySelector('#download-plan')?.disabled&&!document.querySelector('#workspace')?.disabled,selectedPlan.id);
  required(await page.locator('#workspace option[value="'+restoredWorkspace+'"]').count()===1,
   'The original standalone page cannot select the actual restored workspace.');
  let admitted,admissionFailed,intercepted=false;
  const admission=new Promise((resolve,reject)=>{admitted=resolve;admissionFailed=reject;});
  const routeHandler=async route=>{
   const request=route.request(),url=new URL(request.url());
   if(intercepted||request.method()!=='GET'||url.origin!==origin||
      url.pathname!=='/api/state'||url.searchParams.get('workspace')!==args.workspace){
    await route.continue();return;
   }
   intercepted=true;
   try{
    const response=await route.fetch();
    const state=await json(response,'Actual earlier workspace response');
    required(state.workspace_key===args.workspace,'The earlier response belongs to another workspace.');
    admitted();await released;await route.fulfill({response});
   }catch(error){routeFailure=error;admissionFailed(error);await route.abort().catch(()=>{});}
  };
  await page.route('**/api/state?*',routeHandler);
  await page.evaluate(()=>document.dispatchEvent(new Event('visibilitychange')));
  await Promise.race([admission,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error(
   'The standalone page did not request its actual earlier workspace refresh.')),60000);})]);
  clearTimeout(timeout);
  const switched=page.waitForResponse(response=>{
   const url=new URL(response.url());return url.pathname==='/api/state'&&
    url.searchParams.get('workspace')===restoredWorkspace&&response.ok();
  });
  await page.locator('#workspace').selectOption(restoredWorkspace);
  release();
  const actual=await json(await switched,'Actual selected receiving workspace');
  required(actual.workspace_key===restoredWorkspace,'The receiving response identifies another workspace.');
  await page.waitForFunction(key=>document.querySelector('#workspace')?.value===key&&
   !document.querySelector('#workspace')?.disabled&&sessionStorage.getItem('upstate-selected-workspace')===key,
   restoredWorkspace);
  await page.locator('#plans').selectOption(selectedPlan.id);
  await page.waitForFunction(id=>document.querySelector('#plans')?.value===id&&
   !document.querySelector('#download-plan')?.disabled,selectedPlan.id);
  required(!routeFailure,'Delayed original response failed: '+redact(routeFailure?.message||''));
  const received=await readPlan(restoredWorkspace,selectedPlan.id);
  required(canonical(received.state)===canonical(selectedPlan.state),
   'Standalone workspace switching changed the retained receiving plan.');
  for(const [width,name] of [[1440,'10-standalone-workspace-switch-desktop'],[390,'11-standalone-workspace-switch-phone']]){
   await page.setViewportSize({width,height:width<600?844:1000});
   const displayed=await page.evaluate(()=>({
    workspace_key:document.querySelector('#workspace')?.value,
    saved_workspace_key:sessionStorage.getItem('upstate-selected-workspace'),
    plan_id:document.querySelector('#plans')?.value,
    viewport_width:document.documentElement.clientWidth,
    page_scroll_width:document.documentElement.scrollWidth,
    error:document.querySelector('#error')?.hidden?'':document.querySelector('#error')?.textContent
   }));
   required(displayed.workspace_key===restoredWorkspace&&displayed.saved_workspace_key===restoredWorkspace&&
    displayed.plan_id===selectedPlan.id&&!displayed.error,'An older refresh replaced the selected receiving workspace.');
   await shot(name);
   await record('Kept the selected receiving workspace after the actual earlier response at '+width+' pixels',{
    earlier_workspace_key:args.workspace,receiving_workspace_key:restoredWorkspace,
    plan_id:selectedPlan.id,displayed
   });
  }
 }finally{
  clearTimeout(timeout);release();
  await receiving.close();page=previousPage;currentWorkspace=previousWorkspace;
 }
}

function reportChoice(row){
 return {source_collection_id:row.source_collection_id,source_id:row.source_id};
}
function reportHref(url){return url+(url.includes('?')?'&':'?')+'download=1';}
function validateReportInput(value){
 required(value&&typeof value==='object'&&!Array.isArray(value),'Supply an actual report input object.');
 required(!value.plan_id||value.plan_id===selectedPlan.id,'The report input selects another retained plan.');
 const text=(name,max,optional=false)=>{
  const value=String(reportInput[name]??'').trim();
  required((optional||value)&&value.length<=max&&!value.includes('\0'),'Correct the actual report '+name+'.');
  return value;
 };
 const reportInput=value;
 required(value.report_title===undefined||typeof value.report_title==='string','The report draft title must be text.');
 for(const name of ['title','rationale'])required(typeof value[name]==='string','Supply the actual report '+name+'.');
 required(value.notes===undefined||typeof value.notes==='string'||
  (Array.isArray(value.notes)&&value.notes.length<=1&&value.notes.every(item=>typeof item==='string')),
  'The browser form accepts one optional note; use a string or a one-item notes list.');
 const notes=Array.isArray(value.notes)?value.notes.join(''):value.notes||'';
 required(notes.length<=20000&&!notes.includes('\0'),'Keep the actual browser note within 20,000 characters.');
 const sources=value.append_to||[];
 required(Array.isArray(sources),'append_to must list actual existing report source selections.');
 const seen=new Set();
 for(const row of sources){
  required(row&&typeof row.source_collection_id==='string'&&typeof row.source_id==='string'&&
   row.source_collection_id&&row.source_id,'Each existing report choice needs its retained collection and source ID.');
  const identity=canonical(reportChoice(row));required(!seen.has(identity),'Choose each existing report source once.');seen.add(identity);
 }
 return {title:text('title',300),rationale:text('rationale',20000),notes:notes.trim(),
  report_title:value.report_title===undefined?text('title',300):text('report_title',300),
  append_to:sources.map(reportChoice)};
}
async function waitForComposerDraft(choices,title){
 await page.waitForFunction(({workspace,choices,title})=>{
  if(document.querySelector('#workspace-select')?.value!==workspace)return false;
  let saved;try{saved=JSON.parse(sessionStorage.getItem('scientific-report-draft:'+workspace)||'null');}catch{return false;}
  const ids=rows=>JSON.stringify((rows||[]).map(row=>[row.source_collection_id,row.source_id]));
  const field=document.querySelector('[data-scientific-report-field="title"]');
  const button=document.querySelector('[data-scientific-report-action="preview"]');
  return saved&&ids(saved.selected)===ids(choices)&&saved.title===title&&!saved.pending&&
   field?.value===title&&button&&!button.disabled&&button.getClientRects().length>0;
 },{workspace:currentWorkspace,choices,title});
}
async function previewReport(choices,title){
 await waitForComposerDraft(choices,title);
 const pending=page.waitForResponse(response=>{
  const url=new URL(response.url());return url.pathname==='/api/source-reports/scientific-preview'&&response.request().method()==='POST';
 });
 await page.locator('[data-scientific-report-action="preview"]').click();
 const response=await pending,body=bodyOf(response),result=await json(response,'Actual scientific report preview');
 required(canonical(body.sources)===canonical(choices)&&body.title===title,
  'The original composer changed the ordered source selection or actual draft title.');
 required(result.workspace_key===currentWorkspace&&canonical((result.sources||[]).map(reportChoice))===canonical(choices),
  'The report preview identifies another workspace or source selection.');
 required(result.id,'The original preview has no retained identity.');
 await record('Previewed actual ordered scientific report',{workspace_key:currentWorkspace,preview_id:result.id,
  source_choices:choices,title,existing:!!result.existing});
 return result;
}
async function inspectScientificView(name,width){
 await page.setViewportSize({width,height:width<600?844:1000});
 const target=page.locator('[data-scientific-report-detail]');
 await target.scrollIntoViewIfNeeded();
 const layout=await target.evaluate(element=>({
  viewport_width:document.documentElement.clientWidth,page_scroll_width:document.documentElement.scrollWidth,
  title:element.querySelector('h3')?.textContent,controls:[...element.querySelectorAll('button,a[download]')].map(item=>{
   const box=item.getBoundingClientRect();return {label:item.textContent.trim(),width:box.width,height:box.height,
    disabled:!!item.disabled,rendered:box.width>0&&box.height>0,
    beyond_viewport:box.left<-.5||box.right>document.documentElement.clientWidth+.5};
  })
 }));
 await shot(name);
 const frameElement=target.locator('iframe').first();await frameElement.waitFor();
 const handle=await frameElement.elementHandle(),frame=await handle.contentFrame();
 required(frame,'The actual saved report viewer did not open.');
 required(reportViewerURL,'The selected report viewer has no retained URL.');
 await frame.waitForURL(new URL(reportViewerURL,origin).href,{waitUntil:'domcontentloaded'});
 await frame.waitForLoadState('domcontentloaded');
 await frame.waitForFunction(()=>document.body&&document.body.innerText.trim().length>0);
 const reportLayout=await frame.locator('body').evaluate(body=>({
  title:body.ownerDocument.title,text_characters:body.innerText.length,
  viewport_width:body.ownerDocument.documentElement.clientWidth,
  page_scroll_width:body.ownerDocument.documentElement.scrollWidth,
  headings:[...body.querySelectorAll('h1,h2,h3')].map(item=>item.textContent.trim()),
  tables:[...body.querySelectorAll('table')].map(table=>({rows:table.rows.length,
   columns:Math.max(0,...[...table.rows].map(row=>row.cells.length)),
   width:table.getBoundingClientRect().width,scroll_width:table.scrollWidth}))
 }));
 required(reportLayout.text_characters>0,'The saved scientific report viewer is empty.');
 const file=join(output,name+'-report.png');await frame.locator('body').screenshot({path:file,animations:'disabled'});
 const bytes=await readFile(file);journal.screenshots.push({path:relative(output,file),bytes:bytes.length,sha256:hash(bytes)});
 await record('Captured actual scientific report and operator for visual review at '+width+' pixels',{
  workspace_key:currentWorkspace,edition_id:reportEditionId,layout,report_layout:reportLayout});
}
async function refreshScientificCatalog(){
 const close=page.locator('[data-scientific-report-action="close"]');
 if(await close.isVisible())await close.click();
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/source-reports/scientific-catalog');
 await page.locator('[data-scientific-report-action="refresh"]').click();
 const result=await json(await pending,'Refreshed original scientific report catalogue');
 required(result.workspace_key===currentWorkspace,'The saved report catalogue belongs to another workspace.');
}
async function openScientificEdition(id){
 const pending=page.waitForResponse(response=>{
  const url=new URL(response.url());return url.pathname==='/api/source-reports/scientific-edition'&&url.searchParams.get('id')===id;
 });
 await page.locator('[data-scientific-report-action="open"][data-id="'+id+'"]').click();
 const result=await json(await pending,'Original saved scientific report');
 required(result.workspace_key===currentWorkspace&&result.edition?.id===id&&result.edition.state==='complete',
  'The report viewer selected another retained edition.');
 required(result.viewer_url,'The saved scientific edition has no original report viewer.');
 reportViewerURL=result.viewer_url;
 await page.waitForFunction(url=>{
  const frame=document.querySelector('[data-scientific-report-detail] iframe');
  return frame&&new URL(frame.getAttribute('src'),location.href).href===new URL(url,location.href).href;
 },result.viewer_url);
 return result;
}
async function scientificReportCourse(){
 const input=validateReportInput(JSON.parse(await readFile(resolve(args['report-selection']),'utf8')));
 required(selectedPlan.state?.state==='complete','Complete this real source update before capturing its scientific report.');
 await page.setViewportSize({width:1440,height:1000});await choosePlan(selectedPlan.id);
 const desk=page.locator('.source-refresh-desk');
 await desk.locator('#report-source-title').fill(input.title);
 await desk.locator('#report-source-rationale').fill(input.rationale);
 await desk.locator('#report-source-notes').fill(input.notes);
 await shot('12-scientific-source-input');
 const task=await queue('.source-refresh-desk #prepare-report-source','source.refresh.report_source');
 reportReceipt=task.result;
 required(reportReceipt?.id&&reportReceipt.plan_id===selectedPlan.id&&reportReceipt.state==='complete'&&reportReceipt.source,
  'The captured source does not identify this actual completed plan.');
 const expected={plan_id:selectedPlan.id,title:input.title,rationale:input.rationale,notes:input.notes?[input.notes]:[]};
 required(canonical(reportReceipt.selection?.selection)===canonical(expected),'The source capture changed the entered scientific rationale.');
 await closeDetail();await choosePlan(selectedPlan.id);
 const row='[data-report-source="'+reportReceipt.id+'"]';
 await desk.locator(row+'[data-selection-mode="replace"]').waitFor();
 const downloaded=await saveDownload(desk.locator('[data-report-source-download="'+reportReceipt.id+'"]'),'scientific-report/source-identity.json');
 const saved=JSON.parse(await readFile(downloaded.path,'utf8'));
 required(saved.id===reportReceipt.id&&saved.plan_id===selectedPlan.id&&canonical(saved.source)===canonical(reportReceipt.source),
  'The downloaded report source identity changed.');
 await page.setViewportSize({width:390,height:844});await shot('13-scientific-source-phone');
 await desk.locator(row+'[data-selection-mode="replace"]').click();
 await page.locator('[data-scientific-report-field="title"]').waitFor();
 await page.waitForFunction(title=>document.querySelector('[data-scientific-report-field="title"]')?.value===title,input.title);
 await previewReport([reportReceipt.source],input.title);
 // Build the actual operator-selected draft before exercising Add. These are existing sources only.
 await page.locator('[data-scientific-report-action="remove"][data-index="0"]').click();
 for(const choice of input.append_to){
  required(canonical(choice)!==canonical(reportReceipt.source),'append_to should list the other existing report sources.');
  await page.locator('[data-scientific-report-source]').selectOption(JSON.stringify([choice.source_collection_id,choice.source_id]));
  await page.locator('[data-scientific-report-action="add"]').click();
 }
 await page.locator('[data-scientific-report-field="title"]').fill(input.report_title);
 const choices=[...input.append_to,reportReceipt.source];
 await openDesk();await choosePlan(selectedPlan.id);
 await desk.locator(row+'[data-selection-mode="append"]').click();
 await page.locator('[data-scientific-report-field="title"]').waitFor();
 await previewReport(choices,input.report_title);
 // Repeat the same actual Add command: it must retain one source and the original order/title.
 await openDesk();await choosePlan(selectedPlan.id);
 await desk.locator(row+'[data-selection-mode="append"]').click();
 await page.locator('[data-scientific-report-field="title"]').waitFor();
 const preview=await previewReport(choices,input.report_title);
 await record('Preserved report draft order/title and deduplicated repeated Add',{capture_id:reportReceipt.id,sources:choices,title:input.report_title});
 await page.setViewportSize({width:1440,height:1000});await shot('14-scientific-composer-desktop');
 await page.setViewportSize({width:390,height:844});await shot('15-scientific-composer-phone');
 if(preview.existing){
  const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/source-reports/scientific-edition'&&
   new URL(response.url()).searchParams.get('id')===preview.id);
  await page.locator('[data-scientific-report-action="render"]').click();
  const opened=await json(await pending,'Existing scientific report');
  required(opened.edition?.id===preview.id&&opened.workspace_key===currentWorkspace,'Reopen selected another saved report.');
 }else{
  await queue('[data-scientific-report-action="render"]','source-reports.render');
  await closeDetail();
 }
 await refreshScientificCatalog();
 reportEditionId=preview.id;
 let opened=await openScientificEdition(reportEditionId);
 await inspectScientificView('16-scientific-report-desktop',1440);
 await inspectScientificView('17-scientific-report-phone',390);
 reportFileIdentities=opened.files.map(({path,bytes,sha256})=>({path,bytes,sha256}));
 const links=page.locator('[data-scientific-report-files] a[download]');
 required(await links.count()===opened.files.length,'The rendered files differ from the original report download list.');
 for(let index=0;index<opened.files.length;index++){
  const item=opened.files[index];
  required(typeof item.path==='string'&&!isAbsolute(item.path)&&!item.path.split(/[\\/]/).includes('..'),
   'The saved scientific member has an invalid relative path.');
  const saved=await saveDownload(links.nth(index),join('scientific-report','files',item.path));
  required(saved.bytes===item.bytes&&saved.sha256===item.sha256,'A downloaded scientific report member changed: '+item.path);
 }
 await queue('[data-scientific-report-action="export"]','source-reports.export');await closeDetail();
 await refreshScientificCatalog();opened=await openScientificEdition(reportEditionId);
 required(opened.archive?.url,'The completed report has no original ZIP download.');
 const archive=opened.archive;
 const archiveLink=page.locator('[data-scientific-report-detail] a[download][href='+JSON.stringify(reportHref(archive.url))+']');
 const savedArchive=await saveDownload(archiveLink,'scientific-report/report.zip');
 required(savedArchive.bytes===archive.bytes&&savedArchive.sha256===archive.sha256,'The report ZIP changed during download.');
 await record('Downloaded complete rendered report and original data',{capture_id:reportReceipt.id,edition_id:reportEditionId,
  source:reportReceipt.source,members:opened.files.length,archive_sha256:savedArchive.sha256});
 // Return the operator to the same original update; receivingArchive continues from this desk.
 await openDesk();await choosePlan(selectedPlan.id);
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
 if(reportReceipt){
  const sourceButton=page.locator('.source-refresh-desk [data-report-source="'+reportReceipt.id+'"][data-selection-mode="replace"]');
  await sourceButton.waitFor();await sourceButton.click();
  await waitForComposerDraft([reportReceipt.source],reportReceipt.selection.selection.title);
  const reopened=await openScientificEdition(reportEditionId);
  required(canonical(reopened.files.map(({path,bytes,sha256})=>({path,bytes,sha256})))===canonical(reportFileIdentities),
   'Cold receiving changed the actual rendered report members.');
  await inspectScientificView('18-restored-scientific-report-desktop',1440);
  await inspectScientificView('19-restored-scientific-report-phone',390);
  await record('Reopened the original scientific source and report from the actual Workspace archive',{
   workspace_key:key,capture_id:reportReceipt.id,edition_id:reportEditionId,files:reportFileIdentities});
  await openDesk();await choosePlan(selectedPlan.id);
 }
 await standaloneWorkspaceSwitch(key);
}
async function main(){
 journal.browser_runtime=browserRuntime();
 required(!args['expect-reuse']||args['run-models'],'Use --expect-reuse with --run-models on a lineage-only update of completed original runs.');
 await mkdir(join(output,'exports'),{recursive:true});
 for(const key of ['url-file','workspace'])required(args[key],'Supply --'+key+' from the actual operator.');
 if(args['plan-id']){
  required(/^[0-9a-f]{64}$/.test(args['plan-id']),'Choose an actual retained source-update plan ID.');
  required(!args['from-collection']&&!args['to-collection']&&!args.mapping&&!args.title,
   'Use --plan-id alone for an existing plan, or supply from/to editions to create one.');
 }else{
  for(const key of ['from-collection','to-collection'])required(args[key],'Supply --'+key+' or choose an existing --plan-id.');
  required(args['from-collection']!==args['to-collection'],'Select two different original retained source editions.');
 }
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
 let desk=page.locator('.source-refresh-desk'),planId=args['plan-id'],title=null;
 if(!planId){
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
 title=args.title||'Retained study source update';
 await desk.locator('#plan-title').fill(title);
 const previewResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/source-refresh/preview');
 await desk.locator('#preview').click();const preview=await json(await previewResponse,'Original source preview');
 required(!(preview.problems||preview.errors||[]).length,'Resolve original source dependencies: '+JSON.stringify(preview.problems||preview.errors));
 await record('Compared the original retained editions',{selection:preview.selection,summary:preview.summary});
 await shot('01-original-edition-comparison');
 const saved=await queue('.source-refresh-desk #save-plan','source.refresh.plan');
 planId=saved.result?.id;required(planId,'The native save returned no retained plan identity.');
 await choosePlan(planId);
 const prepare=await queue('.source-refresh-desk #prepare-plan','source.refresh.apply');
 selectedPlan=await readPlan(currentWorkspace,planId);
 required(selectedPlan.id===planId,'Preparation changed the original immutable plan.');
 await choosePlan(planId);await shot('02-prepared-native-cases');
 }else{
  await choosePlan(planId);selectedPlan=await readPlan(currentWorkspace,planId);
  required(selectedPlan.id===planId,'The operator opened another retained source update.');
  await record('Opened the existing immutable source update',{plan_id:planId,state:selectedPlan.state?.state});
 }
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
 if(title!==null)required(await desk.locator('#plan-title').inputValue()===title,'Leaving the desk lost the unsaved update title.');
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
 if(args['report-selection'])await scientificReportCourse();
 if(args.transfer)await receivingArchive();
 required(!journal.browser_errors.length,'The browser reported an actual exception: '+journal.browser_errors.join('; '));
 journal.status='complete';journal.plan_id=planId;journal.workspace_key=args.workspace;
 if(reportReceipt)journal.scientific_report={capture_id:reportReceipt.id,source:reportReceipt.source,edition_id:reportEditionId};
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
