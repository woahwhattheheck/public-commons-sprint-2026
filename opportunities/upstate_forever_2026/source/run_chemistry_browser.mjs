#!/usr/bin/env node
/** Operate a retained chemical project through the original scientific operator. */
import { chromium } from 'playwright';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative, basename } from 'node:path';
import { parseArgs } from 'node:util';

const {values:args}=parseArgs({options:{
 'url-file':{type:'string'},workspace:{type:'string'},'case-id':{type:'string'},
 'source-collection':{type:'string'},'source-id':{type:'string'},'edited-project':{type:'string'},
 request:{type:'string'},reason:{type:'string'},output:{type:'string'},
 receive:{type:'boolean',default:false},transfer:{type:'boolean',default:false},resume:{type:'boolean',default:false},
 video:{type:'boolean',default:false},headed:{type:'boolean',default:false},
 'browser-channel':{type:'string'},'browser-executable':{type:'string'},'task-timeout-seconds':{type:'string',default:'3600'},
 help:{type:'boolean',default:false}
}});
if(args.help){
 console.log('node source/run_chemistry_browser.mjs --url-file PRIVATE_URL_FILE --workspace OPERATOR_KEY (--case-id RETAINED_CASE | --source-collection COLLECTION --source-id PROJECT_SOURCE) [--edited-project ACTUAL_PROJECT.json --reason SCIENTIFIC_EDIT] [--request ACTUAL_REQUEST.json] [--receive] [--transfer] [--video] [--browser-channel NAME | --browser-executable PATH] [--output DIRECTORY] [--resume]');
 process.exit(0);
}
const output=resolve(args.output||join('artifacts','chemistry-browser',new Date().toISOString().replace(/[:.]/g,'-')));
let journal={schema:'upstate.chemistry-browser/v1',prepared_by:'TokenJunkieLabs engineering',started_at:new Date().toISOString(),status:'running',steps:[],screenshots:[],downloads:[],browser_errors:[]};
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const required=(value,message)=>{if(!value)throw Error(message);};
let browser,context,page,privateURL='',origin='',capability='',currentWorkspace='',savedCase,completedRun;
let requestState, journalWritable=false, preparedProject=null, preparedRequest=null;
const stopped=new Set(['failed','interrupted','cancelled']);
async function readOptional(path){
 try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomicText(path,text){
 const temporary=path+'.'+process.pid+'.tmp';
 const file=await open(temporary,'w',0o600);
 try{await file.writeFile(text);await file.sync();}finally{await file.close();}
 await rename(temporary,path);
 const directory=await open(output,'r');
 try{await directory.sync();}finally{await directory.close();}
}
async function persistRequests(){
 await atomicText(join(output,'request-state.json'),JSON.stringify(requestState,null,2)+'\n');
}
function browserRuntime(){
 required(!(args['browser-channel']&&args['browser-executable']),'Choose a browser channel or an explicit executable path.');
 return{kind:args['browser-executable']?'executable':args['browser-channel']?'channel':'bundled',
  executable_path:args['browser-executable']?resolve(args['browser-executable']):null,
  channel:args['browser-channel']||null,headless:!args.headed};
}
async function initializeContinuation(){
 browserRuntime();
 required(!args.resume||args.output,'Resume with the original explicit --output directory.');
 const projectBytes=args['edited-project']?await readFile(resolve(args['edited-project'])):null;
 const requestBytes=args.request?await readFile(resolve(args.request)):null;
 preparedProject=projectBytes?JSON.parse(projectBytes.toString('utf8')):null;
 preparedRequest=requestBytes?JSON.parse(requestBytes.toString('utf8')):null;
 const input={workspace:args.workspace,case_id:args['case-id']||null,
  source_collection_id:args['source-collection']||null,source_id:args['source-id']||null,
  edited_project_sha256:projectBytes?hash(projectBytes):null,
  request_sha256:requestBytes?hash(requestBytes):null,
  reason:args.reason||'Retained working continuation of the original chemical scenario.',
  receive:args.receive,transfer:args.transfer};
 const retained=await readOptional(join(output,'request-state.json'));
 const previous=await readOptional(join(output,'journey.json'));
 if(args.resume){
  required(retained,'This output has no durable chemistry request state; select its original operation in the operator.');
  requestState=JSON.parse(retained);
  required(requestState.schema==='upstate.chemistry-browser-requests/v1','Choose the original chemistry request-state file.');
  required(canonical(requestState.input)===canonical(input),'The resumed scientific selection differs; keep its original input files and choices or use a new output directory.');
  required(requestState.requests&&typeof requestState.requests==='object'&&!Array.isArray(requestState.requests),'Original queued request state is missing.');
  if(previous){journal=JSON.parse(previous);required(journal.schema==='upstate.chemistry-browser/v1','Choose the original chemistry journey.');}
  journal.attempts=journal.attempts||[];
  journal.attempts.push({resumed_at:new Date().toISOString(),previous_status:journal.status,previous_error:journal.error||null,previous_browser_runtime:journal.browser_runtime||null});
  journal.status='running';journal.browser_errors=[];delete journal.error;delete journal.finished_at;
 }else{
  required(!retained&&!previous,'This output already contains a journey. Use --resume to continue its original tasks, or choose a new output directory.');
  requestState={schema:'upstate.chemistry-browser-requests/v1',created_at:new Date().toISOString(),input,requests:{}};
 }
 journal.workspace_key=args.workspace;journal.browser_runtime=browserRuntime();journalWritable=true;
 await persistRequests();await writeJournal();
}
function hasRequest(action){return Boolean(requestState.requests[action]);}
const errors=error=>journal.browser_errors.push(redact(error.message));
function redact(value){
 let result=String(value);
 for(const value of [privateURL,origin,capability].filter(Boolean))result=result.split(value).join('[private operator]');
 return result.replace(/#token=[^\s"'<>]+/g,'#token=[redacted]');
}
async function writeJournal(){
 if(!journalWritable)return;
 await atomicText(join(output,'journey.json'),redact(JSON.stringify(journal,null,2))+'\n');
}
async function record(name,details={}){
 journal.steps.push({name,completed_at:new Date().toISOString(),...details});await writeJournal();
}
async function shot(name){
 const file=join(output,name+'.png');await page.screenshot({path:file,fullPage:true,animations:'disabled'});
 const bytes=await readFile(file);journal.screenshots.push({path:relative(output,file),bytes:bytes.length,sha256:hash(bytes)});
}
function bodyOf(response){try{return response.request().postDataJSON()||{};}catch{return{};}}
function actionResponse(action){return response=>new URL(response.url()).pathname==='/api/actions'&&bodyOf(response).action===action;}
async function json(response,label){
 required(response.ok(),label+' returned HTTP '+response.status());
 const value=await response.json();required(!value.error||(value.schema==='upstate.operator-task/v1'&&value.id&&value.action),label+': '+redact(value.error?.message||value.error||''));return value;
}
async function apiGet(path,params={}){
 return json(await page.request.get(origin+path+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+capability},maxRedirects:0}),path);
}
async function apiPost(path,body){
 return json(await page.request.post(origin+path,{headers:{Authorization:'Bearer '+capability},data:body,maxRedirects:0}),path);
}
async function chemistry(kind,params={},workspace=currentWorkspace){return apiGet('/api/chemistry/'+kind,{workspace,...params});}
async function waitTask(id){
 const seconds=Number(args['task-timeout-seconds']);required(Number.isFinite(seconds)&&seconds>0,'Choose a positive task observation period.');
 const until=Date.now()+seconds*1000;
 while(Date.now()<until){
  const task=await apiGet('/api/task',{id});
  required(task.id===id,'The operator returned another task.');
  if(task.state==='complete')return task;
  if(['failed','interrupted','cancelled'].includes(task.state))throw Error(task.action+' is '+task.state+': '+redact(task.error?.message||'Open the original operation to continue.'));
  await page.waitForTimeout(1500);
 }
 throw Error('The original queued operation is still active beyond the selected observation period: '+id);
}
async function closeDetail(){
 if(await page.locator('#detail-dialog').isVisible())await page.locator('#detail-dialog [data-action="detail-close"]').click();
}
function validateTask(task,request){
 required(task.id&&task.action===request.action&&task.workspace===request.workspace&&canonical(task.payload)===canonical(request.payload),'The original queued task does not match this retained scientific request.');
}
async function keepTask(action,task){
 const entry=requestState.requests[action];validateTask(task,entry.request);
 entry.task_id=task.id;entry.accepted_operation_id=task.operation_id;entry.state=task.state;
 entry.observed_at=new Date().toISOString();await persistRequests();
}
async function queue(selector,action){
 let entry=requestState.requests[action],task,fromBrowser=false;
 if(entry){
  required(entry.request.action===action&&entry.request.workspace===currentWorkspace,'The retained workflow operation belongs to another action or workspace.');
  // The original request identity survives a lost HTTP reply and process exit.
  task=entry.task_id?await apiGet('/api/task',{id:entry.task_id}):await apiPost('/api/actions',entry.request);
  await keepTask(action,task);
  if(stopped.has(task.state)){
   task=await apiPost('/api/task/resume',{id:task.id});await keepTask(action,task);
  }
  await record('Reopened original '+action,{task_id:task.id,operation_id:task.operation_id,state:task.state});
 }else{
  let intercepted=false,interceptionError;
  const intercept=async route=>{
   const request=bodyOf({request:()=>route.request()});
   if(request.action!==action){await route.continue();return;}
   try{
    required(!intercepted,'The same workflow stage submitted two requests.');
    required(request.workspace===currentWorkspace&&request.operation_id&&request.payload,'The browser did not submit an original workspace operation.');
    intercepted=true;
    requestState.requests[action]={request,prepared_at:new Date().toISOString(),state:'prepared'};
    // Flush the complete original body before any upstream mutation.
    await persistRequests();await route.continue();
   }catch(error){interceptionError=error;await route.abort('failed');}
  };
  await page.route('**/api/actions',intercept);
  try{
   const pending=page.waitForResponse(actionResponse(action));
   await page.locator(selector).click();
   task=await json(await pending,'Queue '+action);
   if(interceptionError)throw interceptionError;
   required(intercepted,'The original request was not captured before transmission.');
   await keepTask(action,task);fromBrowser=true;
   await record('Queued '+action,{task_id:task.id,operation_id:task.operation_id,payload:task.payload});
  }finally{await page.unroute('**/api/actions',intercept);}
 }
 if(fromBrowser)await page.locator('#detail-dialog').waitFor({state:'visible'});
 const completed=await waitTask(task.id);await keepTask(action,completed);
 await record('Completed '+action,{task_id:completed.id,result:completed.result});
 await closeDetail();return completed;
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
 await page.locator('[data-view="chemistry"]').click();await page.locator('.chemistry-panel [data-case]').waitFor();
}
async function refreshDesk(){
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chemistry/catalog'&&response.ok());
 await page.locator('[data-action="chemistry-refresh"]').click();await json(await pending,'Refreshed chemical catalogue');
 await page.locator('.chemistry-panel [data-case]').waitFor();
}
async function chooseCase(id){
 await page.locator('.chemistry-panel [data-case]').selectOption(id);
 await page.locator('[data-action="chemistry-open"]').click();
 await page.locator('[data-chemistry-editor]:not([hidden])').waitFor();
 const projectDetails=page.locator('[data-chemistry-editor] details').filter({has:page.locator('[data-project]')});
 if(!(await projectDetails.getAttribute('open')!==null))await projectDetails.locator('summary').click();
 const original=await chemistry('case',{case_id:id});
 await page.waitForFunction(value=>{
  const area=document.querySelector('.chemistry-panel [data-project]');
  if(!area)return false;try{return JSON.stringify(JSON.parse(area.value))===JSON.stringify(value);}catch{return false;}
 },original.project);
 return original;
}
const resultField=mode=>({simulate:'final',attribute:'sources',sensitivity:'rows',calibrate:'observations',monitoring:'selected',uncertainty:'summaries'}[mode]||'final');
async function openRun(id){
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chemistry/run'&&new URL(response.url()).searchParams.get('run_id')===id);
 const firstPage=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chemistry/page'&&new URL(response.url()).searchParams.get('run_id')===id);
 await page.locator('[data-action="chemistry-run-open"][data-id="'+id+'"]').click();const run=await json(await pending,'Opened native chemistry result');await json(await firstPage,'Opened original result collection');
 await page.locator('[data-chemistry-result]:not([hidden])').waitFor();
 const field=resultField(run.mode);
 if(field!=='final'){
  const selected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chemistry/page'&&new URL(response.url()).searchParams.get('run_id')===id&&new URL(response.url()).searchParams.get('field')===field);
  await page.locator('[data-result-field]').selectOption(field);await json(await selected,'Selected native analysis records');
 }
 await page.locator('[data-result-table] > p').waitFor();
}
async function saveDownload(locator,name,expected){
 const pending=page.waitForEvent('download');await locator.click();const download=await pending;
 const path=join(output,'exports',name||basename(download.suggestedFilename()));await download.saveAs(path);
 const bytes=await readFile(path);const row={path:relative(output,path),bytes:bytes.length,sha256:hash(bytes)};
 if(expected){required(row.bytes===expected.bytes&&row.sha256===expected.sha256,'Downloaded original bytes differ from their retained file ticket.');}
 journal.downloads.push(row);return{path,buffer:bytes,bytes:row.bytes,sha256:row.sha256};
}
async function taskDownload(task,suffix,name){
 const ticket=(task._downloads||[]).find(item=>item.filename?.endsWith(suffix));
 required(ticket,'The completed original task has no '+suffix+' file ticket.');
 // Original task detail includes its registered file links.
 if(!(await page.locator('#task-panel').isVisible()))await page.locator('[data-action="tasks"]').first().click();
 await page.locator('[data-action="task-open"][data-id="'+task.id+'"]').first().click();
 const link=page.locator('#detail-body a[download][href="'+ticket.url+'?download=1"]');
 await link.waitFor();const result=await saveDownload(link,name||basename(ticket.filename),ticket);await closeDetail();return{...result,ticket};
}
async function receiveProject(archive){
 if(!hasRequest('source.import')){
 await page.locator('[data-view="sources"]').click();
 await page.locator('[data-action="source-open"]').first().click();
 await page.locator('#form-dialog select[name="source_mode"]').selectOption('file');
 await page.locator('#form-dialog input[name="source_file"]').setInputFiles(archive.path);
 await page.locator('#form-dialog input[name="source_title"]').fill('Editable chemical project from retained case '+savedCase.id.slice(0,12));
 await page.locator('#form-dialog input[name="source_uri"]').fill(origin+archive.ticket.url);
 await page.locator('#form-dialog input[name="source_vintage"]').fill(new Date().toISOString().slice(0,10));
 await page.locator('#form-dialog select[name="source_kind"]').selectOption('document');
 await page.locator('#form-dialog textarea[name="source_notes"]').fill('Original editable-chemistry.zip exported from case '+savedCase.id+'; SHA-256 '+archive.sha256+'. Original source provenance and completed native run records remain inside the unchanged archive.');
 const pending=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/source-preview');
 await page.locator('#form-submit').click();await json(await pending,'Previewed original editable project archive');
 await page.locator('#form-submit').filter({hasText:'Import this source edition'}).waitFor();
 }
 const imported=await queue('#form-submit','source.import');
 const collection=imported.result;required(collection?.id&&collection.entries?.length===1,'Original file intake did not retain exactly the selected archive.');
 await openDesk();
 const choice=JSON.stringify({source_collection_id:collection.id,source_id:collection.entries[0].id});
 await page.locator('.chemistry-panel [data-source]').selectOption(choice);
 const received=await queue('[data-action="chemistry-receive"]','chemistry.receive');
 const result=received.result;required(result?.original_case_id===savedCase.id&&result?.archive_sha256===archive.sha256,'Receiving did not identify the exported original case and archive.');
 const receivedCase=await chemistry('case',{case_id:result.case_id});
 required(canonical(receivedCase.project)===canonical(savedCase.project),'Receiving changed the original chemical project.');
 const mapped=result.adopted_runs.find(row=>row.original_run_id===completedRun.id);
 required(mapped,'Receiving omitted the selected completed analysis.');
 const receivedRun=await chemistry('run',{run_id:mapped.run_id});
 required(receivedRun.state==='complete'&&canonical(receivedRun.selection.request)===canonical(completedRun.selection.request),'Receiving changed the original analysis request.');
 required(canonical(receivedRun.artifacts)===canonical(completedRun.artifacts),'Receiving changed native result artifact identities.');
 const field=resultField(completedRun.mode);
 const before=await chemistry('page',{run_id:completedRun.id,field,offset:0,limit:200});
 const after=await chemistry('page',{run_id:receivedRun.id,field,offset:0,limit:200});
 required(canonical(before.rows)===canonical(after.rows)&&before.total===after.total,'Received result rows differ from the original completed analysis.');
 await refreshDesk();await chooseCase(receivedCase.id);await openRun(receivedRun.id);await shot('07-received-editable-chemistry');
 await record('Received the original editable chemical project',{source_collection_id:collection.id,source_id:collection.entries[0].id,case_id:receivedCase.id,run_id:receivedRun.id,archive_sha256:archive.sha256});
}
async function backupRestore(){
 await page.locator('[data-view="journey"]').click();
 await page.locator('.journey-steps [data-action="journey-step"][data-step="reopen"]').click();
 if(!hasRequest('workspace.backup'))await page.locator('[data-action="journey-backup"]').click();
 const task=await queue('#form-submit','workspace.backup');
 const archive=await taskDownload(task,'.zip','complete-chemistry-workspace.zip');
 if(!hasRequest('workspace.restore')){
  await page.locator('[data-action="journey-restore"]').click();
  await page.locator('#form-dialog input[name="restore_file"]').setInputFiles(archive.path);
 }
 const restored=await queue('#form-submit','workspace.restore');
 required(restored.result?.identity==='MATCH'&&restored.result?.workspace_key,'Original receiving did not confirm workspace identity.');
 required(restored.result.workspace_key!==currentWorkspace,'Choose an independent receiving workspace.');
 await openWorkspace(restored.result.workspace_key);await openDesk();await chooseCase(savedCase.id);await openRun(completedRun.id);
 const reopenedCase=await chemistry('case',{case_id:savedCase.id}),reopenedRun=await chemistry('run',{run_id:completedRun.id});
 required(canonical(reopenedCase.project)===canonical(savedCase.project),'Full workspace receiving changed the chemical project.');
 required(canonical(reopenedRun.selection)===canonical(completedRun.selection),'Full workspace receiving changed the native analysis selection.');
 await record('Reopened chemical analysis after complete workspace restore',{workspace_key:currentWorkspace,case_id:savedCase.id,run_id:completedRun.id,archive_sha256:archive.sha256});
 await shot('08-restored-chemistry-workspace');
}
async function main(){
 await mkdir(join(output,'exports'),{recursive:true});
 required(args['url-file']&&args.workspace,'Supply the original --url-file and --workspace.');
 required(Boolean(args['case-id'])!==Boolean(args['source-collection']||args['source-id']),'Choose a retained case or an original project source.');
 if(!args['case-id'])required(args['source-collection']&&args['source-id'],'Supply both original project source IDs.');
 if(args['edited-project'])required(args.reason?.trim(),'State --reason for the supplied original project edit.');
 await initializeContinuation();
 privateURL=(await readFile(resolve(args['url-file']),'utf8')).trim();
 const parsed=new URL(privateURL);required(['http:','https:'].includes(parsed.protocol),'Choose the original operator HTTP/HTTPS startup URL.');
 origin=parsed.origin;capability=new URLSearchParams(parsed.hash.slice(1)).get('token')||'';
 required(capability,'Use the original startup URL containing its capability fragment.');
 browser=await chromium.launch({headless:!args.headed,
  ...(args['browser-channel']?{channel:args['browser-channel']}:{}),
  ...(args['browser-executable']?{executablePath:resolve(args['browser-executable'])}:{})});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(args.video?{recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}}}:{})});
 page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',errors);
 await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(args.workspace);await openDesk();
 let caseId=args['case-id'];
 if(!caseId){
  if(!hasRequest('chemistry.case.from-source'))await page.locator('.chemistry-panel [data-source]').selectOption(JSON.stringify({source_collection_id:args['source-collection'],source_id:args['source-id']}));
  const imported=await queue('[data-action="chemistry-from-source"]','chemistry.case.from-source');caseId=imported.result?.id;
  required(caseId,'Native source intake returned no retained chemical case.');await refreshDesk();
 }
 const baseline=await chooseCase(caseId);await record('Opened original retained chemical scenario',{case_id:baseline.id,project_sha256:baseline.project_sha256,source_refs:baseline.source_refs});
 let project=args['edited-project']?structuredClone(preparedProject):structuredClone(baseline.project);
 const reason=args.reason||'Retained working continuation of the original chemical scenario.';
 // Explicitly test invalid input in the actual editor, then restore the selected original project.
 await page.locator('[data-project]').fill('{');
 await page.locator('[data-action="chemistry-save"]').click();
 await page.locator('[data-chemistry-status]').filter({hasText:'Chemical project:'}).waitFor();
 await record('Rejected invalid project JSON in the original editor');
 await page.locator('[data-project]').fill(JSON.stringify(project,null,2));
 await page.locator('[data-reason]').fill(reason);
 const request=args.request?structuredClone(preparedRequest):{mode:'simulate',sample_days:[0,...new Set((project.phases||[]).map(row=>row.until_day))]};
 await page.locator('[data-request]').fill(JSON.stringify(request,null,2));
 await shot('01-retained-chemical-editor');
 const projectDraft=await page.locator('[data-project]').inputValue(),requestDraft=await page.locator('[data-request]').inputValue();
 await page.locator('[data-view="sources"]').click();await openDesk();
 required(await page.locator('[data-project]').inputValue()===projectDraft&&await page.locator('[data-request]').inputValue()===requestDraft,'Desk navigation lost the retained editor draft.');
 const saved=await queue('[data-action="chemistry-save"]','chemistry.case.save');
 savedCase=saved.result;required(savedCase?.parent_id===baseline.id,'Saved chemical edition lost its original parent.');
 required(canonical(savedCase.project)===canonical(project),'Saving changed the selected original project.');
 await refreshDesk();await chooseCase(savedCase.id);await page.locator('[data-request]').fill(JSON.stringify(request,null,2));
 const runTask=await queue('[data-action="chemistry-execute"]','chemistry.run');
 completedRun=await chemistry('run',{run_id:runTask.result?.id});
 required(completedRun.state==='complete'&&completedRun.case_id===savedCase.id,'Original chemical analysis did not complete for the saved edition.');
 await refreshDesk();await openRun(completedRun.id);await shot('02-native-chemical-results');
 const fields=await page.locator('[data-result-field] option').evaluateAll(nodes=>nodes.map(node=>node.value));
 const wanted=request.mode==='simulate'?'samples':resultField(completedRun.mode);
 if(fields.includes(wanted)){
  if(await page.locator('[data-result-field]').inputValue()!==wanted){
   const selected=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/chemistry/page'&&new URL(response.url()).searchParams.get('run_id')===completedRun.id&&new URL(response.url()).searchParams.get('field')===wanted);
   await page.locator('[data-result-field]').selectOption(wanted);await json(await selected,'Opened selected original records');
  }
  await page.locator('[data-result-table] > p').waitFor();
  if(await page.locator('[data-action="chemistry-next"]').isEnabled()){
   for(const [action,offset] of [['next',100],['previous',0]]){
    const read=page.waitForResponse(response=>{const url=new URL(response.url());return url.pathname==='/api/chemistry/page'&&url.searchParams.get('run_id')===completedRun.id&&url.searchParams.get('field')===wanted&&Number(url.searchParams.get('offset'))===offset;});
    await page.locator('[data-action="chemistry-'+action+'"]').click();const result=await json(await read,'Paged original analysis records');
    await page.waitForFunction(result=>document.querySelector('[data-result-table] > p')?.textContent?.startsWith(String(result.total?result.offset+1:0)+'–'),result);
   }
  }
 }
 await shot('03-original-result-records');
 for(const ext of ['.html','.csv','.json']){
  const ticket=(completedRun._downloads||[]).find(row=>row.filename?.endsWith(ext));if(!ticket)continue;
  const link=page.locator('[data-chemistry-result] a[download][href="'+ticket.url+'?download=1"]');await link.waitFor();
  await saveDownload(link,'chemistry-result'+ext,ticket);
 }
 // The original library selection drives project export independently from editor state.
 await page.locator('.chemistry-panel [data-case]').selectOption(savedCase.id);
 const exported=await queue('[data-action="chemistry-export"]','chemistry.export');
 const archive=await taskDownload(exported,'.zip','editable-chemistry.zip');
 required(exported.result?.run_ids?.includes(completedRun.id),'Editable project omitted its selected completed native analysis.');
 await record('Exported original editable project and completed analysis',{case_id:savedCase.id,run_id:completedRun.id,archive_sha256:archive.sha256});
 const first=page,fresh=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 try{
  page=await fresh.newPage();page.setDefaultTimeout(60000);page.on('pageerror',errors);
  await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(args.workspace);await openDesk();await chooseCase(savedCase.id);await openRun(completedRun.id);
  await shot('05-fresh-browser-chemistry');await record('Reopened the original case and completed analysis in a fresh browser',{case_id:savedCase.id,run_id:completedRun.id});
 }finally{await fresh.close();page=first;currentWorkspace=args.workspace;}
 if(args.receive)await receiveProject(archive);
 if(args.transfer)await backupRestore();
 required(!journal.browser_errors.length,'Browser exception: '+journal.browser_errors.join('; '));
 journal.status='complete';journal.case_id=savedCase.id;journal.run_id=completedRun.id;journal.workspace_key=args.workspace;
}
try{await main();}catch(error){journal.status='failed';journal.error=redact(error.stack||error.message);process.exitCode=1;try{if(page)await shot('failure');}catch{}}
finally{
 if(context)await context.close().catch(()=>{});
 if(browser)await browser.close().catch(()=>{});
 journal.finished_at=new Date().toISOString();await mkdir(output,{recursive:true});await writeJournal();
 process.stdout.write(JSON.stringify({status:journal.status,output,case_id:journal.case_id||null,run_id:journal.run_id||null,error:journal.error?journal.error.split('\n')[0]:null})+'\n');
}
