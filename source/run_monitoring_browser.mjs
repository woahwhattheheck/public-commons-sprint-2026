#!/usr/bin/env node
/** Operate an actual retained Monitoring campaign through the original operator. */
import { chromium } from 'playwright';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative, basename } from 'node:path';
import { parseArgs } from 'node:util';

const {values:args}=parseArgs({options:{
 'url-file':{type:'string'},opening:{type:'string'},receiving:{type:'string'},'restored-selection':{type:'string'},workspace:{type:'string'},
 'context-id':{type:'string'},'comparison-selection':{type:'string'},'comparison-report-title':{type:'string'},'comparison-report-delivery':{type:'string'},output:{type:'string'},
 resume:{type:'boolean',default:false},video:{type:'boolean',default:false},
 headed:{type:'boolean',default:false},'browser-channel':{type:'string'},'browser-executable':{type:'string'},'browser-renderer-limit':{type:'string'},
 'task-timeout-seconds':{type:'string',default:'3600'},help:{type:'boolean',default:false}
}});
if(args.help){
 console.log('node source/run_monitoring_browser.mjs --url-file PRIVATE_URL_FILE (--opening MONITORING_OPENING.json --receiving RECEIVING.json | --restored-selection SELECTION.json --workspace KEY) --output DIRECTORY [--context-id SAVED_CONTEXT] [--comparison-selection BUDGET_SELECTION.json] [--comparison-report-title TITLE [--comparison-report-delivery DELIVERY_ID]] [--video] [--headed] [--browser-channel NAME | --browser-executable PATH] [--browser-renderer-limit COUNT] [--resume]');
 process.exit(0);
}
const output=resolve(args.output||join('artifacts','monitoring-browser',new Date().toISOString().replace(/[:.]/g,'-')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const required=(value,message)=>{if(!value)throw Error(message);};
const stopped=new Set(['failed','interrupted','cancelled']);
let browser,context,page,privateURL='',origin='',capability='',currentWorkspace='';
let opening,receiving,requestState,selection,baseline,comparisonSelection=null,comparisonReport=null,journalWritable=false;
let journal={schema:'upstate.monitoring-browser/v1',prepared_by:'TokenJunkieLabs engineering',
 started_at:new Date().toISOString(),status:'running',steps:[],screenshots:[],downloads:[],browser_errors:[]};
async function readOptional(path){
 try{return await readFile(path,'utf8');}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function atomicText(path,text){
 const temporary=path+'.'+process.pid+'.tmp',file=await open(temporary,'w',0o600);
 try{await file.writeFile(text);await file.sync();}finally{await file.close();}
 await rename(temporary,path);
 const directory=await open(output,'r');try{await directory.sync();}finally{await directory.close();}
}
async function persistRequests(){
 await atomicText(join(output,'request-state.json'),JSON.stringify(requestState,null,2)+'\n');
}
function redact(value){
 let result=String(value);
 for(const item of [privateURL,origin,capability].filter(Boolean))result=result.split(item).join('[private operator]');
 return result.replace(/#token=[^\s"'<>]+/g,'#token=[redacted]');
}
async function writeJournal(){
 if(journalWritable)await atomicText(join(output,'journey.json'),redact(JSON.stringify(journal,null,2))+'\n');
}
async function stage(name){
 journal.current_step=name;await writeJournal();
}
async function record(name,details={}){
 journal.steps.push({name,completed_at:new Date().toISOString(),...details});await writeJournal();
}
async function shot(name){
 const path=join(output,name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled'});
 const bytes=await readFile(path);journal.screenshots.push({path:relative(output,path),bytes:bytes.length,sha256:hash(bytes)});
}
function browserRuntime(){
 required(!(args['browser-channel']&&args['browser-executable']),'Choose a browser channel or an explicit executable path.');
 const rendererLimit=args['browser-renderer-limit']===undefined?null:Number(args['browser-renderer-limit']);
 required(rendererLimit===null||(/^[1-9][0-9]*$/.test(args['browser-renderer-limit'])&&Number.isSafeInteger(rendererLimit)&&rendererLimit<=32),'Choose a browser renderer limit between 1 and 32.');
 return{kind:args['browser-executable']?'executable':args['browser-channel']?'channel':'bundled',
  executable_path:args['browser-executable']?resolve(args['browser-executable']):null,
  channel:args['browser-channel']||null,headless:!args.headed,renderer_process_limit:rendererLimit};
}
async function initializeContinuation(){
 browserRuntime();
 required(!args.resume||args.output,'Resume with the original explicit --output directory.');
 let input;
 if(args['restored-selection']){
  required(!args.opening&&!args.receiving,'Choose restored native selection or original preparation journals.');
  required(typeof args.workspace==='string'&&args.workspace.trim(),'Supply the actual receiving operator workspace key.');
  const selectedBytes=await readFile(resolve(args['restored-selection'])),selected=JSON.parse(selectedBytes.toString('utf8'));
  required(selected.schema==='upstate.monitoring-browser-selection/v1','Choose a native restored Monitoring browser selection.');
  for(const key of ['project_id','network_id','plan_id','campaign_id']){
   required(typeof selected[key]==='string'&&selected[key].trim(),'The restored selection must name its original '+key+'.');
  }
  required(selected.context_id==null||(typeof selected.context_id==='string'&&selected.context_id.trim()),'Choose a saved observation context ID or omit context_id.');
  required(!selected.context_id||!args['context-id']||selected.context_id===args['context-id'],'The requested observation context differs from the restored selection.');
  selection={workspace_key:args.workspace,project_id:selected.project_id,network_id:selected.network_id,
   plan_id:selected.plan_id,campaign_id:selected.campaign_id,context_id:selected.context_id||args['context-id']||null};
  input={mode:'restored-native',restored_selection_sha256:hash(selectedBytes),...selection};
 }else{
  required(args.opening&&args.receiving,'Supply the actual opening and completed receiving journal, or --restored-selection with --workspace.');
  const openingBytes=await readFile(resolve(args.opening)),receivingBytes=await readFile(resolve(args.receiving));
  opening=JSON.parse(openingBytes.toString('utf8'));receiving=JSON.parse(receivingBytes.toString('utf8'));
  required(opening.schema==='upstate.regional-monitoring-opening/v1'&&opening.operator_workspace_key&&opening.project_id,'Choose the native regional Monitoring opening.');
  required(receiving.network_id&&receiving.plan_id&&receiving.campaign_id,'The original receiving journal must name its retained network, plan and campaign.');
  required(receiving.summary?.complete===true,'Complete the original native receiving operation before opening its campaign.');
  required(canonical(receiving.selection)===canonical(opening.selection)&&receiving.summary.original_project?.id===opening.project_id,'The receiving journal belongs to a different original preparation or project.');
  required(!args.workspace||args.workspace===opening.operator_workspace_key,'The explicit workspace differs from the original opening.');
  selection={workspace_key:opening.operator_workspace_key,project_id:opening.project_id,
   network_id:receiving.network_id,plan_id:receiving.plan_id,campaign_id:receiving.campaign_id,
   context_id:args['context-id']||null};
  input={opening_sha256:hash(openingBytes),receiving_sha256:hash(receivingBytes),...selection};
 }
 if(args['comparison-selection']){
  const bytes=await readFile(resolve(args['comparison-selection'])),chosen=JSON.parse(bytes.toString('utf8'));
  required(chosen.schema==='upstate.monitoring-budget-browser-selection/v1','Choose an original saved budget comparison browser selection.');
  required(typeof chosen.frontier_id==='string'&&chosen.frontier_id.trim(),'Select an existing original frontier.');
  required(chosen.baseline_plan_id==null||(typeof chosen.baseline_plan_id==='string'&&chosen.baseline_plan_id.trim()),'Select a retained baseline plan or omit it.');
  required(chosen.context_ids===undefined||(Array.isArray(chosen.context_ids)&&chosen.context_ids.every(id=>typeof id==='string'&&id.trim())&&new Set(chosen.context_ids).size===chosen.context_ids.length),'Context IDs must be distinct original saved contexts.');
  required(typeof chosen.title==='string'&&chosen.title.trim(),'Give the saved comparison a title.');
  comparisonSelection={frontier_id:chosen.frontier_id,baseline_plan_id:chosen.baseline_plan_id||null,context_ids:chosen.context_ids||[],title:chosen.title.trim()};
  input={...input,comparison:{selection_sha256:hash(bytes),selection:comparisonSelection}};
 }
 if(args['comparison-report-title']!==undefined){
  required(comparisonSelection,'A comparison report source requires --comparison-selection.');
  const title=args['comparison-report-title'].trim();
  required(title&&title.length<=300,'Give the report source a title of 1–300 characters.');
  const delivery=args['comparison-report-delivery']||null;
  required(delivery===null||/^[a-f0-9]{64}$/.test(delivery),'Choose an original saved scientific delivery ID.');
  comparisonReport={title,delivery_id:delivery};input={...input,comparison_report:comparisonReport};
 }else required(args['comparison-report-delivery']===undefined,'Select a report source title before choosing its scientific delivery.');
 const retained=await readOptional(join(output,'request-state.json')),previous=await readOptional(join(output,'journey.json'));
 if(args.resume){
  required(retained,'This output has no original durable Monitoring request state.');
  requestState=JSON.parse(retained);
  required(requestState.schema==='upstate.monitoring-browser-requests/v1'&&canonical(requestState.input)===canonical(input),'Resume with the exact original input files, workspace and selected context, or choose a new output directory.');
  required(requestState.requests&&typeof requestState.requests==='object'&&!Array.isArray(requestState.requests),'The original queued request state is missing.');
  if(previous){journal=JSON.parse(previous);required(journal.schema==='upstate.monitoring-browser/v1','Choose the original Monitoring journey.');}
  journal.attempts=journal.attempts||[];
  journal.attempts.push({resumed_at:new Date().toISOString(),previous_status:journal.status,previous_error:journal.error||null,previous_browser_runtime:journal.browser_runtime||null});
  journal.status='running';journal.browser_errors=[];delete journal.error;delete journal.finished_at;
 }else{
  required(!retained&&!previous,'This output already contains a journey. Use --resume or select a new output directory.');
  requestState={schema:'upstate.monitoring-browser-requests/v1',created_at:new Date().toISOString(),input,requests:{}};
 }
 journal.workspace_key=selection.workspace_key;journal.selection=selection;journal.input=input;journal.browser_runtime=browserRuntime();journalWritable=true;
 await persistRequests();await writeJournal();
}
function hasRequest(stage){return Boolean(requestState.requests[stage]);}
const errors=error=>journal.browser_errors.push(redact(error.message));
function bodyOf(response){try{return response.request().postDataJSON()||{};}catch{return{};}}
async function json(response,label){
 required(response.ok(),label+' returned HTTP '+response.status());
 const value=await response.json();
 required(!value.error||(value.schema==='upstate.operator-task/v1'&&value.id&&value.action),label+': '+redact(value.error?.message||value.error||''));
 return value;
}
async function apiGet(path,params={}){
 return json(await page.request.get(origin+path+'?'+new URLSearchParams(params),{headers:{Authorization:'Bearer '+capability},maxRedirects:0}),path);
}
async function apiPost(path,body){
 return json(await page.request.post(origin+path,{headers:{Authorization:'Bearer '+capability},data:body,maxRedirects:0}),path);
}
async function monitoring(action,payload={},workspace=currentWorkspace){
 return apiGet('/api/monitoring',{workspace,action,payload:JSON.stringify(payload)});
}
async function closeDetail(){
 if(await page.locator('#detail-dialog').isVisible())await page.locator('#detail-dialog [data-action="detail-close"]').click();
}
async function waitTask(id){
 const seconds=Number(args['task-timeout-seconds']);required(Number.isFinite(seconds)&&seconds>0,'Choose a positive task observation period.');
 const until=Date.now()+seconds*1000;
 while(Date.now()<until){
  const task=await apiGet('/api/task',{id});required(task.id===id,'The operator returned another task.');
  if(task.state==='complete')return task;
  if(stopped.has(task.state))throw Error(task.action+' is '+task.state+': '+redact(task.error?.message||'Continue its original retained task.'));
  await page.waitForTimeout(1500);
 }
 throw Error('Original queued operation is still active beyond the observation period: '+id);
}
function validateTask(task,request){
 required(task.id&&task.action===request.action&&task.workspace===request.workspace&&canonical(task.payload)===canonical(request.payload),'The queued task differs from this retained original request.');
}
async function keepTask(stage,task){
 const entry=requestState.requests[stage];validateTask(task,entry.request);
 entry.task_id=task.id;entry.accepted_operation_id=task.operation_id;entry.state=task.state;
 entry.observed_at=new Date().toISOString();await persistRequests();
}
async function queue(stage,selector,action,expected={}){
 let entry=requestState.requests[stage],task;
 if(entry){
  required(entry.request.action===action&&entry.request.workspace===currentWorkspace,'The original stage belongs to another action or workspace.');
  for(const [key,value]of Object.entries(expected))required(canonical(entry.request.payload[key])===canonical(value),'The retained export selection changed: '+key);
  task=entry.task_id?await apiGet('/api/task',{id:entry.task_id}):await apiPost('/api/actions',entry.request);
  await keepTask(stage,task);
  if(stopped.has(task.state)){task=await apiPost('/api/task/resume',{id:task.id});await keepTask(stage,task);}
  await record('Reopened original '+stage,{task_id:task.id,action,state:task.state});
 }else{
  let intercepted=false,interceptionError;
  const intercept=async route=>{
   const request=bodyOf({request:()=>route.request()});
   if(new URL(route.request().url()).origin!==origin||request.action!==action){await route.continue();return;}
   try{
    required(!intercepted,'This stage submitted two native requests.');
    required(request.workspace===currentWorkspace&&request.operation_id&&request.payload,'The browser did not submit its original workspace operation.');
    for(const [key,value]of Object.entries(expected))required(canonical(request.payload[key])===canonical(value),'The browser selection changed before dispatch: '+key);
    intercepted=true;requestState.requests[stage]={request,prepared_at:new Date().toISOString(),state:'prepared'};
    await persistRequests();await route.continue();
   }catch(error){interceptionError=error;await route.abort('failed');}
  };
  await page.route('**/api/actions',intercept);
  try{
   const pending=page.waitForResponse(response=>new URL(response.url()).origin===origin&&new URL(response.url()).pathname==='/api/actions'&&bodyOf(response).action===action);
   pending.catch(()=>{});
   await page.locator(selector).click();task=await json(await pending,'Queue '+stage);
   if(interceptionError)throw interceptionError;
   required(intercepted,'The request was not retained before dispatch.');await keepTask(stage,task);
   await record('Queued '+stage,{task_id:task.id,operation_id:task.operation_id,action,payload:task.payload});
  }finally{await page.unroute('**/api/actions',intercept);}
 }
 const completed=await waitTask(task.id);await keepTask(stage,completed);
 await record('Completed '+stage,{task_id:completed.id,result:completed.result});
 await closeDetail();return completed;
}
async function openWorkspace(key){
 await page.locator('#workspace-select').waitFor();
 if(await page.locator('#workspace-select').inputValue()!==key){
  const pending=page.waitForResponse(async response=>{
   if(new URL(response.url()).pathname!=='/api/state'||!response.ok())return false;
   try{return(await response.json()).workspace_key===key;}catch{return false;}
  });pending.catch(()=>{});
  await page.locator('#workspace-select').selectOption(key);await json(await pending,'Selected workspace');
 }
 currentWorkspace=key;
}
const desk=selector=>'eco-monitoring '+selector;
async function idle(){
 await page.waitForFunction(()=>{
  const node=document.querySelector('eco-monitoring');
  return Boolean(node?.isConnected&&node.initialized&&!node.busy&&node.shadowRoot?.getElementById('networks'));
 });
}
async function openDesk(){
 await page.locator('[data-view="monitoring"]').click();
 await page.locator(desk('#networks')).waitFor();await idle();
}
async function expandFor(selector){
 const details=page.locator(desk('details')).filter({has:page.locator(selector)});
 required(await details.count()===1,'Find the original Monitoring section for '+selector);
 if(await details.getAttribute('open')===null)await details.locator('summary').first().click();
}
async function chooseNetwork(){
 await page.locator(desk('#networks')).selectOption(selection.network_id);
 await page.waitForFunction(id=>{const n=document.querySelector('eco-monitoring');return n&&!n.busy&&n.network?.id===id&&!n.plan;},selection.network_id);
}
async function choosePlan(){
 await page.locator(desk('#plans')).selectOption(selection.plan_id);
 await page.waitForFunction(ids=>{const n=document.querySelector('eco-monitoring');return n&&!n.busy&&n.plan?.id===ids.plan_id&&n.network?.id===ids.network_id;},selection);
}
async function chooseCampaign(){
 await page.locator(desk('#campaigns')).selectOption(selection.campaign_id);
 await page.waitForFunction(ids=>{const n=document.querySelector('eco-monitoring');return n&&!n.busy&&n.campaign?.revision?.campaign_id===ids.campaign_id&&n.plan?.id===ids.plan_id&&n.network?.id===ids.network_id;},selection);
}
async function readSelection(){
 const [network,plan,campaign]=await Promise.all([
  monitoring('get',{kind:'networks',record_id:selection.network_id}),
  monitoring('get',{kind:'plans',record_id:selection.plan_id}),
  monitoring('campaign.get',{campaign_id:selection.campaign_id})
 ]);
 required(network.id===selection.network_id&&plan.id===selection.plan_id&&plan.network_id===network.id,'The saved design names another original network.');
 required(campaign.revision?.campaign_id===selection.campaign_id&&campaign.plan?.id===plan.id&&campaign.revision.network_id===network.id,'The saved campaign names another design or network.');
 required(['optimal','feasible'].includes(plan.status)&&Array.isArray(campaign.calendar),'Open the actual feasible design and complete native campaign calendar.');
 return{network,plan,campaign};
}
function identity(value){
 return{network_id:value.network.id,plan_id:value.plan.id,campaign_id:value.campaign.revision.campaign_id,
  campaign_revision_id:value.campaign.revision.id,network_sha256:hash(canonical(value.network)),
  plan_sha256:hash(canonical(value.plan)),campaign_sha256:hash(canonical(value.campaign)),
  calendar_sha256:hash(canonical(value.campaign.calendar)),source_bindings_sha256:hash(canonical(value.network.source_bindings))};
}
async function verifyRendered(value){
 required(await page.locator(desk('#map path')).count()===Object.keys(value.network.nodes).length,'The native map did not render its complete retained catchments.');
 required(await page.locator(desk('#sites tbody tr')).count()===value.plan.selected.length,'The selected-area table differs from its original design.');
 const visible=await page.locator(desk('#calendar tbody tr')).evaluateAll(rows=>rows.map(row=>[...row.cells].map(cell=>cell.textContent)));
 const expected=value.campaign.calendar.map(v=>[v.visit_key,v.station_id||'Unbound search area',v.date,v.start_local+'–'+v.finish_local,String(v.crew),v.status].map(v=>v==null?'':String(v)));
 required(canonical(visible)===canonical(expected),'The visible calendar differs from original visit identities, station bindings, dates, crews or status.');
 const bindings=await page.locator(desk('#bindings select')).evaluateAll(nodes=>Object.fromEntries(nodes.filter(n=>n.value).map(n=>[n.dataset.huc,n.value])));
 required(canonical(bindings)===canonical(value.campaign.revision.site_bindings),'The visible station bindings differ from this campaign revision.');
}
async function openObservedContext(){
 if(!selection.context_id)return null;
 const value=await monitoring('context.get',{context_id:selection.context_id});
 required(value.network_id===selection.network_id&&value.plan_id===selection.plan_id&&value.campaign_revision_id===baseline.campaign.revision.id,'Select observation context bound to this exact network, design and campaign revision.');
 await page.locator(desk('.observed-context-panel [data-saved]')).selectOption(selection.context_id);
 await page.waitForFunction(id=>{
  const p=document.querySelector('eco-monitoring')?.shadowRoot?.querySelector('.observed-context-panel [data-result] pre');
  try{return JSON.parse(p?.textContent||'null')?.id===id;}catch{return false;}
 },selection.context_id);await idle();
 const fingerprint=hash(canonical(value));
 if(requestState.context_sha256)required(requestState.context_sha256===fingerprint,'The original observational context changed.');
 else{requestState.context_sha256=fingerprint;await persistRequests();}
 return value;
}
async function saveDownload(locator,name,expected){
 const pending=page.waitForEvent('download');pending.catch(()=>{});
 await locator.click();const download=await pending,path=join(output,'exports',name||basename(download.suggestedFilename()));
 await download.saveAs(path);const bytes=await readFile(path);
 const row={path:relative(output,path),bytes:bytes.length,sha256:hash(bytes)};
 required(row.bytes===expected.bytes&&row.sha256===expected.sha256,'Downloaded native bytes differ from their original file ticket.');
 journal.downloads.push(row);return{path,bytes:row.bytes,sha256:row.sha256};
}
async function taskDownload(task,suffix,name){
 const ticket=(task._downloads||[]).find(item=>item.filename?.endsWith(suffix));
 required(ticket,'The completed native task has no '+suffix+' file ticket.');
 if(!(await page.locator('#task-panel').isVisible()))await page.locator('[data-action="tasks"]').first().click();
 await page.locator('[data-action="task-open"][data-id="'+task.id+'"]').first().click();
 const links=page.locator('#detail-body a[download]');
 await links.first().waitFor();
 const index=await links.evaluateAll((nodes,url)=>nodes.findIndex(node=>new URL(node.href).pathname===new URL(url,document.baseURI).pathname),ticket.url);
 required(index>=0,'Original task detail omitted its retained export link.');
 const result=await saveDownload(links.nth(index),name,ticket);await closeDetail();return result;
}
async function exportCampaign(format){
 await stage('export-campaign-'+format);
 await idle();await expandFor('[data-export="'+format+'"]');
 const expected={campaign_id:selection.campaign_id,expected_revision_id:baseline.campaign.revision.id,format};
 if(selection.context_id)expected.context_id=selection.context_id;
 const task=await queue('campaign-export-'+format,desk('[data-export="'+format+'"]'),'monitoring.export',expected);
 await idle();
 const extension=format==='html'?'.html':'.zip';
 const file=await taskDownload(task,extension,'monitoring-'+format+extension);
 await record('Downloaded original campaign '+format,{task_id:task.id,...file});
 return file;
}
async function inspectDraftAndCorrection(){
 await expandFor('#advanced');
 const advanced=await page.locator(desk('#advanced')).inputValue();
 const title=await page.locator(desk('#title')).inputValue();
 const interval=await page.locator(desk('#interval')).inputValue();
 const changed=String(Number(interval)+1);
 await page.locator(desk('#title')).fill(title+' — calendar working draft');
 await page.locator(desk('#interval')).fill(changed);
 await page.locator('[data-view="sources"]').click();await openDesk();
 required(await page.locator(desk('#title')).inputValue()===title+' — calendar working draft'&&await page.locator(desk('#interval')).inputValue()===changed&&await page.locator(desk('#advanced')).inputValue()===advanced,'Navigating away lost the Monitoring working draft.');
 await record('Retained edited calendar draft across native desk navigation',{original_interval_days:interval,working_interval_days:changed});
 await page.locator(desk('#title')).fill(title);await page.locator(desk('#interval')).fill(interval);
 await expandFor('#advanced');await page.locator(desk('#advanced')).fill('{');
 let dispatched=false;
 const rejectUnexpected=async route=>{const body=bodyOf({request:()=>route.request()});if(body.action==='monitoring.design'){dispatched=true;await route.abort('failed');}else await route.continue();};
 await page.route('**/api/actions',rejectUnexpected);
 try{
  await page.locator(desk('#design-form button[type="submit"]')).click();
  await page.locator(desk('#status[data-error="true"]')).waitFor();await idle();
  required(!dispatched,'Invalid advanced JSON reached a native design request.');
  await shot('03-invalid-configuration');await record('Rejected invalid advanced JSON before native design submission',{message:await page.locator(desk('#status')).textContent()});
 }finally{await page.unroute('**/api/actions',rejectUnexpected);}
 await page.locator(desk('#advanced')).fill(advanced);await chooseCampaign();await verifyRendered(baseline);
 await record('Corrected the working input and reopened the original saved campaign',{campaign_revision_id:baseline.campaign.revision.id});
}
async function freshBrowser(){
 const originalPage=page,originalWorkspace=currentWorkspace;
 const fresh=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 try{
  page=await fresh.newPage();page.setDefaultTimeout(60000);page.on('pageerror',errors);
  await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(selection.workspace_key);await openDesk();await chooseCampaign();
  const value=await readSelection();required(canonical(identity(value))===canonical(requestState.selection),'A fresh browser opened another native campaign revision.');
  await verifyRendered(value);await openObservedContext();await shot('06-fresh-browser-campaign');
  if(comparisonSelection){await reopenBudgetComparison('fresh-browser');await chooseCampaign();}
  if(comparisonReport){await reopenComparisonReport('fresh-browser');await reopenScientificEdition('fresh-browser');await openDesk();await chooseCampaign();}
  await record('Reopened the complete original campaign in a fresh browser',{...identity(value)});
 }finally{await fresh.close();page=originalPage;currentWorkspace=originalWorkspace;}
}
async function transferWorkspace(archive){
 await page.locator('[data-view="journey"]').click();
 await page.locator('.journey-steps [data-action="journey-step"][data-step="reopen"]').click();
 if(!hasRequest('workspace-restore')){
  await page.locator('[data-action="journey-restore"]').click();
  await page.locator('#form-dialog input[name="restore_file"]').setInputFiles(archive.path);
 }
 const task=await queue('workspace-restore','#form-submit','workspace.restore');
 required(task.result?.identity==='MATCH'&&task.result?.workspace_key,'Original receiving did not confirm complete workspace identity.');
 required(task.result.workspace_key!==selection.workspace_key,'Receive the original archive into an independent workspace.');
 await openWorkspace(task.result.workspace_key);await openDesk();await chooseCampaign();
 const value=await readSelection();required(canonical(identity(value))===canonical(requestState.selection),'Independent workspace receiving changed the original network, design, campaign, calendar or retained source bindings.');
 await verifyRendered(value);await openObservedContext();await shot('07-received-campaign');
 if(comparisonSelection){await reopenBudgetComparison('received-workspace');await chooseCampaign();}
 if(comparisonReport){await reopenComparisonReport('received-workspace');await reopenScientificEdition('received-workspace');await openDesk();await chooseCampaign();}
 await record('Reopened the original campaign after independent workspace receiving',{workspace_key:currentWorkspace,archive_sha256:archive.sha256,...identity(value)});
 journal.received_workspace_key=currentWorkspace;
}

async function visibleComparison(){
 return page.locator(desk('[data-frontier-result] > details:last-child > pre')).evaluate(node=>JSON.parse(node.textContent));
}
async function waitComparison(expected){
 await page.waitForFunction(expected=>{
  const node=document.querySelector('eco-monitoring');
  const pre=node?.shadowRoot?.querySelector('[data-frontier-result] > details:last-child > pre');
  if(!node||node.busy||!pre)return false;
  try{
   const value=JSON.parse(pre.textContent);
   return (!expected.id||value.id===expected.id)&&value.frontier_id===expected.frontier_id&&
    (!expected.baseline_plan_id||value.baseline_plan_id===expected.baseline_plan_id)&&
    (!expected.title||value.title===expected.title);
  }catch{return false;}
 },expected);
 return visibleComparison();
}
async function comparisonLibrary(){
 await idle();await page.locator(desk('[data-frontier-refresh]')).click();await idle();
}
async function reopenBudgetComparison(label){
 const retained=requestState.comparison;
 required(retained?.comparison_id,'The original browser request has no retained comparison.');
 const native=await monitoring('comparison.get',{comparison_id:retained.comparison_id});
 required(hash(canonical(native))===retained.sha256,'The saved comparison or original plan/source identities changed.');
 await comparisonLibrary();
 await page.locator(desk('[data-comparison-picker]')).selectOption(retained.comparison_id);
 const visible=await waitComparison({id:retained.comparison_id,frontier_id:comparisonSelection.frontier_id});
 required(canonical(visible)===canonical(native),'The reopened visible comparison differs from its retained native record.');
 await shot('budget-'+label);
 await record('Reopened saved budget comparison in '+label,{comparison_id:native.id,sha256:retained.sha256,workspace_key:currentWorkspace,plan_ids:native.plan_ids});
 return native;
}
async function operateBudgetComparison(){
 await stage('open-saved-budget-frontier');
 const frontier=await monitoring('get',{kind:'frontiers',record_id:comparisonSelection.frontier_id});
 required(frontier.network_id===selection.network_id&&frontier.plan_ids?.length,'Choose a saved frontier from this exact original network.');
 const baselineId=comparisonSelection.baseline_plan_id||frontier.plan_ids[0];
 required(frontier.plan_ids.includes(baselineId),'The chosen comparison baseline is absent from the saved frontier.');
 const contexts=[];
 for(const contextId of comparisonSelection.context_ids){
  const value=await monitoring('context.get',{context_id:contextId});
  required(value.network_id===selection.network_id&&frontier.plan_ids.includes(value.plan_id),'A comparison context belongs to another original network or plan.');
  contexts.push(value);
 }
 required(new Set(contexts.map(value=>value.plan_id)).size===contexts.length,'Select at most one original observed context per frontier plan.');
 const chosen={frontier_id:frontier.id,baseline_plan_id:baselineId,
  context_ids:frontier.plan_ids.map(id=>contexts.find(context=>context.plan_id===id)?.id).filter(Boolean),title:comparisonSelection.title};
 const nativePreview=await monitoring('comparison.preview',chosen);
 const nativeSelection={frontier_id:frontier.id,frontier_sha256:hash(canonical(frontier)),
  preview_sha256:hash(canonical(nativePreview)),plan_ids:nativePreview.plan_ids,plan_digests:nativePreview.plan_digests,context_digests:nativePreview.context_digests};
 if(requestState.comparison_source)required(canonical(requestState.comparison_source)===canonical(nativeSelection),'The original comparison frontier, plans or observed context changed.');
 else{requestState.comparison_source=nativeSelection;await persistRequests();}
 await page.locator(desk('[data-frontier-picker]')).selectOption(frontier.id);
 await waitComparison({frontier_id:frontier.id});
 await page.locator(desk('[data-frontier-baseline]')).selectOption(baselineId);
 for(const value of contexts)await page.locator(desk('[data-frontier-context-plan="'+value.plan_id+'"]')).selectOption(value.id);
 await page.locator(desk('[data-comparison-title]')).fill(chosen.title);
 await page.locator(desk('[data-frontier-preview]')).click();
 const preview=await waitComparison(chosen);
 required(canonical(preview)===canonical(nativePreview),'The visible budget preview differs from the actual native comparison.');
 await shot('budget-preview');
 await record('Compared original saved budget choices',{...nativeSelection,selection:chosen,rows:preview.rows.map(row=>({plan_id:row.plan_id,status:row.status,budget_cents:row.budget_cents,cost:row.cost,coverage:row.coverage,delta:row.delta,calendar:row.calendar}))});
 await stage('save-native-budget-comparison');
 const prepared=await queue('budget-comparison-save',desk('[data-frontier-save]'),'monitoring.comparison.prepare',chosen);
 const comparisonId=prepared.result?.id;
 required(comparisonId&&prepared.result.frontier_id===frontier.id,'The original queue did not retain this native budget comparison.');
 const saved=await monitoring('comparison.get',{comparison_id:comparisonId});
 const identity={comparison_id:comparisonId,sha256:hash(canonical(saved))};
 if(requestState.comparison)required(canonical(requestState.comparison)===canonical(identity),'The saved comparison identity differs from the original browser request.');
 else{requestState.comparison=identity;await persistRequests();}
 await idle();await reopenBudgetComparison('saved-library');
 const first=saved.rows[0];
 await page.locator(desk('[data-frontier-plan="'+first.plan_id+'"] [data-frontier-action="open-plan"]')).click();
 await page.waitForFunction(id=>{const node=document.querySelector('eco-monitoring');return node&&!node.busy&&node.plan?.id===id&&node.campaign===null;},first.plan_id);
 const plan=await monitoring('get',{kind:'plans',record_id:first.plan_id});
 required(await page.locator(desk('#map path')).count()===Object.keys(baseline.network.nodes).length,'Opening the original budget plan changed its native network map.');
 const renderedPlan=await page.locator('eco-monitoring').evaluate(node=>node.plan);
 required(canonical(renderedPlan)===canonical(plan),'The native desk opened another plan after selecting a comparison row.');
 await shot('budget-original-plan');await record('Opened the exact original comparison plan',{plan_id:first.plan_id,status:plan.status,calendar_site_capacity:plan.calendar_site_capacity,configuration:plan.configuration});
 await stage('export-native-budget-comparison');
 const exported=await queue('budget-comparison-export',desk('[data-frontier-export]'),'monitoring.comparison.export',{comparison_id:comparisonId});
 const packet=await taskDownload(exported,'.zip','monitoring-budget-comparison.zip');
 await record('Downloaded complete original budget comparison',{comparison_id:comparisonId,...packet});
}

function retainedReport(value){
 const {_downloads,workspace_key,delivery_selection,...record}=value;
 return record;
}
async function reportRead(action,params={}){
 return apiGet('/api/monitoring-report',{workspace:currentWorkspace,action,...params});
}
function reportTicketInventory(value){
 required(Array.isArray(value.files)&&value.files.length&&Array.isArray(value._downloads),'The report omitted its original file inventory.');
 const tickets=value._downloads;
 required(tickets.length===value.files.length&&new Set(tickets.map(item=>item.id)).size===tickets.length,'The report file tickets do not cover each original member exactly once.');
 const signature=rows=>rows.map(row=>canonical(row)).sort();
 required(canonical(signature(value.files.map(item=>[basename(item.path),item.bytes,item.sha256])))===
  canonical(signature(tickets.map(item=>[item.filename,item.bytes,item.sha256]))),'The report download inventory differs from its retained original files.');
 for(const ticket of tickets){
  required(ticket.id&&ticket.workspace===currentWorkspace&&Number.isSafeInteger(ticket.bytes)&&ticket.bytes>=0&&/^[a-f0-9]{64}$/.test(ticket.sha256),'The report returned an invalid native file ticket.');
  required(new URL(ticket.url,origin).origin===origin&&new URL(ticket.url,origin).pathname==='/api/file/'+ticket.id,'The report file ticket points outside the original operator.');
 }
 return tickets;
}
async function reportSource(value){
 required(value.source?.source_collection_id&&value.source?.source_id,'The report omitted its native source selection.');
 const source=await apiGet('/api/source-info',{workspace:currentWorkspace,collection:value.source.source_collection_id,source:value.source.source_id});
 required(source.source?.id===value.source.source_id&&source.source.kind==='document'&&source.source.metadata?.report_schema==='upstate.observed-report/v1','The prepared original report document is absent from this Workspace.');
 required(source.download?.sha256===source.source.body?.sha256&&source.download?.bytes===source.source.body?.bytes,'The original report source body differs from its native download.');
 const selected=value.delivery_selection?.observed_context_sources;
 required(Array.isArray(selected)&&selected.some(choice=>canonical(choice)===canonical(value.source)),'The ordered scientific report selection omitted this original source.');
 return source.source;
}
async function waitReportRead(action,trigger,params={}){
 const pending=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.origin===origin&&url.pathname==='/api/monitoring-report'&&url.searchParams.get('workspace')===currentWorkspace&&url.searchParams.get('action')===action&&Object.entries(params).every(([key,value])=>url.searchParams.get(key)===value);
 });pending.catch(()=>{});
 await trigger();return json(await pending,'Read saved Monitoring report '+action);
}
async function reopenComparisonReport(label){
 const retained=requestState.comparison_report;
 required(retained?.report_id,'This original request has no saved comparison report.');
 await idle();await expandFor('[data-report-scope]');
 await waitReportRead('catalog',()=>page.locator(desk('[data-report-refresh]')).click());
 await page.locator(desk('[data-report-delivery]')).selectOption(comparisonReport.delivery_id||'');
 await page.locator(desk('[data-report-saved]')).selectOption(retained.report_id);
 const value=await waitReportRead('get',()=>page.locator(desk('[data-report-reopen]')).click(),{id:retained.report_id});
 required(value.id===retained.report_id&&value.selection?.comparison_id===requestState.comparison.comparison_id&&hash(canonical(retainedReport(value)))===retained.sha256,'The reopened comparison report differs from its full native original.');
 const source=await reportSource(value);
 required(hash(canonical(source))===retained.source_sha256,'The reopened scientific report source edition changed.');
 required(hash(canonical(value.delivery_selection))===retained.delivery_selection_sha256,'The ordered original scientific delivery selection changed.');
 const tickets=reportTicketInventory(value);
 await page.waitForFunction(expected=>{
  const root=document.querySelector('eco-monitoring')?.shadowRoot;
  if(!root)return false;
  const ids=[...root.querySelectorAll('[data-report-downloads] a')].map(link=>new URL(link.href).pathname.split('/').pop()).sort();
  return JSON.stringify(ids)===JSON.stringify(expected.ids)&&root.querySelector('[data-report-open]')?.hidden===false;
 },{ids:tickets.map(ticket=>ticket.id).sort()});
 required((await page.locator(desk('[data-report-prepared]')).textContent()).includes(value.title),'The report panel did not reopen the selected original title.');
 await shot('report-'+label);
 await record('Reopened original comparison report in '+label,{report_id:value.id,comparison_id:value.selection.comparison_id,source:value.source,file_count:tickets.length,sha256:retained.sha256,workspace_key:currentWorkspace});
 return value;
}

const scientific=selector=>'.scientific-report-editions '+selector;
const sourceChoice=row=>({source_collection_id:row.source_collection_id,source_id:row.source_id});
async function openScientificComposer(value){
 const before=await page.evaluate(key=>JSON.parse(sessionStorage.getItem('scientific-report-draft:'+key)||'null'),currentWorkspace);
 const incoming=value.delivery_selection.observed_context_sources.map(sourceChoice),expected=(before?.selected||[]).map(sourceChoice);
 for(const row of incoming)if(!expected.some(item=>canonical(item)===canonical(row)))expected.push(row);
 await page.locator(desk('[data-report-open]')).click();
 await page.locator(scientific('[data-scientific-report-action="preview"]')).waitFor({state:'visible'});
 await page.waitForFunction(expected=>{
  const panel=document.querySelector('.scientific-report-editions');
  const draft=JSON.parse(sessionStorage.getItem('scientific-report-draft:'+expected.workspace)||'null');
  return panel&&!panel.hidden&&draft&&JSON.stringify(draft.selected)===JSON.stringify(expected.sources);
 },{workspace:currentWorkspace,sources:expected});
 const body=await page.evaluate(key=>{
  const draft=JSON.parse(sessionStorage.getItem('scientific-report-draft:'+key)||'null');
  if(!draft||draft.pending)throw Error('Finish the existing original scientific report request.');
  return{sources:draft.selected,...(draft.title.trim()?{title:draft.title.trim()}:{}),contact:draft.contact};
 },currentWorkspace);
 required(canonical(body.sources)===canonical(expected),'The scientific composer changed its retained draft order.');
 if(before?.title?.trim())required(body.title===before.title.trim(),'Opening prepared sources replaced the existing report draft title.');
 if(before?.contact)required(canonical(body.contact)===canonical(before.contact),'Opening prepared sources replaced existing report contact fields.');
 return body;
}
async function restoreScientificSelection(body){
 // Reenter the frozen browser operation through the original composer controls.
 // This browser owns this working draft; its immutable saved reports stay intact.
 while(await page.locator(scientific('[data-scientific-report-action="remove"]')).count())
  await page.locator(scientific('[data-scientific-report-action="remove"]')).first().click();
 for(const source of body.sources){
  await page.locator(scientific('[data-scientific-report-source]')).selectOption(JSON.stringify([source.source_collection_id,source.source_id]));
  await page.locator(scientific('[data-scientific-report-action="add"]')).click();
 }
 await page.locator(scientific('[data-scientific-report-field="title"]')).fill(body.title||'');
 for(const name of ['name','organization','email'])
  await page.locator(scientific('[data-scientific-report-field="'+name+'"]')).fill(body.contact[name]||'');
}
async function scientificEdition(id){
 return apiGet('/api/source-reports/scientific-edition',{workspace:currentWorkspace,id});
}
function scientificFileIdentity(value){
 return value.files.map(({url,...file})=>file);
}
async function reopenScientificEdition(label,downloadFiles=false){
 const retained=requestState.scientific_report;
 required(retained?.edition_id,'This browser operation has no completed original scientific edition.');
 // The Sources screen is the native scientific report library.
 await page.locator('[data-view="sources"]').click();
 const refresh=scientific('[data-scientific-report-action="refresh"]');
 await page.locator(refresh).waitFor({state:'visible'});
 const ready=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.origin===origin&&url.pathname==='/api/source-reports/scientific-catalog'&&url.searchParams.get('workspace')===currentWorkspace;
 });ready.catch(()=>{});
 await page.locator(refresh).click();await json(await ready,'Refresh original scientific editions');
 const pending=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.origin===origin&&url.pathname==='/api/source-reports/scientific-edition'&&url.searchParams.get('workspace')===currentWorkspace&&url.searchParams.get('id')===retained.edition_id;
 });pending.catch(()=>{});
 await page.locator(scientific('[data-scientific-report-action="open"][data-id="'+retained.edition_id+'"]')).click();
 const value=await json(await pending,'Reopen original scientific report');
 required(value.workspace_key===currentWorkspace&&value.edition?.id===retained.edition_id&&value.edition.state==='complete'&&value.edition.project_id===selection.project_id,'The report library opened another completed scientific edition.');
 required(hash(canonical(value.edition))===retained.sha256&&hash(canonical(scientificFileIdentity(value)))===retained.files_sha256,'The original scientific edition or its complete files changed after reopening.');
 const original=value.edition.render_identity?.selection;
 const choices=original?.observed_context_sources||[original?.source_roles?.OBSERVED_CONTEXT];
 required(canonical(choices)===canonical(requestState.scientific_selection.sources),'The retained scientific report changed its original ordered sources.');
 await page.waitForFunction(expected=>{
  const root=document.querySelector('.scientific-report-editions [data-scientific-report-detail]');
  if(!root||root.hidden)return false;
  const frame=root.querySelector('iframe');
  return root.querySelector('h3')?.textContent===expected.title&&frame&&new URL(frame.src).pathname===new URL(expected.viewer,document.baseURI).pathname;
 },{title:value.edition.title,viewer:value.viewer_url});
 const links=page.locator(scientific('[data-scientific-report-detail] > .table-scroll tbody a[download]'));
 required(await links.count()===value.files.length,'The scientific report library omitted an original file.');
 if(downloadFiles){
  for(let index=0;index<value.files.length;index++){
   const file=value.files[index],url=new URL(file.url,origin);
   required(url.origin===origin,'The saved scientific report file leaves its native operator.');
   const position=await links.evaluateAll((nodes,path)=>nodes.findIndex(node=>new URL(node.href).pathname===path),url.pathname);
   required(position>=0,'The rendered report omitted an original native member.');
   const filename=basename(file.path).replace(/[^A-Za-z0-9._-]/g,'_')||'report';
   await saveDownload(links.nth(position),'scientific-report-'+String(index+1).padStart(4,'0')+'-'+filename,file);
   await writeJournal();
  }
 }
 await shot('scientific-'+label);
 await record('Reopened complete original scientific report in '+label,{edition_id:retained.edition_id,title:value.edition.title,source_count:value.edition.source_count,section_count:value.edition.section_count,figure_count:value.edition.figure_count,file_count:value.files.length,sha256:retained.sha256,workspace_key:currentWorkspace});
 return value;
}
async function operateScientificReport(value){
 await stage('open-original-scientific-composer');
 let editionId;
 if(hasRequest('comparison-scientific-render')||requestState.scientific_report){
  required(requestState.scientific_selection&&requestState.scientific_preview?.preview_id,'The retained report request lost its original ordered preview.');
  editionId=requestState.scientific_preview.preview_id;
  if(hasRequest('comparison-scientific-render')){
   const task=await queue('comparison-scientific-render',scientific('[data-scientific-report-action="render"]'),'source-reports.render',{...requestState.scientific_selection,preview_id:editionId});
   required(task.result?.scientific_report_edition_id===editionId&&task.result.state==='complete','The retained renderer task belongs to another original report.');
  }
 }else{
 let body=await openScientificComposer(value);
 if(requestState.scientific_selection){
  body=requestState.scientific_selection;await restoreScientificSelection(body);
 }else{requestState.scientific_selection=body;await persistRequests();}
 const pending=page.waitForResponse(response=>{
  const url=new URL(response.url());
  return url.origin===origin&&url.pathname==='/api/source-reports/scientific-preview'&&url.searchParams.get('workspace')===currentWorkspace;
 });pending.catch(()=>{});
 await page.locator(scientific('[data-scientific-report-action="preview"]')).click();
 const response=await pending,preview=await json(response,'Preview ordered scientific report');
 required(canonical(bodyOf(response))===canonical(body),'The visible scientific preview submitted another original draft.');
 required(preview.workspace_key===currentWorkspace&&canonical(preview.sources.map(sourceChoice))===canonical(body.sources),'The scientific preview changed its ordered source identities.');
 const binding={preview_id:preview.id,render_identity_sha256:hash(canonical(preview.render_identity)),sources:preview.sources};
 if(requestState.scientific_preview)required(canonical(requestState.scientific_preview)===canonical(binding),'The original report preview source editions or rendering identity changed.');
 else{requestState.scientific_preview=binding;await persistRequests();}
 await page.locator(scientific('[data-scientific-report-preview] .scientific-report-preview')).waitFor({state:'visible'});
 const renderedSources=await page.locator(scientific('.scientific-report-order li strong')).allTextContents();
 required(canonical(renderedSources)===canonical(preview.sources.map(row=>row.title)),'The scientific composer did not preserve the original source reading order.');
 await shot('scientific-ordered-preview');
 await record('Previewed original ordered scientific report',{preview_id:preview.id,sources:preview.sources,title:preview.title});
 await stage('prepare-original-scientific-edition');
 if(hasRequest('comparison-scientific-render')||!preview.existing){
  const task=await queue('comparison-scientific-render',scientific('[data-scientific-report-action="render"]'),'source-reports.render',{...body,preview_id:preview.id});
  required(task.result?.scientific_report_edition_id===preview.id&&task.result.state==='complete','The native renderer retained another original report edition.');
 }
 editionId=preview.id;
 }
 const detail=await scientificEdition(editionId);
 required(detail.edition?.id===editionId&&detail.edition.state==='complete'&&detail.edition.project_id===selection.project_id,'The selected original scientific report did not complete.');
 const retained={edition_id:editionId,sha256:hash(canonical(detail.edition)),files_sha256:hash(canonical(scientificFileIdentity(detail)))};
 if(requestState.scientific_report)required(canonical(requestState.scientific_report)===canonical(retained),'The original completed scientific edition changed.');
 else{requestState.scientific_report=retained;await persistRequests();}
 await reopenScientificEdition('saved-library',true);
 await stage('export-original-scientific-edition');
 const exported=await queue('comparison-scientific-export',scientific('[data-scientific-report-action="export"]'),'source-reports.export',{id:retained.edition_id});
 const archive=await taskDownload(exported,'.zip','monitoring-scientific-report.zip');
 await record('Downloaded complete native scientific report ZIP',{edition_id:retained.edition_id,...archive});
 await openDesk();await chooseCampaign();await verifyRendered(baseline);await openObservedContext();
}
async function operateComparisonReport(){
 await stage('prepare-comparison-report-source');await idle();await expandFor('[data-report-scope]');
 await page.locator(desk('[data-report-scope]')).selectOption('comparison');
 await page.locator(desk('[data-report-comparisons-refresh]')).click();
 await page.waitForFunction(id=>[...document.querySelector('eco-monitoring').shadowRoot.querySelector('[data-report-comparison]').options].some(option=>option.value===id),requestState.comparison.comparison_id);
 await page.locator(desk('[data-report-comparison]')).selectOption(requestState.comparison.comparison_id);
 await page.waitForFunction(resuming=>{const root=document.querySelector('eco-monitoring')?.shadowRoot;return root&&!root.querySelector('[data-report-comparison]').disabled&&(resuming||!root.querySelector('[data-report-prepare]').disabled);},hasRequest('comparison-report-prepare'));
 await page.locator(desk('[data-report-title]')).fill(comparisonReport.title);
 await page.locator(desk('[data-report-delivery]')).selectOption(comparisonReport.delivery_id||'');
 const expected={comparison_id:requestState.comparison.comparison_id,title:comparisonReport.title,...(comparisonReport.delivery_id?{delivery_id:comparisonReport.delivery_id}:{})};
 const task=await queue('comparison-report-prepare',desk('[data-report-prepare]'),'monitoring.report.prepare',expected);
 required(task.result?.id&&task.result.selection?.comparison_id===expected.comparison_id&&task.result.state==='complete','The queued report source belongs to another saved comparison.');
 const native=await reportRead('get',{id:task.result.id,...(comparisonReport.delivery_id?{delivery_id:comparisonReport.delivery_id}:{})});
 required(canonical(retainedReport(native))===canonical(retainedReport(task.result)),'The saved report differs from the completed original operation.');
 const source=await reportSource(native),retained={report_id:native.id,sha256:hash(canonical(retainedReport(native))),source_sha256:hash(canonical(source)),delivery_selection_sha256:hash(canonical(native.delivery_selection))};
 if(requestState.comparison_report)required(canonical(requestState.comparison_report)===canonical(retained),'The original report-source identity changed after resume.');
 else{requestState.comparison_report=retained;await persistRequests();}
 const reopened=await reopenComparisonReport('saved-library'),tickets=reportTicketInventory(reopened);
 await stage('download-complete-comparison-report');
 for(let index=0;index<tickets.length;index++){
  const ticket=tickets[index],links=page.locator(desk('[data-report-downloads] a'));
  const position=await links.evaluateAll((nodes,id)=>nodes.findIndex(node=>new URL(node.href).pathname==='/api/file/'+id),ticket.id);
  required(position>=0,'The report panel omitted an original download member.');
  const filename=basename(ticket.filename).replace(/[^A-Za-z0-9._-]/g,'_')||'source';
  await saveDownload(links.nth(position),'comparison-report-'+String(index+1).padStart(4,'0')+'-'+filename,ticket);
  await writeJournal();
 }
 await record('Downloaded every original comparison report member',{report_id:native.id,file_count:tickets.length,source:native.source});
 await operateScientificReport(reopened);
}

