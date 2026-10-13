#!/usr/bin/env node
/** Operate the retained native simulated field/QC chapter through the original application. */
import {readFile,writeFile,mkdir,open,rename,lstat,realpath,link,unlink,readdir} from 'node:fs/promises';
import {resolve,join,relative,basename,dirname} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {parseArgs} from 'node:util';

const activeRecordingPages=new WeakSet();

/** Run serially on the current recording page, or launch the standalone browser. */
export async function runSampleQCCourse(options={}){
const args={
 'url-file':options.urlFile,workspace:options.workspace,fieldwork:options.fieldworkFile,output:options.output,
 resume:options.resume===true,headed:options.headed===true,
 'browser-channel':options.browserChannel,'browser-executable':options.browserExecutable,'playwright-module':options.playwrightModule,
 'task-timeout-seconds':String(options.taskTimeoutSeconds??900)
};
const borrowed=options.page||null;
let ownsRecordingPage=false;
const checkpoint=async()=>{if(options.checkRunning)await options.checkRunning();};
const pageBindings=[];
const ownedContexts=new Set();
const pendingRequests=new WeakMap();
const check=(ok,message)=>{if(!ok)throw Error(message);};
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const equal=(a,b,message)=>check(canonical(a)===canonical(b),message);
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const now=()=>new Date().toISOString();
const stopped=new Set(['failed','interrupted','cancelled']);
const output=resolve(args.output||'.');
let browser,context,page,lease,privateURL='',origin='',token='',fieldwork,state,journey,attempt,activeExport=null;
let baselinePlan,baselineQC=[],baselineActions=[],journalReady=false;
let borrowedDrafts=null,borrowedPageURL=null,borrowedViewport=null,primaryFailure=null,recordingContext=null;
function redact(value){
 let result=String(value);
 for(const secret of [privateURL,token,origin].filter(Boolean))result=result.split(secret).join('[private operator]');
 return result.replace(/#token=[^\s"'<>]+/g,'#token=[redacted]');
}
async function optional(path){try{return await readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncDirectory(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
async function atomic(path,bytes){
 const tmp=path+'.pending-'+randomUUID();let fd;
 try{fd=await open(tmp,'wx',0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;await rename(tmp,path);await syncDirectory(dirname(path));}
 finally{if(fd)await fd.close();await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function immutable(path,bytes){
 const existing=await optional(path);
 if(existing){check(existing.equals(bytes),'A retained course member changed: '+relative(output,path));return;}
 const tmp=path+'.pending-'+randomUUID();let fd;
 try{fd=await open(tmp,'wx',0o600);await fd.writeFile(bytes);await fd.sync();await fd.close();fd=null;
  try{await link(tmp,path);}catch(e){if(e.code!=='EEXIST')throw e;check((await readFile(path)).equals(bytes),'Concurrent retained course bytes differ.');}
  await syncDirectory(dirname(path));
 }finally{if(fd)await fd.close();await unlink(tmp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function persist(){await atomic(join(output,'request-state.json'),jsonBytes(state));}
async function journal(){if(journalReady)await atomic(join(output,'journey.json'),Buffer.from(redact(JSON.stringify(journey,null,2))+'\n'));}
async function step(name,details={}){
 await checkpoint();journey.current_step=name;journey.steps.push({name,at:now(),...details});await journal();}
async function retain(name,bytes,kind,extra={}){
 const path=join(attempt,name);await immutable(path,bytes);
 const row={path:relative(output,path),bytes:bytes.length,sha256:sha(bytes),kind,...extra};
 journey.artifacts.push(row);await journal();return{...row,absolute:path};
}
async function shot(name,locator=null,stopping=false){
 if(!stopping)await checkpoint();
 if(locator)await locator.scrollIntoViewIfNeeded();
 const path=join(attempt,name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled'});
 const bytes=await readFile(path);
 journey.artifacts.push({path:relative(output,path),bytes:bytes.length,sha256:sha(bytes),kind:'actual-browser-screenshot',viewport:page.viewportSize()});
 await journal();
}
async function acquire(){
 check(args.output,'Supply an explicit private output directory.');
 if(!args.resume)await mkdir(output,{recursive:false,mode:0o700});
 const st=await lstat(output);check(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(output)===output,'Use a real output directory without symlink components.');
 if(!args.resume)check((await readdir(output)).length===0,'Choose a new empty output directory.');
 // flock(2) owns the open file description. The lock file is permanent; never unlink it.
 lease=await open(join(output,'.course-lock'),'a+',0o600);
 await new Promise((resolvePromise,reject)=>{
  const child=spawn('flock',['-n','3'],{stdio:['ignore','ignore','pipe',lease.fd]});
  let error='';child.stderr.on('data',b=>error+=b);
  child.once('error',reject);child.once('exit',code=>code===0?resolvePromise():reject(Error('The original course is active, or Linux flock is unavailable: '+error.trim())));
 });
}
async function initialize(){
 check((args['url-file']||options.operatorURL)&&(args.fieldwork||options.fieldwork)&&hex(args.workspace),'Supply the original private URL, native inspect JSON and 64-character workspace key.');
 check(!(args.fieldwork&&options.fieldwork),'Choose the original input file or native fieldwork document.');
 check(!(args['url-file']&&options.operatorURL),'Choose the private URL file or existing operator URL.');
 check(!(args['browser-channel']&&args['browser-executable']),'Choose one Chromium executable or channel.');
 const seconds=Number(args['task-timeout-seconds']);check(Number.isFinite(seconds)&&seconds>0&&seconds<=86400,'Task observation must be between zero and 86400 seconds.');
 privateURL=options.operatorURL?String(options.operatorURL).trim():(await readFile(resolve(args['url-file']),'utf8')).trim();
 const parsed=new URL(privateURL);
 check(['http:','https:'].includes(parsed.protocol)&&!parsed.username&&!parsed.password,'Use the original HTTP operator URL.');
 token=new URLSearchParams(parsed.hash.slice(1)).get('token')||'';
 check(token,'The private operator URL must contain its original #token capability.');
 origin=parsed.origin;
 const raw=options.fieldwork?jsonBytes(options.fieldwork):await readFile(resolve(args.fieldwork));fieldwork=JSON.parse(raw.toString('utf8'));
 check(fieldwork.schema==='upstate.simulated-fieldwork/v1'&&fieldwork.phase==='closeout'&&hex(fieldwork.operation_id),'Finish and inspect the original native simulated field closeout first.');
 check(typeof fieldwork.plan_id==='string'&&fieldwork.plan_id&&typeof fieldwork.original_project_id==='string','The original field identities are missing.');
 check(fieldwork.qc_reports?.length===2&&fieldwork.action_reports?.length===3,'Retain both original QC reviews and all three decision editions.');
 check(fieldwork.qc_reports.every(r=>hex(r.report_id)&&r.plan_id===fieldwork.plan_id&&Array.isArray(r.groups)),'The original QC report references are incomplete.');
 check(fieldwork.action_reports.every(r=>hex(r.report_id)&&hex(r.action_report_id)&&r.plan_id===fieldwork.plan_id),'The original action report references are incomplete.');
 const input={...(options.fieldwork?{fieldwork_input:'native-document'}:{}),fieldwork_sha256:sha(raw),workspace_key:args.workspace,operator_origin_sha256:sha(origin),operation_id:fieldwork.operation_id,
  project_id:fieldwork.original_project_id,plan_id:fieldwork.plan_id,qc_reports:fieldwork.qc_reports.map(r=>r.report_id),action_reports:fieldwork.action_reports.map(r=>r.action_report_id)};
 const previous=await optional(join(output,'request-state.json'));
 if(previous){
  check(args.resume,'Choose a new output directory or resume the original course.');
  state=JSON.parse(previous);check(state.schema==='upstate.sample-qc-browser-requests/v1','Choose the original field course.');
  equal(state.input,input,'Resume the same input bytes, operator origin and workspace, or use a new output directory.');
 }else{
  // No browser or native request can run before this first journal commits.
  // Recover only an interrupted initialization while retaining its original bytes.
  for(const name of await readdir(output)){
   check(name==='.course-lock'||name==='native-input.json'||
     /^(?:native-input|request-state)\.json\.pending-[0-9a-f-]{36}$/.test(name),
     'The original output has committed course data but no request state; retain it for recovery.');
   const entry=await lstat(join(output,name));
   check(entry.isFile()&&!entry.isSymbolicLink(),'An interrupted initialization member is not a regular file.');
  }
  const original=await optional(join(output,'native-input.json'));
  if(original)check(original.equals(raw),'The interrupted initialization belongs to another original field input.');
  state={schema:'upstate.sample-qc-browser-requests/v1',input,created_at:now(),requests:{},baseline:null};
 }
 check(state.requests&&typeof state.requests==='object'&&!Array.isArray(state.requests),'The retained native request index is invalid.');
 await persist();await immutable(join(output,'native-input.json'),raw);
 const old=await optional(join(output,'journey.json'));
 journey=old?JSON.parse(old):{schema:'upstate.sample-qc-browser/v1',created_at:now(),input,steps:[],artifacts:[],attempts:[],browser_errors:[]};
 check(journey.schema==='upstate.sample-qc-browser/v1','The existing course journal is invalid.');
 const used=(await readdir(output)).map(name=>/^attempt-([0-9]+)$/.exec(name)).filter(Boolean).map(m=>Number(m[1]));
 const index=Math.max(journey.attempts.length,0,...used)+1;check(Number.isSafeInteger(index),'The attempt index is invalid.');attempt=join(output,'attempt-'+String(index).padStart(3,'0'));
 await mkdir(attempt,{mode:0o700});journey.attempts.push({number:index,started_at:now(),previous_status:journey.status||null,previous_driver:journey.driver||null});
 journey.status='running';journey.browser_errors=[];delete journey.error;delete journey.finished_at;
 journey.visual_review={status:'producer_inspection_required',instruction:'Open the actual PNGs and outgoing rendered reports, operate the important controls and independently reopened downloads, and repair concrete defects before calling the product ready.'};
 journey.driver={path:'source/implementation/run_sample_qc_browser.mjs',sha256:sha(await readFile(fileURLToPath(import.meta.url))),node:process.version};
 journalReady=true;await journal();
}
async function responseJSON(response,label){
 check(response.ok(),label+' returned HTTP '+response.status());
 const value=await response.json();
 check(!value.error||value.schema==='upstate.operator-task/v1',label+': '+redact(value.error?.message||value.error||''));
 return value;
}
async function api(path,parameters={},body=null){
 await checkpoint();
 const response=body===null?await page.request.get(origin+path+'?'+new URLSearchParams(parameters),{headers:{Authorization:'Bearer '+token},maxRedirects:0}):
  await page.request.post(origin+path,{headers:{Authorization:'Bearer '+token},data:body,maxRedirects:0});
 return responseJSON(response,path);
}
const qc=(operation,parameters={})=>api('/api/implementation-qc/'+operation,{workspace:args.workspace,plan_id:fieldwork.plan_id,...parameters});
const bodyOf=request=>{try{return request.postDataJSON();}catch{return null;}};
async function installNetworkGuard(p){
 const routePattern=/\/api\/actions(?:\?|$)/;const routeHandler=async route=>{
  const body=bodyOf(route.request());
  try{
   check(new URL(route.request().url()).origin===origin,'An export left its original operator.');
   check(activeExport&&body&&body.workspace===args.workspace&&body.action===activeExport.action,'This course only submits the currently selected original QC export.');
   equal(body.payload,activeExport.payload,'The UI export payload differs from the original saved report.');
   check(typeof body.operation_id==='string'&&body.operation_id,'The UI omitted its original operation ID.');
   check(!activeExport.dispatched,'The UI submitted this export more than once.');
   activeExport.dispatched=true;
   state.requests[activeExport.key]={request:body,prepared_at:now(),state:'prepared'};
   await persist();await route.continue();
  }catch(e){journey.browser_errors.push(redact(e.message));await journal();if(activeExport)activeExport.error=e;await route.abort('failed');}
 };
 await p.route(routePattern,routeHandler);pageBindings.find(row=>row.page===p).route={pattern:routePattern,handler:routeHandler};
}
async function createContext(settings){
 const created=await browser.newContext(settings);ownedContexts.add(created);return created;
}
async function closeOwnedContext(created){
 check(ownedContexts.has(created),'The course cannot close the original recording context.');
 await created.close();ownedContexts.delete(created);
}
async function newPage(existing=null){
 await checkpoint();
 const c=existing?existing.context():await createContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const p=existing||await c.newPage();if(!existing)p.setDefaultTimeout(60000);
 const pending=new Set();pendingRequests.set(p,pending);
 const tracked=r=>{const u=new URL(r.url());return u.origin===origin&&(u.pathname.startsWith('/api/implementation')||u.pathname==='/api/task'||u.pathname==='/api/state');};
 const onRequest=r=>{if(tracked(r))pending.add(r);},onDone=r=>pending.delete(r),onError=e=>journey.browser_errors.push(redact(e.message));
 p.on('request',onRequest);for(const event of ['requestfinished','requestfailed'])p.on(event,onDone);p.on('pageerror',onError);
 pageBindings.push({page:p,onRequest,onDone,onError});
 await installNetworkGuard(p);context=c;page=p;await page.setViewportSize({width:1440,height:1000});
 await page.goto(privateURL,{waitUntil:'domcontentloaded'});
 await page.locator('#workspace-select').waitFor();
 if(await page.locator('#workspace-select').inputValue()!==args.workspace){
  const changed=page.waitForResponse(async r=>{if(new URL(r.url()).pathname!=='/api/state'||!r.ok())return false;try{return(await r.json()).workspace_key===args.workspace;}catch{return false;}});
  changed.catch(()=>{});await page.locator('#workspace-select').selectOption(args.workspace);await changed;await waitUI();
 }
 const actual=await api('/api/state',{workspace:args.workspace,compact:'1'});
 check(actual.workspace_key===args.workspace&&actual.data?.project?.id===fieldwork.original_project_id,'The live operator belongs to another original project.');
 await page.locator('[data-view="implementation"]').click();
 const selector=page.locator('select[data-impl-change="plan"]');await selector.waitFor();
 await selector.selectOption(fieldwork.plan_id);await waitUI();
 await page.locator('[data-impl="reopen"]').click();await waitUI();
 await page.locator('[data-impl="tab"][data-tab="field"]').click();
 await page.locator('[data-impl="sample-qc"]').waitFor();
}
async function waitUI(){
 const until=Date.now()+60000;
 while(Date.now()<until){await checkpoint();const pending=pendingRequests.get(page)||new Set();if(pending.size===0){await page.evaluate(()=>new Promise(resolvePromise=>requestAnimationFrame(()=>requestAnimationFrame(resolvePromise))));if(pending.size===0)return;}await page.waitForTimeout(50);}
 throw Error('The original Implementation view is still opening.');
}
async function detail(){const value=await api('/api/implementation/detail',{workspace:args.workspace,id:fieldwork.plan_id});return value.plan||value.document;}
async function loadOriginal(){
 baselinePlan=await detail();check(baselinePlan?.id===fieldwork.plan_id,'Select the original native field plan.');
 check(baselinePlan.revision===fieldwork.current_revision,'Regenerate inspect_campaign after later native field edits; the input must describe the current plan.');
 equal(baselinePlan.observations,fieldwork.original_observations,'Original field observations differ from the retained native inspection.');
 for(const reference of fieldwork.qc_reports){
  const r=await qc('inspect',{report_id:reference.report_id});
  check(r.plan_id===reference.plan_id&&r.revision===reference.revision&&r.report_id===reference.report_id,'The original saved QC identity changed.');
  equal(r.review.groups,reference.groups,'Original numerical groups changed.');
  baselineQC.push(r);
 }
 for(const reference of fieldwork.action_reports){
  const r=await qc('actions-inspect',{action_report_id:reference.action_report_id});
  check(r.plan_id===reference.plan_id&&r.report_id===reference.report_id&&r.action_report_id===reference.action_report_id&&r.revision===reference.revision,'The original reviewer edition changed.');
  equal(r.receipt,reference.receipt,'The original corrective-action receipt changed.');
  baselineActions.push(r);
 }
 const source={plan_sha256:sha(canonical(baselinePlan)),qc:baselineQC.map(r=>({id:r.report_id,review_sha256:sha(canonical(r.review))})),
  actions:baselineActions.map(r=>({id:r.action_report_id,action_review_sha256:sha(canonical(r.action_review)),receipt_sha256:sha(canonical(r.receipt))}))};
 if(state.baseline)equal(state.baseline,source,'The retained course sources changed; open a new course for a new source edition.');
 else{state.baseline=source;await persist();}
 await retain('native-plan.json',jsonBytes(baselinePlan),'original-native-plan');
 await retain('native-reports.json',jsonBytes({qc:baselineQC.map(({_downloads,...r})=>r),actions:baselineActions.map(({_downloads,...r})=>r)}),'original-native-report-context');
}
async function closeDetail(){if(await page.locator('#detail-dialog').isVisible())await page.locator('#detail-dialog [data-action="detail-close"]').click();}
async function closeQC(){if(await page.locator('.iw-qc').count())await page.locator('.iw-qc [data-qc="close"]').click();}
async function openQC(){
 await checkpoint();
 await closeDetail();await closeQC();await page.locator('[data-impl="tab"][data-tab="field"]').click();
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/implementation-qc/records'&&r.ok());
 pending.catch(()=>{});await page.locator('[data-impl="sample-qc"]').click();await pending;await waitUI();
 await page.locator('.iw-qc').waitFor();
 if(await page.locator('.iw-qc [data-qc="follow-back"]').count())await page.locator('.iw-qc [data-qc="follow-back"]').click();await waitUI();
}
async function readReview(reference){
 await checkpoint();
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/implementation-qc/inspect'&&new URL(r.url()).searchParams.get('report_id')===reference.report_id&&r.ok());
 pending.catch(()=>{});await page.locator('.iw-qc [data-qc="open-review"][data-report="'+reference.report_id+'"]').click();await pending;await waitUI();
 await page.locator('.iw-qc [data-qc="result-json"]').waitFor();
 await page.waitForFunction(title=>[...document.querySelectorAll('.iw-qc .qc-box h3')].some(n=>n.textContent===title),reference.review.title);
}
async function download(locator,name,expected=null,expectedJSON=undefined){
 await checkpoint();
 const waiting=page.waitForEvent('download');waiting.catch(()=>{});await locator.click();const item=await waiting;
 const temporary=join(attempt,'.download-'+randomUUID());await item.saveAs(temporary);
 try{const bytes=await readFile(temporary);
  if(expected){check(bytes.length===expected.bytes&&sha(bytes)===expected.sha256,'Downloaded native bytes differ from the original ticket: '+name);}
  if(expectedJSON!==undefined)equal(JSON.parse(bytes.toString('utf8')),expectedJSON,'The visible JSON download differs from its original native record: '+name);
  return await retain(name,bytes,expected?'native-file-download':'browser-json-or-csv-download',{suggested_filename:item.suggestedFilename(),...(expected?{native_sha256:expected.sha256}:{})});
 }finally{await unlink(temporary).catch(()=>{});}
}
async function follow(reference){
 await checkpoint();
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/implementation-qc/actions'&&new URL(r.url()).searchParams.get('report_id')===reference.report_id&&r.ok());
 pending.catch(()=>{});await page.locator('.iw-qc [data-qc="follow-open"]').click();await pending;await waitUI();
 await page.locator('.iw-qc [data-qc="follow-back"]').waitFor();await waitUI();
}
async function readAction(reference){
 await checkpoint();
 const pending=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/implementation-qc/actions-inspect'&&new URL(r.url()).searchParams.get('action_report_id')===reference.action_report_id&&r.ok());
 pending.catch(()=>{});await page.locator('.iw-qc [data-qc="follow-open-report"][data-report="'+reference.action_report_id+'"]').click();await pending;await waitUI();
 await page.locator('.iw-qc [data-qc="follow-archive"]').waitFor();
 await page.waitForFunction(id=>[...document.querySelectorAll('.iw-qc .qc-box > p')].some(n=>n.textContent===id),reference.action_report_id);
}
function verifyTask(task,request,accepted=null){
 check(hex(task.id)&&task.workspace===request.workspace&&task.action===request.action&&typeof task.operation_id==='string'&&task.operation_id,'The original queued task identity changed.');
 equal(task.payload,request.payload,'The original queued export payload changed.');
 check(task.id===sha(canonical({workspace:task.workspace,operation_id:task.operation_id})),'The returned task differs from its native operation identity.');
 if(accepted?.task_id)check(task.id===accepted.task_id&&task.operation_id===accepted.accepted_operation_id,'The accepted original task changed.');
}
async function saveTask(key,task){
 const entry=state.requests[key];verifyTask(task,entry.request,entry);
 entry.task_id=task.id;entry.accepted_operation_id=task.operation_id;
 entry.coalesced_original_operation=task.operation_id!==entry.request.operation_id;
 entry.state=task.state;entry.observed_at=now();await persist();
}
async function exportTask(key,selector,action,payload){
 await checkpoint();
 let entry=state.requests[key],task;
 if(entry){
  equal({action:entry.request.action,payload:entry.request.payload,workspace:entry.request.workspace},{action,payload,workspace:args.workspace},'The retained export stage changed.');
  task=entry.task_id?await api('/api/task',{id:entry.task_id}):await api('/api/actions',{},entry.request);
  await saveTask(key,task);
  if(task.state==='interrupted'&&args.resume){task=await api('/api/task/resume',{}, {id:task.id});await saveTask(key,task);}
 }else{
  activeExport={key,action,payload,dispatched:false,error:null};
  try{const waiting=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/actions'&&bodyOf(r.request())?.action===action);
   waiting.catch(()=>{});await page.locator(selector).click();task=await responseJSON(await waiting,'Original '+action);
   if(activeExport.error)throw activeExport.error;check(activeExport.dispatched,'The original request was not retained before dispatch.');await saveTask(key,task);
  }finally{activeExport=null;}
 }
 const until=Date.now()+Number(args['task-timeout-seconds'])*1000;
 while(task.state!=='complete'){
  await checkpoint();
  if(stopped.has(task.state))throw Error('Original export '+task.id+' is '+task.state+': '+redact(task.error?.message||'Continue the same retained native task.'));
  check(Date.now()<until,'Original export remains active; resume this same course output: '+task.id);
  await page.waitForTimeout(1000);task=await api('/api/task',{id:task.id});await saveTask(key,task);
 }
 task=await api('/api/task',{id:task.id});await saveTask(key,task);check(task.state==='complete','The retained export is no longer complete.');
 await step('Completed original export',{stage:key,task_id:task.id,accepted_operation_id:task.operation_id,action});return task;
}
async function taskFiles(task,label){
 await closeQC();await closeDetail();
 if(!await page.locator('#task-panel').isVisible())await page.locator('[data-action="tasks"]').first().click();
 await page.locator('[data-action="task-open"][data-id="'+task.id+'"]').first().click();await waitUI();
 const links=page.locator('#detail-body a[download]');await links.first().waitFor();
 const tickets=(task._downloads||[]).filter(t=>/\.(html|csv|zip)$/i.test(t.filename||t.label||''));
 check(tickets.some(t=>/\.zip$/i.test(t.filename||'')),'The native export has no complete ZIP download.');
 for(let i=0;i<tickets.length;i++){
  const ticket=tickets[i];check(hex(ticket.sha256)&&Number.isSafeInteger(ticket.bytes),'The original file ticket is incomplete.');
  const index=await links.evaluateAll((nodes,url)=>nodes.findIndex(n=>new URL(n.href).pathname===new URL(url,document.baseURI).pathname),ticket.url);
  check(index>=0,'The task omitted the retained file link: '+ticket.filename);
  const file=await download(links.nth(index),label+'-'+String(i+1).padStart(2,'0')+'-'+basename(ticket.filename),ticket);
  if(/\.html$/i.test(ticket.filename))journey.offline_html.push(file.path);
 }
 await shot(label+'-native-downloads',page.locator('#detail-body'));
 await closeDetail();
}
async function viewQC(index,{exports=true,suffix=''}={}){
 const reference=baselineQC[index],label=(index===0?'initial':'repeat')+suffix;
 await openQC();await readReview(reference);
 await download(page.locator('.iw-qc [data-qc="result-json"]'),label+'-qc-review.json',null,reference.review);
 await shot(label+'-qc-results',page.locator('.iw-qc [data-qc="result-json"]'));
 await page.setViewportSize({width:390,height:844});
 await shot(label+'-qc-narrow',page.locator('.iw-qc [data-qc="result-json"]'));
 await page.setViewportSize({width:1440,height:1000});
 if(exports){const task=await exportTask('qc-'+reference.report_id,'.iw-qc [data-qc="archive"]','implementation.qc.export',{plan_id:fieldwork.plan_id,report_id:reference.report_id});await taskFiles(task,label+'-qc');await openQC();await readReview(reference);}
 await follow(reference);
 const current=await qc('actions',{report_id:reference.report_id});
 for(const group of current.groups||[]){
  await download(page.locator('.iw-qc [data-qc="follow-history"][data-group="'+group.group.id+'"]'),label+'-history-'+sha(group.group.id).slice(0,12)+'.json',null,
   {schema:'upstate.implementation-qc-action-history-export/v1',plan_id:fieldwork.plan_id,report_id:reference.report_id,current_revision:current.revision,...group});
 }
 const actions=baselineActions.filter(r=>r.report_id===reference.report_id);
 for(let i=0;i<actions.length;i++){
  const action=actions[i],name=label+'-decisions-'+(i+1);
  await readAction(action);await shot(name,page.locator('.iw-qc [data-qc="follow-archive"]'));
  await page.setViewportSize({width:390,height:844});await shot(name+'-narrow',page.locator('.iw-qc [data-qc="follow-archive"]'));await page.setViewportSize({width:1440,height:1000});
  if(exports){const task=await exportTask('actions-'+action.action_report_id,'.iw-qc [data-qc="follow-archive"]','implementation.qc.actions.export',{plan_id:fieldwork.plan_id,action_report_id:action.action_report_id});
   await taskFiles(task,name);await openQC();await readReview(reference);await follow(reference);}
 }
 await page.locator('.iw-qc [data-qc="follow-plan"]').click();await waitUI();
 await page.locator('[data-impl="tab"][data-tab="tasks"]').waitFor();
 for(const task of fieldwork.corrective_tasks){
  const row=page.locator('.iw tr').filter({has:page.locator('[data-impl="edit"][data-collection="tasks"][data-id="'+task.id+'"]')});
  check(await row.count()===1,'The original corrective task is absent from the field plan.');
  const text=await row.innerText();check(text.includes(task.title)&&text.includes(task.status.replaceAll('_',' ')),'The original task title/status is missing from its native row.');
 }
 await shot(label+'-corrective-tasks');
 await step('Opened original saved QC, decisions and current field tasks',{report_id:reference.report_id,action_report_ids:actions.map(r=>r.action_report_id),fresh_browser:!exports});
}
async function draftAndError(){
 await openQC();
 const note=page.locator('.iw-qc [name="review.notes"]'),old=await note.inputValue(),mark=old+'\nBrowser receiving draft '+fieldwork.operation_id.slice(0,12);
 await note.fill(mark);await closeQC();await openQC();
 check(await page.locator('.iw-qc [name="review.notes"]').inputValue()===mark,'Closing the native QC editor lost its unsaved local note.');
 await page.locator('.iw-qc [name="review.notes"]').fill(old);
 const filter=page.locator('.iw-qc [name="filter"]');await filter.fill('no-native-observation-'+randomUUID());
 await shot('qc-empty-filter',filter);check(await page.locator('.iw-qc [data-qc="record"]').count()===0,'The empty filter still shows result rows.');
 await filter.fill('');
 await page.locator('.iw-qc [data-qc="clear-selection"]').click();
 await page.locator('.iw-qc [data-qc="add"]').click();
 await page.locator('.iw-qc .qc-error').waitFor();
 const error=await page.locator('.iw-qc .qc-error').innerText();check(error.includes('Select two duplicate results'),'The invalid control relationship did not show its original applicability guidance.');
 await shot('qc-invalid-control-selection',page.locator('.iw-qc .qc-error'));
 await closeQC();await openQC();
 const records=await qc('records',{revision:baselinePlan.revision});
 const first=records.records.find(r=>fieldwork.original_observations.some(o=>o.id===r.observation_id));
 check(first,'The original imported lab record is unavailable.');
 await download(page.locator('.iw-qc [data-qc="record"][data-id="'+first.observation_id+'"]'),'original-laboratory-record.json',null,first);
 await closeQC();
 await step('Preserved local notes and inspected empty/error/original-record states',{original_observation_id:first.observation_id,validation_message:error});
}
async function fieldViews(){
 await checkpoint();
 await page.locator('[data-impl="tab"][data-tab="overview"]').click();await shot('field-plan-overview');
 await page.locator('[data-impl="tab"][data-tab="field"]').click();await shot('field-original-records');
 await download(page.locator('[data-impl="results-csv"]'),'matching-field-results.csv');
 await download(page.locator('[data-impl="results-json"]'),'matching-field-results-and-sources.json');
 await page.setViewportSize({width:390,height:844});await shot('field-original-records-narrow');await page.setViewportSize({width:1440,height:1000});
}
async function evidenceFiles(){
 await checkpoint();
 await closeQC();await page.locator('[data-impl="tab"][data-tab="handover"]').click();await waitUI();
 const links=baselinePlan.source_links.filter(row=>row.kind==='local_file');
 check(links.length,'The completed field course has no original laboratory/evidence attachments.');
 for(let i=0;i<links.length;i++){
  const item=links[i];
  await download(page.locator('[data-iw-evidence="download"][data-id="'+item.id+'"]').first(),
   'evidence-'+String(i+1).padStart(2,'0')+'-'+basename(item.original_filename||item.id),
   {bytes:item.size_bytes,sha256:item.sha256});
 }
 await shot('original-field-evidence',page.locator('.iw-evidence'));
 await page.setViewportSize({width:390,height:844});await shot('original-field-evidence-narrow',page.locator('.iw-evidence'));await page.setViewportSize({width:1440,height:1000});
 await step('Downloaded original laboratory and repeat-field attachments',{source_link_ids:links.map(r=>r.id)});
}
async function installedSources(){
 const files=['/web/implementation.mjs','/web/implementation_qc.mjs','/web/implementation_evidence_ui.mjs'];
 // Resolve module URLs from the actual loaded application; no assumed /web alias.
 const requests=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));
 const rows=[];
 for(const filename of files.map(x=>basename(x))){
  const address=requests.find(value=>new URL(value).pathname.endsWith('/'+filename));
  if(!address)continue;
  const response=await page.request.get(address,{headers:{Authorization:'Bearer '+token},maxRedirects:0});
  check(response.ok(),'The current rendered module could not be retained: '+filename);
  const bytes=await response.body();rows.push({path:new URL(address).pathname,bytes:bytes.length,sha256:sha(bytes)});
 }
 await retain('rendered-source-edition.json',jsonBytes(rows),'rendered-application-source-identities');
}
async function offlineReports(){
 const savedPage=page,c=await createContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 try{
  page=await c.newPage();page.on('pageerror',e=>journey.browser_errors.push(redact(e.message)));
  for(const [index,name]of [...new Set(journey.offline_html)].entries()){
   const path=resolve(output,name);check(path.startsWith(output+'/'),'A report left the original output directory.');
   const row=journey.artifacts.find(r=>r.path===name);const bytes=await readFile(path);
   check(row&&bytes.length===row.bytes&&sha(bytes)===row.sha256,'An offline native HTML report changed.');
   await page.goto(pathToFileURL(path).href,{waitUntil:'load'});check((await page.locator('body').innerText()).trim(),'The retained report rendered an empty body.');
   await shot('offline-report-'+(index+1));await page.setViewportSize({width:390,height:844});await shot('offline-report-'+(index+1)+'-narrow');await page.setViewportSize({width:1440,height:1000});
  }
 }finally{await closeOwnedContext(c);page=savedPage;}
}
function draftPrefixes(){
 return['upstate.implementation.qc/v1/','upstate.implementation.qc-actions/v1/','upstate.implementation.qc-operation/v1/'].map(p=>p+args.workspace+'/'+fieldwork.plan_id);
}
async function readDrafts(){
 return borrowed.evaluate(prefixes=>{
  const matches=k=>prefixes.some(p=>k===p||k.startsWith(p+'/'));
  return{prefixes,entries:Object.keys(localStorage).filter(matches).sort().map(k=>[k,localStorage.getItem(k)])};
 },draftPrefixes());
}
function validateDrafts(saved){
 equal(saved.prefixes,draftPrefixes(),'The retained original draft scope changed.');
 check(Array.isArray(saved.entries)&&saved.entries.every(row=>Array.isArray(row)&&row.length===2&&typeof row[0]==='string'&&typeof row[1]==='string'&&saved.prefixes.some(p=>row[0]===p||row[0].startsWith(p+'/'))),'The retained original draft entries are invalid.');
 check(new Set(saved.entries.map(row=>row[0])).size===saved.entries.length,'The original draft snapshot repeats a key.');
}
async function putDrafts(saved){
 validateDrafts(saved);
 check(!borrowed.isClosed(),'The recorded page closed; restore its retained original QC drafts on same-course resume.');
 check(new URL(borrowed.url()).origin===origin,'Reopen the original operator origin to restore its retained QC drafts.');
 if(await borrowed.locator('.iw-qc').count())await borrowed.locator('.iw-qc [data-qc="close"]').click();
 await borrowed.evaluate(value=>{
  const matches=k=>value.prefixes.some(p=>k===p||k.startsWith(p+'/'));
  for(const k of Object.keys(localStorage).filter(matches))localStorage.removeItem(k);
  for(const [k,v]of value.entries)localStorage.setItem(k,v);
 },saved);
 equal(await readDrafts(),saved,'The original QC browser drafts did not restore exactly.');
}
async function persistRecordingContext(){
 await atomic(join(output,'recording-context.json'),jsonBytes(recordingContext));
}
async function preserveBorrowedDrafts(){
 if(!borrowed)return;
 borrowedPageURL=borrowed.url();borrowedViewport=borrowed.viewportSize();const selected=new URL(borrowedPageURL);
 check(selected.origin===origin,'The recorded page belongs to another original operator.');
 check(!options.context||options.context===borrowed.context(),'Use the original recording page and its matching context.');
 const previous=await optional(join(output,'recording-context.json'));
 if(previous){
  const retained=JSON.parse(previous);
  check(retained.schema==='upstate.sample-qc-recording-context/v1'&&retained.input_sha256===sha(canonical(state.input)),'The saved recording context belongs to another original course.');
  validateDrafts(retained.drafts);await retain('previous-recording-context.json',previous,'previous-recording-context');
  if(retained.status==='restore_required'){
   // Keep any later browser edits before restoring this original interrupted course.
   await retain('before-draft-recovery.json',jsonBytes(await readDrafts()),'browser-drafts-before-original-recovery');
   await putDrafts(retained.drafts);
   retained.status='restored';retained.restored_at=now();recordingContext=retained;await persistRecordingContext();
   await step('Restored original recording drafts from interrupted same course');
  }else check(retained.status==='restored','The original recording context recovery state is invalid.');
 }
 if(await borrowed.locator('.iw-qc').count())await borrowed.locator('.iw-qc [data-qc="close"]').click();
 borrowedDrafts=await readDrafts();validateDrafts(borrowedDrafts);
 await retain('borrowed-qc-browser-drafts.json',jsonBytes(borrowedDrafts),'original-recording-context-drafts');
 recordingContext={schema:'upstate.sample-qc-recording-context/v1',input_sha256:sha(canonical(state.input)),captured_at:now(),status:'restore_required',viewport:borrowedViewport,drafts:borrowedDrafts};
 await persistRecordingContext();
}
async function restoreBorrowedDrafts(){
 if(!borrowed||!borrowedDrafts)return;
 // A closed persistent page can retain the course's local edits. Keep recovery pending.
 await putDrafts(borrowedDrafts);
 recordingContext.status='restored';recordingContext.restored_at=now();await persistRecordingContext();
}
async function main(){
 await checkpoint();
 if(borrowed){check(!activeRecordingPages.has(borrowed),'The same recorded page already has an active QC course.');activeRecordingPages.add(borrowed);ownsRecordingPage=true;}
 await acquire();await initialize();
 if(borrowed){
  browser=borrowed.context().browser();check(browser,'The recording page must expose its original Playwright Browser.');
  await preserveBorrowedDrafts();
 }else{
  const {chromium}=await import(args['playwright-module']?pathToFileURL(resolve(args['playwright-module'])).href:'playwright');
  browser=await chromium.launch({headless:!args.headed,...(args['browser-channel']?{channel:args['browser-channel']}:{}),...(args['browser-executable']?{executablePath:resolve(args['browser-executable'])}:{})});
 }
 journey.browser_version=browser.version();journey.mode=borrowed?'existing-recording-page':'standalone';
 await newPage(borrowed);await loadOriginal();journey.offline_html=[];
 await step('Opened original completed native field campaign',{plan_id:fieldwork.plan_id,revision:baselinePlan.revision,operation_id:fieldwork.operation_id});
 await fieldViews();await draftAndError();await installedSources();await viewQC(0);await viewQC(1);await evidenceFiles();
 equal(await detail(),baselinePlan,'The field plan changed during this read/export course.');
 const originalPage=page,originalContext=context;
 if(!borrowed)await closeOwnedContext(context);
 await newPage();
 try{
  await viewQC(0,{exports:false,suffix:'-fresh'});await viewQC(1,{exports:false,suffix:'-fresh'});
  equal(await detail(),baselinePlan,'Fresh-browser receiving changed the original field plan.');
  for(const [key,entry]of Object.entries(state.requests)){const task=await api('/api/task',{id:entry.task_id});verifyTask(task,entry.request,entry);check(task.state==='complete','An original export is no longer complete.');}
  await offlineReports();
 }finally{await closeOwnedContext(context);page=originalPage;context=originalContext;}
 check(journey.browser_errors.length===0,'The actual browser reported errors; inspect journey.json and screenshots.');
 journey.status='course_complete';journey.finished_at=now();await step('Completed original field/QC browser course',{native_export_tasks:Object.values(state.requests).map(v=>v.task_id),producer_pixel_inspection:'required'});
 return{status:journey.status,directory:output,operation_id:fieldwork.operation_id,plan_id:fieldwork.plan_id,
  qc_report_ids:baselineQC.map(r=>r.report_id),action_report_ids:baselineActions.map(r=>r.action_report_id),
  task_ids:Object.values(state.requests).map(r=>r.task_id),screenshots:journey.artifacts.filter(r=>r.kind==='actual-browser-screenshot'),
  artifacts:journey.artifacts,visual_review:journey.visual_review};
}
try{return await main();}
catch(e){
 primaryFailure=e;
 if(journalReady){journey.status='interrupted';journey.error=redact(e.stack||e.message);journey.finished_at=now();if(page&&!page.isClosed())await shot('interruption',null,true).catch(()=>{});await journal().catch(()=>{});}
 const reported=Error(redact(e.stack||e.message));reported.name=typeof e.name==='string'?e.name:'Error';
 if(typeof e.code==='string')reported.code=redact(e.code);
 if(typeof e.publicCode==='string')reported.publicCode=redact(e.publicCode);
 throw reported;
}finally{
 const cleanupFailures=[];
 const noteCleanup=e=>cleanupFailures.push(redact(e.stack||e.message));
 try{await restoreBorrowedDrafts();if(borrowed&&!borrowed.isClosed()&&borrowedViewport)await borrowed.setViewportSize(borrowedViewport);}
 catch(e){noteCleanup(e);}
 for(const binding of pageBindings){
  const p=binding.page;
  try{p.off('request',binding.onRequest);p.off('requestfinished',binding.onDone);p.off('requestfailed',binding.onDone);p.off('pageerror',binding.onError);}catch(e){noteCleanup(e);}
  if(binding.route&&!p.isClosed())try{await p.unroute(binding.route.pattern,binding.route.handler);}catch(e){noteCleanup(e);}
 }
 for(const created of [...ownedContexts])try{await closeOwnedContext(created);}catch(e){noteCleanup(e);}
 if(browser&&!borrowed)try{await browser.close();}catch(e){noteCleanup(e);}
 // Finish every retained journal write before another invocation can own this output.
 try{
  if(cleanupFailures.length&&journalReady){
   journey.status='interrupted';journey.cleanup_errors=[...cleanupFailures];
   try{await journal();}catch(e){noteCleanup(e);}
  }
 }finally{
  if(lease)try{await lease.close();}catch(e){noteCleanup(e);}
  if(ownsRecordingPage)activeRecordingPages.delete(borrowed);
 }
 if(cleanupFailures.length&&!primaryFailure)throw Error('The original recording/course cleanup needs attention: '+cleanupFailures.join('\n'));
}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {values:args}=parseArgs({options:{
  'url-file':{type:'string'},workspace:{type:'string'},fieldwork:{type:'string'},output:{type:'string'},
  resume:{type:'boolean',default:false},headed:{type:'boolean',default:false},
  'browser-channel':{type:'string'},'browser-executable':{type:'string'},'playwright-module':{type:'string'},
  'task-timeout-seconds':{type:'string',default:'900'},help:{type:'boolean',default:false}
 }});
 if(args.help)console.log('node source/implementation/run_sample_qc_browser.mjs --url-file PRIVATE_URL_FILE --workspace WORKSPACE_KEY --fieldwork INSPECT_CAMPAIGN.json --output NEW_PRIVATE_DIRECTORY [--resume] [--headed] [--browser-channel NAME | --browser-executable PATH] [--playwright-module EXISTING_MODULE_PATH] [--task-timeout-seconds 900]');
 else try{
  const result=await runSampleQCCourse({urlFile:args['url-file'],workspace:args.workspace,fieldworkFile:args.fieldwork,output:args.output,
   resume:args.resume,headed:args.headed,browserChannel:args['browser-channel'],browserExecutable:args['browser-executable'],playwrightModule:args['playwright-module'],taskTimeoutSeconds:args['task-timeout-seconds']});
  console.log(JSON.stringify(result,null,2));
 }catch(e){console.error(e.message);process.exitCode=1;}
}
