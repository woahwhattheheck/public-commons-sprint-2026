#!/usr/bin/env node
/** Operate an actual retained Monitoring campaign through the original operator. */
import { chromium } from 'playwright';
import { mkdir, readFile, open, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join, relative, basename } from 'node:path';
import { parseArgs } from 'node:util';

const {values:args}=parseArgs({options:{
 'url-file':{type:'string'},opening:{type:'string'},receiving:{type:'string'},workspace:{type:'string'},
 'context-id':{type:'string'},output:{type:'string'},
 resume:{type:'boolean',default:false},video:{type:'boolean',default:false},
 headed:{type:'boolean',default:false},'browser-channel':{type:'string'},'browser-executable':{type:'string'},
 'task-timeout-seconds':{type:'string',default:'3600'},help:{type:'boolean',default:false}
}});
if(args.help){
 console.log('node source/run_monitoring_browser.mjs --url-file PRIVATE_URL_FILE --opening MONITORING_OPENING.json --receiving RECEIVING.json --output DIRECTORY [--context-id SAVED_CONTEXT] [--video] [--headed] [--browser-channel NAME | --browser-executable PATH] [--resume]');
 process.exit(0);
}
const output=resolve(args.output||join('artifacts','monitoring-browser',new Date().toISOString().replace(/[:.]/g,'-')));
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&!Array.isArray(item)&&typeof item==='object'?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const required=(value,message)=>{if(!value)throw Error(message);};
const stopped=new Set(['failed','interrupted','cancelled']);
let browser,context,page,privateURL='',origin='',capability='',currentWorkspace='';
let opening,receiving,requestState,selection,baseline,journalWritable=false;
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
async function record(name,details={}){
 journal.steps.push({name,completed_at:new Date().toISOString(),...details});await writeJournal();
}
async function shot(name){
 const path=join(output,name+'.png');await page.screenshot({path,fullPage:true,animations:'disabled'});
 const bytes=await readFile(path);journal.screenshots.push({path:relative(output,path),bytes:bytes.length,sha256:hash(bytes)});
}
function browserRuntime(){
 required(!(args['browser-channel']&&args['browser-executable']),'Choose a browser channel or an explicit executable path.');
 return{kind:args['browser-executable']?'executable':args['browser-channel']?'channel':'bundled',
  executable_path:args['browser-executable']?resolve(args['browser-executable']):null,
  channel:args['browser-channel']||null,headless:!args.headed};
}
async function initializeContinuation(){
 browserRuntime();
 required(args.opening&&args.receiving,'Supply the actual preparation opening and completed original receiving journal.');
 required(!args.resume||args.output,'Resume with the original explicit --output directory.');
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
 const input={opening_sha256:hash(openingBytes),receiving_sha256:hash(receivingBytes),...selection};
 const retained=await readOptional(join(output,'request-state.json')),previous=await readOptional(join(output,'journey.json'));
 if(args.resume){
  required(retained,'This output has no original durable Monitoring request state.');
  requestState=JSON.parse(retained);
  required(requestState.schema==='upstate.monitoring-browser-requests/v1'&&canonical(requestState.input)===canonical(input),'Resume with the original opening, receiving journal and selected context, or choose a new output directory.');
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
 await record('Reopened the original campaign after independent workspace receiving',{workspace_key:currentWorkspace,archive_sha256:archive.sha256,...identity(value)});
 journal.received_workspace_key=currentWorkspace;
}
async function main(){
 await mkdir(join(output,'exports'),{recursive:true});
 required(args['url-file'],'Supply the private original operator URL file.');await initializeContinuation();
 privateURL=(await readFile(resolve(args['url-file']),'utf8')).trim();
 const parsed=new URL(privateURL);required(['http:','https:'].includes(parsed.protocol),'Choose the original HTTP/HTTPS operator URL.');
 origin=parsed.origin;capability=new URLSearchParams(parsed.hash.slice(1)).get('token')||'';
 required(capability,'Use the original startup URL containing its capability fragment.');
 browser=await chromium.launch({headless:!args.headed,
  ...(args['browser-channel']?{channel:args['browser-channel']}:{}),
  ...(args['browser-executable']?{executablePath:resolve(args['browser-executable'])}:{})});
 context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true,...(args.video?{recordVideo:{dir:join(output,'video'),size:{width:1440,height:1000}}}:{})});
 page=await context.newPage();page.setDefaultTimeout(60000);page.on('pageerror',errors);
 await page.goto(privateURL,{waitUntil:'domcontentloaded'});await openWorkspace(selection.workspace_key);await openDesk();
 baseline=await readSelection();
 required(canonical(baseline.network.source_bindings)===canonical(receiving.summary.original_source_bindings),'The network differs from the original receiving source bindings.');
 const selected=identity(baseline);
 if(requestState.selection)required(canonical(requestState.selection)===canonical(selected),'The original campaign advanced after this browser operation. Continue that retained selection or choose a new output for the new revision.');
 else{requestState.selection=selected;await persistRequests();}
 const nativeSource=opening.selection?.network;
 required(nativeSource?.domain_collection_id&&nativeSource?.domain_source_id,'The opening omits its retained original domain selection.');
 const catalog=await monitoring('source.catalog');
 for(const [collectionKey,sourceKey]of [['domain_collection_id','domain_source_id'],['station_collection_id','station_source_id']]){
  if(!nativeSource[sourceKey])continue;
  const collection=nativeSource[collectionKey]||nativeSource.domain_collection_id;
  required(catalog.collections.some(c=>c.id===collection&&c.entries.some(e=>e.id===nativeSource[sourceKey])),'The original vector source is missing from this workspace.');
 }
 await chooseNetwork();
 required(await page.locator(desk('#map path')).count()===Object.keys(baseline.network.nodes).length,'The native network map omitted a retained catchment.');
 await page.locator(desk('#map path')).first().focus();
 await shot('01-original-source-network');
 await record('Opened the actual original source-bound network',{network_id:baseline.network.id,summary:baseline.network.summary,source_bindings:baseline.network.source_bindings,map_selection:await page.locator(desk('#map-selection')).textContent()});
 await choosePlan();await chooseCampaign();await verifyRendered(baseline);
 await shot('02-saved-campaign-calendar');
 await record('Opened the saved design and complete campaign calendar',{...selected,cost:baseline.plan.cost,coverage:baseline.plan.coverage,visit_count:baseline.campaign.calendar.length,configuration:baseline.plan.configuration});
 await inspectDraftAndCorrection();
 const observed=await openObservedContext();
 if(observed){await shot('04-original-observed-support');await record('Opened exact retained observational support',{context_id:observed.id,summary:observed.summary,sha256:requestState.context_sha256});}
 await exportCampaign('html');await exportCampaign('bundle');
 const archive=await exportCampaign('workspace');await shot('05-campaign-exports');
 await freshBrowser();await transferWorkspace(archive);
 required(!journal.browser_errors.length,'Browser exception: '+journal.browser_errors.join('; '));
 journal.status='complete';journal.network_id=selection.network_id;journal.plan_id=selection.plan_id;journal.campaign_id=selection.campaign_id;
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