async function main(){
 await mkdir(join(output,'exports'),{recursive:true});
 required(args['url-file'],'Supply the private original operator URL file.');await initializeContinuation();
 privateURL=(await readFile(resolve(args['url-file']),'utf8')).trim();
 const parsed=new URL(privateURL);required(['http:','https:'].includes(parsed.protocol),'Choose the original HTTP/HTTPS operator URL.');
 origin=parsed.origin;capability=new URLSearchParams(parsed.hash.slice(1)).get('token')||'';
 required(capability,'Use the original startup URL containing its capability fragment.');
 await stage('launch-browser');
 browser=await chromium.launch({headless:!args.headed,
  ...(args['browser-channel']?{channel:args['browser-channel']}:{}),
  ...(args['browser-executable']?{executablePath:resolve(args['browser-executable'])}:{}),
  ...(args['browser-renderer-limit']?{args:['--renderer-process-limit='+browserRuntime().renderer_process_limit]}:{})});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(args.video?{recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}}}:{})});
 page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',errors);
 await stage('open-original-workspace');
 await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(selection.workspace_key);await openDesk();
 const state=await apiGet('/api/state',{workspace:selection.workspace_key,compact:'1'});
 required(state.workspace_key===selection.workspace_key&&state.data?.project?.id===selection.project_id,'The selected operator workspace belongs to another original scientific project.');
 baseline=await readSelection();
 if(receiving)required(canonical(baseline.network.source_bindings)===canonical(receiving.summary.original_source_bindings),'The network differs from the original receiving source bindings.');
 const selected=identity(baseline);
 if(requestState.selection)required(canonical(requestState.selection)===canonical(selected),'The original campaign advanced after this browser operation. Continue that retained selection or choose a new output for the new revision.');
 else{requestState.selection=selected;await persistRequests();}
 await stage('open-saved-network');
 const catalog=await monitoring('source.catalog');
 if(opening){
  const nativeSource=opening.selection?.network;
  required(nativeSource?.domain_collection_id&&nativeSource?.domain_source_id,'The opening omits its retained original domain selection.');
  for(const [collectionKey,sourceKey]of [['domain_collection_id','domain_source_id'],['station_collection_id','station_source_id']]){
   if(!nativeSource[sourceKey])continue;
   const collection=nativeSource[collectionKey]||nativeSource.domain_collection_id;
   required(catalog.collections.some(c=>c.id===collection&&c.entries.some(e=>e.id===nativeSource[sourceKey])),'The original vector source is missing from this workspace.');
  }
 }
 required(baseline.network.source_bindings?.domain,'The native network omits its retained original domain binding.');
 for(const [kind,binding]of Object.entries(baseline.network.source_bindings)){
  if(!binding)continue;
  const collection=catalog.collections.find(c=>c.id===binding.source_collection_id);
  const entry=collection?.entries.find(e=>e.id===binding.source_id);
  required(collection&&entry&&collection.id===binding.source_record_id&&entry.sha256===binding.object_sha256,'The original '+kind+' vector source edition differs from the saved network binding.');
 }
 if(args['restored-selection'])await record('Bound the received native scientific selection',{...selected,project_id:selection.project_id,source_bindings:baseline.network.source_bindings});
 await chooseNetwork();
 required(await page.locator(desk('#map path')).count()===Object.keys(baseline.network.nodes).length,'The native network map omitted a retained catchment.');
 await page.locator(desk('#map path')).first().focus();
 await shot('01-original-source-network');
 await record('Opened the actual original source-bound network',{network_id:baseline.network.id,summary:baseline.network.summary,source_bindings:baseline.network.source_bindings,map_selection:await page.locator(desk('#map-selection')).textContent()});
 await stage('open-saved-campaign-calendar');
 await choosePlan();await chooseCampaign();await verifyRendered(baseline);
 await shot('02-saved-campaign-calendar');
 await record('Opened the saved design and complete campaign calendar',{...selected,cost:baseline.plan.cost,coverage:baseline.plan.coverage,visit_count:baseline.campaign.calendar.length,configuration:baseline.plan.configuration});
 await stage('working-draft-and-invalid-input');
 await inspectDraftAndCorrection();
 await stage('open-selected-observed-context');
 const observed=await openObservedContext();
 if(observed){await shot('04-original-observed-support');await record('Opened exact retained observational support',{context_id:observed.id,summary:observed.summary,sha256:requestState.context_sha256});}
 if(comparisonSelection){await operateBudgetComparison();await chooseCampaign();await verifyRendered(baseline);await openObservedContext();}
 if(comparisonReport)await operateComparisonReport();
 await exportCampaign('html');await exportCampaign('bundle');
 const archive=await exportCampaign('workspace');await shot('05-campaign-exports');
 await stage('fresh-browser-reopen');await freshBrowser();
 await stage('receive-native-workspace');await transferWorkspace(archive);
 required(!journal.browser_errors.length,'Browser exception: '+journal.browser_errors.join('; '));
 journal.current_step='complete';journal.status='complete';journal.network_id=selection.network_id;journal.plan_id=selection.plan_id;journal.campaign_id=selection.campaign_id;
 if(comparisonSelection)journal.comparison_id=requestState.comparison.comparison_id;
 if(comparisonReport){journal.comparison_report_id=requestState.comparison_report.report_id;journal.scientific_report_edition_id=requestState.scientific_report.edition_id;}
}
try{await main();}catch(error){
 journal.status='failed';journal.error=redact(error.stack||error.message);process.exitCode=1;
 try{if(page)await shot('failure');}catch{}
}finally{
 if(context)await context.close().catch(()=>{});if(browser)await browser.close().catch(()=>{});
 journal.finished_at=new Date().toISOString();await mkdir(output,{recursive:true});await writeJournal();
 process.stdout.write(JSON.stringify({status:journal.status,output,network_id:journal.network_id||null,
  plan_id:journal.plan_id||null,campaign_id:journal.campaign_id||null,received_workspace_key:journal.received_workspace_key||null,
  error:journal.error?journal.error.split('\n')[0]:null})+'\n');
}
