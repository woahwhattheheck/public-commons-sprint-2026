#!/usr/bin/env node
/**
 * Exercise the maintained Chemistry -> Scientific Reports -> Study transfer UI.
 * This is an original saved-result receiving course; it never starts a solver.
 * See README.md for the accepted host, configuration and visual review.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const SCHEMA='upstate.chemistry-browser-receiving/v1';
const ORIGINAL_RUNS=[
 '59d4b738620b469249bb297fa05626012de72a1cdd4e5135a9f6dc4b7f9c8a53',
 '6742a178dfe5c7dc69ea3c7b9cebfb1477bb3074db98f1c8990c5686569bc58d',
 '2296638a0531acf18d172955d3da5e7845dc71ccaf76189b36b0217565c40a5a',
 '9e2e96abc6dcdbb799c00a106e50fb93c98298ea8c44fccd2282e12ac202a044',
];
const hash=value=>createHash('sha256').update(value).digest('hex');
const now=()=>new Date().toISOString();
const safe=value=>String(value).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,120);
const quote=value=>JSON.stringify(String(value));
const check=(value,message)=>{if(!value)throw Error(message);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const has=name=>process.argv.includes(name);
const usage='node browser.mjs --config selection.json --output /absolute/receiving [--url-file /private/operator-url.txt] [--cdp http://127.0.0.1:9222] [--playwright /absolute/playwright/index.mjs] [--headed]';
if(has('--help')){console.log(usage+'\nnode browser.mjs --from-native ACTUAL_OUTPUT --workspace-key ACTUAL_KEY --write-config NEW_SELECTION.json');process.exit(0);}
if(has('--write-example')){
 const target=path.resolve(option('--write-example','chemistry-receiving.json'));
 await fs.writeFile(target,JSON.stringify({schema:SCHEMA,workspace_key:'REPLACE_WITH_REGISTERED_WORKSPACE_KEY',
   project_id:'b9d5d257-c6bb-4f07-b975-8e8c63705db3',case_id:'ddd984b567d881798f214530ebf0aef4601ab0744df7af7831bcb17e4e302abb',
   runs:ORIGINAL_RUNS.map(run_id=>({run_id})),title:'Upper Savannah Chemistry — authored reference analyses',
   restore_study:true,task_timeout_seconds:1200},null,2)+'\n',{flag:'wx'});
 console.log(target);process.exit(0);
}
if(has('--from-native')){
 const nativeRoot=path.resolve(option('--from-native')),workspaceKey=option('--workspace-key'),destination=option('--write-config');
 check(workspaceKey&&destination,'Use --from-native ACTUAL_OUTPUT --workspace-key ACTUAL_KEY --write-config NEW_SELECTION.json');
 const journalBytes=await fs.readFile(path.join(nativeRoot,'receiving.json'));
 const previewBytes=await fs.readFile(path.join(nativeRoot,'scientific-preview.json'));
 const native=JSON.parse(journalBytes),prepared=JSON.parse(previewBytes),summary=native.steps?.summary,completed=native.steps?.scientific_report;
 check(summary?.complete===true&&completed&&summary.native_runs,'The original native course has no completed summary and scientific report receipt.');
 const editionId=summary.scientific_report_edition_id;
 check(/^[0-9a-f]{64}$/.test(editionId)&&completed.edition_id===editionId&&prepared.id===editionId,'Original native summary, scientific receipt and preview identify different editions.');
 check(summary.project_id===native.request?.project_id&&summary.case_id===native.request?.case_id&&summary.case_id,'Original native project/case receipt is incomplete or mixed.');
 const reportIds=summary.report_ids,sourceIds=summary.source_ids;
 check(Array.isArray(reportIds)&&Array.isArray(sourceIds)&&sourceIds.length>0&&reportIds.length===sourceIds.length&&prepared.sources?.length===sourceIds.length,'Original ordered report/source receipt is incomplete.');
 check(JSON.stringify(reportIds)===JSON.stringify(completed.report_ids)&&JSON.stringify(sourceIds)===JSON.stringify(completed.source_ids),'Original completed source order differs between summary and scientific receipt.');
 const runs=sourceIds.map((sourceId,index)=>{
  const matches=Object.entries(summary.native_runs).filter(([name])=>{
   const original=native.steps['report-'+name];
   return original?.source_id===sourceId&&original.report_id===reportIds[index];
  });
  check(matches.length===1,'Each original ordered report/source must identify exactly one completed native run.');
  return {run_id:matches[0][1],report_id:reportIds[index],source_record_id:sourceId};
 });
 check(new Set(runs.map(row=>row.run_id)).size===runs.length,'Original completed run identities are repeated.');
 const identity=prepared.render_identity;
 check(identity&&identity.title===prepared.title&&identity.contact&&typeof identity.contact==='object'&&!Array.isArray(identity.contact),'Original preview title/contact identity is incomplete.');
 const selected={schema:SCHEMA,workspace_key:workspaceKey,project_id:summary.project_id,case_id:summary.case_id,
  runs,title:identity.title,contact:identity.contact,scientific_report_edition_id:editionId,restore_study:true,task_timeout_seconds:1200,
  native_receiving:{journal_sha256:hash(journalBytes),preview_sha256:hash(previewBytes)}};
 await fs.writeFile(path.resolve(destination),JSON.stringify(selected,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({config:path.resolve(destination),scientific_report_edition_id:editionId,runs:runs.length}));
 process.exit(0);
}
const configPath=option('--config'),outputArg=option('--output');
check(configPath&&outputArg,usage);
const config=JSON.parse(await fs.readFile(configPath,'utf8'));
check(config.schema===SCHEMA,'Use the documented receiving selection schema.');
check(typeof config.workspace_key==='string'&&config.workspace_key&&!config.workspace_key.startsWith('REPLACE'),'Supply the registered original Workspace key.');
check(Array.isArray(config.runs)&&config.runs.length&&new Set(config.runs.map(r=>r.run_id)).size===config.runs.length,'Choose distinct actual completed run IDs.');
for(const row of config.runs)for(const key of ['run_id','report_id','source_record_id'])if(row[key]!==undefined)check(/^[0-9a-f]{64}$/.test(row[key]),'Invalid '+key);
check(config.restore_study===true||config.restore_study===false,'Choose restore_study explicitly.');
if(config.contact!==undefined)check(config.contact&&typeof config.contact==='object'&&!Array.isArray(config.contact)&&Object.values(config.contact).every(value=>typeof value==='string'),'Use the original contact object with string values.');
if(config.scientific_report_edition_id!==undefined){
 check(/^[0-9a-f]{64}$/.test(config.scientific_report_edition_id),'Invalid saved scientific report edition ID.');
 check(typeof config.title==='string'&&config.title.length>0&&config.contact!==undefined,'A saved scientific edition requires its original title and exact contact object, including an original empty object.');
}
const out=path.resolve(outputArg);
await fs.mkdir(out,{recursive:true});
for(const name of ['records','images','downloads','views'])await fs.mkdir(path.join(out,name),{recursive:true});
const journalPath=path.join(out,'receiving.json'),configHash=hash(JSON.stringify(config));
let journal;
try{journal=JSON.parse(await fs.readFile(journalPath,'utf8'));check(journal.selection_sha256===configHash,'This output belongs to a different selection. Reuse its original config.');}
catch(error){if(error.code!=='ENOENT')throw error;journal={schema:SCHEMA,created_at:now(),selection_sha256:configHash,selection:config,state:'starting',actions:{},runs:{},artifacts:[],events:[],visual_review:{state:'awaiting_actual_image_review',findings:[]}};}
let writing=Promise.resolve(),page,context,browser,ownedBrowser=false,ownedContext=false,workspace=config.workspace_key,activeAction=null;
const checkpoint=()=>{const data=JSON.stringify(journal,null,2)+'\n';writing=writing.then(async()=>{await fs.writeFile(journalPath+'.tmp',data);await fs.rename(journalPath+'.tmp',journalPath);});return writing;};
const event=(kind,detail)=>{journal.events.push({at:now(),kind,...detail});return checkpoint();};
const artifact=async(relative,bytes,kind,details={})=>{
 const body=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
 await fs.writeFile(path.join(out,relative),body);
 const row={path:relative,bytes:body.length,sha256:hash(body),kind,...details};
 journal.artifacts=journal.artifacts.filter(item=>item.path!==relative);journal.artifacts.push(row);await checkpoint();return row;
};
const record=(name,value)=>artifact('records/'+safe(name)+'.json',JSON.stringify(value,null,2)+'\n','original_api_response');
const errors=[];
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function retainedRequest(saved){
 check(saved&&typeof saved.workspace==='string'&&typeof saved.action==='string'&&
  typeof saved.operation_id==='string'&&/^[A-Za-z0-9_-]{16,100}$/.test(saved.operation_id)&&
  saved.payload&&typeof saved.payload==='object'&&!Array.isArray(saved.payload),
  'The retained action has no complete original request; preserve its journal and reconcile in Operations.');
 const request={workspace:saved.workspace,action:saved.action,payload:saved.payload,operation_id:saved.operation_id};
 if(saved.request)check(canonical(saved.request)===canonical(request),'The retained original request changed.');
 return request;
}
function verifiedTask(task,saved){
 const request=retainedRequest(saved);
 check(task&&typeof task.id==='string'&&/^[0-9a-f]{64}$/.test(task.id),'The original action returned no valid task ID.');
 check(task.workspace===request.workspace&&task.action===request.action&&canonical(task.payload)===canonical(request.payload),
  'The original task differs from its retained Workspace, action or payload.');
 if(saved.task_id)check(task.id===saved.task_id,'The original task ID changed.');
 // The maintained queue can return an already active identical request with its
 // original operation ID. Keep that actual task; never replace its identity.
 return task;
}
async function retainActionRequest(route){
 const request=route.request(),active=activeAction;
 if(!active||new URL(request.url()).pathname!=='/api/actions'||request.method()!=='POST')return route.continue();
 let body;
 try{body=request.postDataJSON();}catch{return route.continue();}
 if(body?.workspace!==active.workspace||body?.action!==active.expectedAction)return route.continue();
 try{
  check(new URL(request.url()).origin===new URL(page.url()).origin,'The original action left the operator origin.');
  await assertWorkspace(active.workspace);
  const candidate={workspace:body.workspace,action:body.action,payload:body.payload,operation_id:body.operation_id};
  retainedRequest(candidate);
  const previous=journal.actions[active.label];
  if(previous)check(canonical(retainedRequest(previous))===canonical(candidate),'The action changed during original request admission.');
  else journal.actions[active.label]={...candidate,request:candidate,submitted_at:now(),task_id:null};
  await checkpoint();
  check(activeAction===active&&workspace===active.workspace,'The browser action was detached before dispatch.');
  await assertWorkspace(active.workspace);
  await route.continue();
 }catch(error){
  active.admission_error=error;
  active.rejectAdmission?.(error);
  await route.abort('aborted');
 }
}
function redact(text){return String(text).replace(/([?&#](?:token|capability|access_token)=)[^&#\s"']+/gi,'$1[redacted]').replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g,'Bearer [redacted]');}
async function assertWorkspace(expected=workspace){
 check(await page.locator('#workspace-select').inputValue()===expected,'The browser moved to a different Workspace.');
}
async function api(route,query={}){
 check(route.startsWith('/api/'),'Only original same-origin API reads are allowed.');
 return page.evaluate(async({route,query,workspace})=>{
  const token=sessionStorage.getItem('upstate-operator-capability');
  if(!token)throw Error('The operator session is not authenticated.');
  const url=new URL(route,location.origin);for(const [key,value] of Object.entries({workspace,...query}))url.searchParams.set(key,String(value));
  const response=await fetch(url,{headers:{Authorization:'Bearer '+token,'X-Workspace':workspace},credentials:'same-origin'});
  const body=await response.json();if(!response.ok)throw Error(body.error?.message||'Original API HTTP '+response.status);return body;
 },{route,query,workspace});
}
async function closeDialogs(){
 for(const selector of ['#detail-dialog[open] [data-action="detail-close"]','#form-dialog[open] [data-action="form-close"]']){
  const button=page.locator(selector);if(await button.count())await button.click();
 }
 if(await page.locator('#task-panel').isVisible())await page.locator('[data-action="tasks-close"]').click();
}
async function chooseWorkspace(key){
 await closeDialogs();
 await page.waitForFunction(value=>[...document.querySelectorAll('#workspace-select option')].some(x=>x.value===value&&!x.disabled),key);
 await page.locator('#workspace-select').selectOption(key);
 await page.waitForFunction(value=>document.querySelector('#workspace-select')?.value===value,key);
 workspace=key;
 const state=await api('/api/state',{compact:1});check(state.workspace_key===key,'The selected Workspace state is different.');
 await record('workspace-'+safe(key),state);return state;
}
async function navigate(view){
 await closeDialogs();await assertWorkspace();
 await page.locator('[data-view='+quote(view)+']').click();
}
async function readAfter(route,query,trigger){
 const response=page.waitForResponse(value=>{
  const u=new URL(value.url());return u.pathname===route&&Object.entries(query).every(([k,v])=>u.searchParams.get(k)===String(v))&&value.request().method()==='GET';
 });
 await trigger();const actual=await response;check(actual.ok(),route+' returned HTTP '+actual.status());return actual.json();
}
async function recoverOriginalTask(saved,label){
 await assertWorkspace();
 const request=retainedRequest(saved);
 check(request.workspace===workspace,'The saved request belongs to another selected Workspace.');
 // Older queues could deduplicate an active request without retaining an
 // operation alias. Current queues persist that alias before acknowledging.
 // Reconcile older hosts from complete history without adopting past work.
 const history=await api('/api/state');
 check(history.workspace_key===workspace&&Array.isArray(history.tasks),'Complete original task history is unavailable.');
 const scoped=history.tasks.filter(task=>task.workspace===workspace&&task.action===request.action);
 check(scoped.every(task=>task.payload&&typeof task.payload==='object'&&!Array.isArray(task.payload)),
  'Original task history omitted request payloads; preserve this journal and reopen Operations.');
 const exact=scoped.filter(task=>task.operation_id===request.operation_id);
 let candidates=exact;
 if(!exact.length){
  const matching=scoped.filter(task=>canonical(task.payload)===canonical(request.payload));
  const timestamp=value=>typeof value==='string'&&value.trim()?Date.parse(value):NaN;
  const submitted=timestamp(saved.submitted_at);
  const ambiguous=[];
  candidates=matching.filter(task=>{
   const created=timestamp(task.created_at),ended=timestamp(task.ended_at);
   const stopped=['complete','failed','interrupted','cancelled'].includes(task.state);
   const active=['queued','running'].includes(task.state);
   // A completed attempt predating admission cannot be the task this request
   // reused. Even one otherwise identical historical result is ineligible.
   if(stopped&&Number.isFinite(submitted)&&Number.isFinite(ended)&&ended<submitted)return false;
   const valid=Number.isFinite(submitted)&&Number.isFinite(created)&&
    ((stopped&&Number.isFinite(ended)&&ended>=created)||
     (active&&(task.ended_at===null||task.ended_at===undefined||task.ended_at==='')));
   if(!valid){ambiguous.push(task.id);return false;}
   return true;
  });
  check(!ambiguous.length,'Original task timing cannot establish request admission for '+ambiguous.join(', ')+
   '. Reconcile the original task ID in Operations; preserve this journal and its submitted_at.');
 }
 check(candidates.length<=1,'More than one retained task matches the unacknowledged request. Reconcile its original task ID in Operations; preserve this journal.');
 if(candidates.length){
  const task=verifiedTask(await api('/api/task',{id:candidates[0].id}),saved);
  saved.task_id=task.id;await checkpoint();await record('task-'+task.id,task);
  await event('original_action_reconciled',{label,task_id:task.id,operation_id:request.operation_id,state:task.state});
  return completedTask(task.id,label,saved);
 }
 // No retained task matches: admit the original complete request under its
 // unchanged operation ID. Stopped tasks were handled above, never resumed.
 await assertWorkspace();
 const response=await page.evaluate(async request=>{
  const token=sessionStorage.getItem('upstate-operator-capability');
  if(!token)throw Error('The operator session is not authenticated.');
  const result=await fetch('/api/actions',{method:'POST',credentials:'same-origin',
   headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','X-Workspace':request.workspace},
   body:JSON.stringify(request)});
  return {status:result.status,ok:result.ok,body:await result.json()};
 },request);
 check(response.ok,response.body?.error?.message||'Original request recovery failed: HTTP '+response.status);
 const task=verifiedTask(response.body.task||response.body,saved);
 saved.task_id=task.id;await checkpoint();await record('task-'+task.id,task);
 await event('original_action_recovered',{label,task_id:task.id,operation_id:request.operation_id,state:task.state});
 return completedTask(task.id,label,saved);
}
async function completedTask(id,label,saved){
 const deadline=Date.now()+1000*(config.task_timeout_seconds||1200);
 while(Date.now()<deadline){
  await assertWorkspace();const task=await api('/api/task',{id});
  check(task.id===id&&task.workspace===workspace,'Task identity or Workspace changed.');
  if(saved)verifiedTask(task,saved);
  if(task.state==='complete'){await record('task-'+id,task);return task;}
  if(['failed','interrupted','cancelled'].includes(task.state)){await record('task-'+id,task);throw Error(label+' ended '+task.state+': '+(task.error?.message||'inspect retained task'));}
  await pause(1800);
 }
 throw Error(label+' remains in its original queue. Restart with the same output to continue observing that task.');
}
async function action(label,expectedAction,trigger){
 await assertWorkspace();
 let saved=journal.actions[label];
 if(saved){
  check(saved.workspace===workspace&&saved.action===expectedAction,'The retained action belongs to another selection.');
  retainedRequest(saved);
  if(!saved.task_id)return recoverOriginalTask(saved,label);
  return completedTask(saved.task_id,label,saved);
 }
 const active=activeAction={label,expectedAction,workspace};
 const admissionFailure=new Promise((_,reject)=>{active.rejectAdmission=reject;});
 admissionFailure.catch(()=>{});
 const response=page.waitForResponse(r=>{
  if(new URL(r.url()).pathname!=='/api/actions'||r.request().method()!=='POST')return false;
  try{const b=r.request().postDataJSON();return b.workspace===workspace&&b.action===expectedAction;}catch{return false;}
 },{timeout:60000});
 response.catch(()=>{});
 try{
  await Promise.race([Promise.resolve().then(trigger),admissionFailure]);
  const r=await Promise.race([response,admissionFailure]);await writing;
  const body=await r.json();check(r.ok(),body.error?.message||'Original queued request failed: HTTP '+r.status());
  saved=journal.actions[label];check(saved?.operation_id,'The original request was not journaled.');
  const task=verifiedTask(body.task||body,saved);
  saved.task_id=task.id;await checkpoint();
  await artifact('images/'+safe(label)+'-queued.png',await page.screenshot({fullPage:true}),'queued_action_screenshot',{workspace,task_id:task.id});
  return completedTask(task.id,label,saved);
 }finally{activeAction=null;response.catch(()=>{});}
}
async function chemistry(){
 await navigate('chemistry');
 await page.locator('.chemistry-panel').waitFor();
 const response=await readAfter('/api/chemistry/catalog',{},()=>page.locator('[data-action="chemistry-refresh"]').click());
 check(response.workspace_key===undefined||response.workspace_key===workspace,'Chemistry catalogue Workspace mismatch.');
 return response;
}
async function openChemistry(kind,id){
 await closeDialogs();
 const route=kind==='run'?'/api/chemistry/run':kind==='report'?'/api/chemistry/report':'/api/chemistry/report-source';
 const key=kind==='run'?'run_id':kind==='report'?'report_id':'source_record_id';
 const selector='[data-action="chemistry-'+kind+'-open"][data-id='+quote(id)+']';
 const button=page.locator(selector).first();
 await button.waitFor();
 const value=await readAfter(route,{[key]:id},()=>button.click());
 check(value.id===id,'Opened Chemistry record differs from the selected '+kind+'.');
 if(value.workspace_key!==undefined)check(value.workspace_key===workspace,'Opened Chemistry record belongs to another Workspace.');
 await page.locator('[data-chemistry-result]').waitFor({state:'visible'});
 await record(kind+'-'+id,value);return value;
}
async function capture(name,frameSelector=null){
 await assertWorkspace();
 for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  await page.evaluate(()=>document.fonts?.ready);
  await pause(120);
  const stem=safe(name)+'-'+viewport.width;
  const root=page.locator('#content');
  await root.scrollIntoViewIfNeeded();
  const png=await page.screenshot({fullPage:true});
  await artifact('images/'+stem+'.png',png,'screenshot',{workspace,viewport,view:name});
  const layout=await page.evaluate(()=>({viewport:innerWidth,document_width:document.documentElement.scrollWidth,
   headings:[...document.querySelectorAll('#content h1,#content h2,#content h3')].map(x=>x.textContent),
   alerts:[...document.querySelectorAll('#content [role=alert],#global-error:not([hidden])')].filter(x=>x.offsetParent!==null).map(x=>x.textContent),
   horizontal_scrollers:[...document.querySelectorAll('#content .table-scroll,#content .chemistry-table')].filter(x=>x.scrollWidth>x.clientWidth).map(x=>({width:x.clientWidth,content:x.scrollWidth}))}));
  await record(stem+'-layout',layout);
  if(frameSelector){
   const handle=await page.locator(frameSelector).elementHandle(),frame=await handle?.contentFrame();
   check(frame,'The original report iframe did not load.');
   await frame.locator('body').waitFor();await frame.waitForFunction(()=>document.body?.innerText?.trim().length>80);await frame.evaluate(()=>document.fonts?.ready);
   const text=await frame.locator('body').innerText();check(text.trim().length>80,'The saved report iframe is empty.');
   if(viewport.width===1440)await artifact('views/'+safe(name)+'.html',await frame.content(),'rendered_report_html',{workspace});
   const headings=frame.locator('h2');
   const count=await headings.count();
   await frame.evaluate(()=>scrollTo(0,0));
   await artifact('images/'+stem+'-report-top.png',await page.locator(frameSelector).screenshot(),'report_screenshot',{workspace,viewport});
   for(let i=0;i<count;i++){
    const heading=headings.nth(i);await heading.scrollIntoViewIfNeeded();
    await artifact('images/'+stem+'-section-'+String(i+1).padStart(2,'0')+'.png',await page.locator(frameSelector).screenshot(),'report_section_screenshot',{workspace,viewport,heading:await heading.innerText()});
   }
   await frame.evaluate(()=>scrollTo(0,0));
  }
 }
 await page.setViewportSize({width:1440,height:1000});
}
async function download(descriptor,container,label){
 check(descriptor?.url&&descriptor.sha256&&Number.isInteger(descriptor.bytes),'Use a retained download descriptor with bytes and SHA256.');
 const requested=new URL(descriptor.url,page.url());check(requested.origin===new URL(page.url()).origin,'The retained download is outside the original operator.');
 const links=container.locator('a[href]');let selected;
 for(let i=0;i<await links.count();i++){
  const item=links.nth(i),href=await item.getAttribute('href');
  if(new URL(href,page.url()).pathname===requested.pathname){selected=item;break;}
 }
 check(selected,'The original download control is absent: '+(descriptor.filename||label));
 const pending=page.waitForEvent('download',{timeout:60000});await selected.click();
 const actual=await pending;const failure=await actual.failure();check(!failure,'Download failed: '+failure);
 const filename=safe(label)+'-'+safe(descriptor.filename||actual.suggestedFilename()||'download');
 const dest=path.join(out,'downloads',filename);await actual.saveAs(dest);
 const body=await fs.readFile(dest);
 check(body.length===descriptor.bytes&&hash(body)===descriptor.sha256,'Downloaded bytes differ from the retained descriptor: '+filename);
 if(filename.toLowerCase().endsWith('.pdf'))check(body.subarray(0,5).toString()==='%PDF-','Downloaded PDF has no PDF header.');
 if(filename.toLowerCase().endsWith('.zip'))check(body.subarray(0,2).toString()==='PK','Downloaded ZIP has no ZIP header.');
 const row={path:'downloads/'+filename,bytes:body.length,sha256:hash(body),kind:'download',workspace,original_filename:descriptor.filename};
 journal.artifacts=journal.artifacts.filter(x=>x.path!==row.path);journal.artifacts.push(row);await checkpoint();return row;
}
async function downloadReportFiles(value,label,container){
 const files=value.edition?value.files:(value._downloads||[]);
 const chosen=files.filter(f=>/\.(html?|pdf|zip)$/i.test(f.filename||f.path||''));
 check(chosen.length,'The report returned no HTML, PDF or ZIP download controls.');
 const result=[];
 for(let i=0;i<chosen.length;i++)result.push(await download({...chosen[i],filename:chosen[i].filename||path.basename(chosen[i].path)},container,label+'-'+i));
 return result;
}
const sourceKey=value=>JSON.stringify([value.source_collection_id,value.source_id,value.layer||null,value.where||null]);
const exactContact=value=>JSON.stringify(Object.keys(value).sort().map(key=>[key,value[key]]));
function verifyScientificEdition(value,id,sources){
 const edition=value.edition,identity=edition?.render_identity;
 check(value.workspace_key===workspace&&edition?.id===id&&edition.state==='complete','Saved scientific report identity, Workspace or completion state differs.');
 if(config.project_id)check(edition.project_id===config.project_id,'Saved scientific report belongs to a different original project.');
 check(Array.isArray(edition.sources)&&JSON.stringify(edition.sources.map(sourceKey))===JSON.stringify(sources.map(sourceKey)),'Saved scientific report has different original sources or ordering.');
 if(config.scientific_report_edition_id){
  check(identity&&edition.title===config.title&&identity.title===config.title,'Saved scientific report title differs from the original selection.');
  check(identity.contact&&exactContact(identity.contact)===exactContact(config.contact),'Saved scientific report contact differs from the original exact contact object.');
 }
 return value;
}
async function openScientific(id){
 await closeDialogs();
 const value=await readAfter('/api/source-reports/scientific-edition',{id},()=>page.locator('[data-scientific-report-action="open"][data-id='+quote(id)+']').first().click());
 check(value.workspace_key===workspace&&value.edition?.id===id&&value.edition.state==='complete','Scientific report identity/state mismatch.');
 await page.locator('[data-scientific-report-detail] iframe').waitFor();await record('scientific-'+id,value);return value;
}
async function taskDialog(task){
 await closeDialogs();
 const refreshed=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/state'&&r.request().method()==='GET');
 await page.locator('header.topbar [data-action="refresh"]').click();await refreshed;
 if(!await page.locator('#task-panel').isVisible())await page.locator('header.topbar [data-action="tasks"]').click();
 const button=page.locator('[data-action="task-open"][data-id='+quote(task.id)+']');
 await button.waitFor();await button.click();
 await page.locator('#detail-dialog[open]').waitFor();
}

async function completedControl(task,kind,id){
 await taskDialog(task);
 const selector='#detail-dialog[open] [data-action="chemistry-'+kind+'-open"][data-id='+quote(id)+']';
 const button=page.locator(selector);await button.waitFor();
 check(await button.getAttribute('data-workspace')===workspace,'Completed-task button identifies another Workspace.');
 const route=kind==='report'?'/api/chemistry/report':'/api/chemistry/report-source';
 const key=kind==='report'?'report_id':'source_record_id';
 const actual=await readAfter(route,{[key]:id},()=>button.click());
 check(actual.id===id&&actual.workspace_key===workspace,'Completed task did not reopen its retained result.');
 await closeDialogs();await page.locator('[data-chemistry-result]').waitFor({state:'visible'});
 await event('completed_task_control',{task_id:task.id,kind,id,workspace});
}

async function configureBrowser(){
 const moduleName=option('--playwright',process.env.PLAYWRIGHT_MODULE||'playwright');
 const pw=await import(path.isAbsolute(moduleName)?pathToFileURL(moduleName).href:moduleName);
 const chromium=pw.chromium||pw.default?.chromium;check(chromium,'The supplied Playwright module has no Chromium driver.');
 const cdp=option('--cdp',process.env.CHEMISTRY_RECEIVING_CDP);
 if(cdp){browser=await chromium.connectOverCDP(cdp);context=browser.contexts()[0];check(context,'The existing browser has no context.');}
 else{
  browser=await chromium.launch({headless:!has('--headed'),...(process.env.CHROMIUM_EXECUTABLE?{executablePath:process.env.CHROMIUM_EXECUTABLE}:{})});
  ownedBrowser=true;context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});ownedContext=true;
 }
 page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',error=>{errors.push({at:now(),message:redact(error.message)});});
 await page.route('**/api/actions',retainActionRequest);
 let url=process.env.CHEMISTRY_OPERATOR_URL;
 if(option('--url-file'))url=(await fs.readFile(option('--url-file'),'utf8')).trim();
 check(url,'Provide CHEMISTRY_OPERATOR_URL or a private --url-file containing the existing authenticated operator URL.');
 const parsed=new URL(url);check(['http:','https:'].includes(parsed.protocol),'Use an HTTP(S) operator URL.');
 journal.operator_origin=parsed.origin;await checkpoint();
 await page.goto(url,{waitUntil:'domcontentloaded'});
 await page.locator('#workspace-select').waitFor();
 await chooseWorkspace(config.workspace_key);
 await navigate('chemistry');
 await capture('original-chemistry-catalogue');
}
async function course(){
 await configureBrowser();journal.state='running';await checkpoint();
 const sources=[];
 for(let index=0;index<config.runs.length;index++){
  const chosen=config.runs[index],label=String(index+1).padStart(2,'0')+'-'+chosen.run_id.slice(0,10);
  const retained=journal.runs[chosen.run_id]||={run_id:chosen.run_id};
  await chemistry();const run=await openChemistry('run',chosen.run_id);
  check(run.state==='complete','The selected run is not complete; this course does not run a model.');
  if(config.case_id)check(run.case_id===config.case_id,'The selected analysis belongs to another original case.');
  retained.mode=run.mode;
  if(['calibrate','uncertainty','monitoring'].includes(run.mode)){
   const field=run.mode==='calibrate'?'observations':run.mode==='uncertainty'?'summaries':'selected';
   const loaded=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chemistry/page'&&new URL(r.url()).searchParams.get('run_id')===chosen.run_id&&new URL(r.url()).searchParams.get('field')===field);
   await page.locator('[data-result-field]').selectOption(field);const resultResponse=await loaded;
   check(resultResponse.ok(),'The original result table could not be opened.');
  }
  await capture(label+'-analysis');
  retained.report_id=chosen.report_id||retained.report_id;
  if(!retained.report_id){
   const task=await action('report-'+chosen.run_id,'chemistry.report.prepare',()=>page.locator('[data-action="chemistry-report-prepare"][data-id='+quote(chosen.run_id)+']').click());
   retained.report_id=task.result?.id;check(retained.report_id,'Report preparation has no retained result ID.');await checkpoint();
   await completedControl(task,'report',retained.report_id);
  }
  await chemistry();const report=await openChemistry('report',retained.report_id);
  check(report.run_id===chosen.run_id,'Saved report refers to a different native result.');
  if(config.project_id)check(report.selection?.workspace_id===config.project_id,'Saved report belongs to a different scientific project.');
  await capture(label+'-saved-report','[data-chemistry-report-frame]');
  await downloadReportFiles(report,label+'-report',page.locator('[data-chemistry-result]'));
  retained.source_record_id=chosen.source_record_id||retained.source_record_id;
  if(!retained.source_record_id){
   const task=await action('source-'+retained.report_id,'chemistry.report.source.prepare',()=>page.locator('[data-action="chemistry-source-prepare"][data-id='+quote(retained.report_id)+']').click());
   retained.source_record_id=task.result?.id;check(retained.source_record_id,'Source preparation has no retained result ID.');await checkpoint();
   await completedControl(task,'source',retained.source_record_id);
  }
  await chemistry();const source=await openChemistry('source',retained.source_record_id);
  check(source.report_id===retained.report_id&&source.run_id===chosen.run_id,'Typed source differs from the original report/run.');
  check(source.scientific_report_selection?.sources?.length===1,'Typed source has no exact original composer selection.');
  retained.source_selection=source.scientific_report_selection.sources[0];sources.push(retained.source_selection);
  await capture(label+'-source');
  // Use the real explicit replace/append callers. The current composer retains
  // the ordered draft while the Chemistry panel is revisited for the next source.
  const mode=index===0?'compose':'append';
  await page.locator('[data-action="chemistry-source-'+mode+'"][data-id='+quote(retained.source_record_id)+']').first().click();
  await page.locator('.scientific-report-editions').waitFor();
  await page.waitForFunction(count=>document.querySelectorAll('.scientific-report-order > li').length===count,index+1);
  retained.completed_at=now();await checkpoint();
 }
 await page.locator('[data-scientific-report-field="title"]').fill(config.title||'Retained Chemistry analyses');
 if(config.contact!==undefined)for(const key of ['name','organization','email']){
  await page.locator('[data-scientific-report-field='+quote(key)+']').fill(config.contact[key]??'');
 }
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/source-reports/scientific-preview'&&r.request().method()==='POST');
 await page.locator('[data-scientific-report-action="preview"]').click();const previewResponse=await response;
 check(previewResponse.ok(),'The original scientific report preview failed.');
 const preview=await previewResponse.json();
 check(preview.workspace_key===workspace&&JSON.stringify(preview.sources.map(sourceKey))===JSON.stringify(sources.map(sourceKey)),'The composer changed the original source order or source identities.');
 await record('scientific-preview',preview);await capture('combined-scientific-preview');
 const scientificId=config.scientific_report_edition_id||preview.id;
 journal.composer_preview_id=preview.id;
 journal.scientific_report_id=scientificId;await checkpoint();
 let scientific;
 if(config.scientific_report_edition_id){
  // Exercise the current composer, then reopen the retained edition through
  // its actual visible control. Historical contact/producer identities stay exact.
  await page.locator('[data-scientific-report-action="refresh"]').click();
  scientific=verifyScientificEdition(await openScientific(scientificId),scientificId,sources);
  await event('retained_scientific_edition',{edition_id:scientificId,composer_preview_id:preview.id,original_contact:scientific.edition.render_identity.contact});
 }else{
  if(preview.existing){
   await readAfter('/api/source-reports/scientific-edition',{id:scientificId},()=>page.locator('[data-scientific-report-action="render"]').click());
  }else{
   await action('scientific-'+scientificId,'source-reports.render',()=>page.locator('[data-scientific-report-action="render"]').click());
   await closeDialogs();await page.locator('[data-scientific-report-action="refresh"]').click();
   await openScientific(scientificId);
  }
  scientific=verifyScientificEdition(await api('/api/source-reports/scientific-edition',{id:scientificId}),scientificId,sources);
 }
 await capture('combined-scientific-report','[data-scientific-report-detail] iframe');
 await downloadReportFiles(scientific,'scientific',page.locator('[data-scientific-report-detail]'));
 if(!scientific.archive){
  await action('scientific-archive-'+scientificId,'source-reports.export',()=>page.locator('[data-scientific-report-action="export"]').click());
  await closeDialogs();await page.locator('[data-scientific-report-action="refresh"]').click();
  scientific=verifyScientificEdition(await openScientific(scientificId),scientificId,sources);
 }
 check(scientific.archive,'The scientific report has no completed retained archive.');
 journal.scientific_archive=await download({...scientific.archive,filename:scientific.archive.filename||'scientific-report.zip'},page.locator('[data-scientific-report-detail]'),'scientific-complete');
 await navigate('study-transfer');
 await page.locator('[data-study-action="clear-all"]').waitFor();
 if(await page.locator('[data-study-action="clear-all"]').isEnabled())await page.locator('[data-study-action="clear-all"]').click();
 await navigate('sources');await page.locator('[data-scientific-report-action="refresh"]').click();await openScientific(scientificId);
 await page.locator('[data-scientific-report-action="transfer"]').click();
 await page.locator('[data-study-action="preview"]').waitFor();
 const studyPreview=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/study-transfer/preview'&&r.request().method()==='POST');
 await page.locator('[data-study-action="preview"]').click();const sp=await studyPreview;check(sp.ok(),'Original Study preview failed.');
 const study=await sp.json();
 const selectedRootKeys=await page.locator('[data-study-root]:checked').evaluateAll(items=>items.map(x=>x.dataset.studyRoot));
 check(selectedRootKeys.length===1&&selectedRootKeys[0].includes(scientificId),'The Study desk contains an extra or different selected root.');
 await record('study-preview',study);await capture('selected-study-preview');
 const exported=await action('study-'+scientificId,'study.export',()=>page.locator('[data-study-action="export"]').click());
 journal.study_task_id=exported.id;await checkpoint();
 await closeDialogs();await page.locator('[data-study-action="refresh-exports"]').click();
 const file=exported._downloads?.find(f=>/\.zip$/i.test(f.filename||''));
 check(file,'The completed Study task has no original ZIP descriptor.');
 journal.study_archive=await download(file,page.locator('[data-study-exports]'),'selected-study');
 await capture('selected-study-export');
 if(config.restore_study){
  const restore=await action('study-restore-'+scientificId,'workspace.restore',async()=>{
   await page.locator('[data-action="restore"]').click();
   await page.locator('#form-dialog[open] input[name="restore_file"]').setInputFiles(path.join(out,journal.study_archive.path));
   await page.locator('#form-submit').click();
  });
  check(restore.result?.workspace_key,'The original restore did not return a registered receiving Workspace.');
  journal.received_workspace_key=restore.result.workspace_key;await checkpoint();
  await chooseWorkspace(journal.received_workspace_key);
  await chemistry();
  for(const row of Object.values(journal.runs)){
   const report=await openChemistry('report',row.report_id);check(report.run_id===row.run_id,'The restored report refers to another original run.');
   await capture('restored-'+row.mode+'-report','[data-chemistry-report-frame]');
   const source=await openChemistry('source',row.source_record_id);check(source.run_id===row.run_id,'The restored typed source lost its original run.');
  }
  await navigate('sources');await page.locator('[data-scientific-report-action="refresh"]').click();
  verifyScientificEdition(await openScientific(journal.scientific_report_id),journal.scientific_report_id,sources);
  await capture('restored-scientific-report','[data-scientific-report-detail] iframe');
 }
 journal.state='browser_course_complete';journal.completed_at=now();delete journal.error;
 journal.visual_review.state='awaiting_actual_image_review';
 await checkpoint();
}
try{
 await course();
}catch(error){
 journal.state='interrupted';journal.error={at:now(),message:redact(error.message),stack:redact(error.stack||'')};
 if(page){try{await artifact('images/actual-error.png',await page.screenshot({fullPage:true}),'error_screenshot',{workspace});await artifact('views/actual-error.html',await page.content(),'actual_error_dom');}catch{}}
 await checkpoint();process.exitCode=1;
}finally{
 journal.browser_errors=errors;await checkpoint();
 const index=['# Chemistry browser receiving','',journal.state,'',
  'Open the actual screenshots and downloaded reports. Record the inspected images, findings and repaired source edition in visual-review.json. The automated course does not set visual approval.','',
  ...journal.artifacts.filter(x=>x.kind.includes('screenshot')).map(x=>'- ['+x.path+']('+x.path+')'),
  '', 'Original selection, queued operation IDs, saved result IDs and downloaded SHA256 values are retained in receiving.json.'].join('\n')+'\n';
 await fs.writeFile(path.join(out,'REVIEW.md'),index);
 if(ownedContext)await context?.close();else await page?.close();
 if(browser)await browser.close(); // CDP connections disconnect; launched browsers close.
 console.log(JSON.stringify({state:journal.state,output:out,workspace_key:config.workspace_key,received_workspace_key:journal.received_workspace_key,scientific_report_id:journal.scientific_report_id,task_ids:Object.values(journal.actions).map(x=>x.task_id).filter(Boolean),error:journal.error?.message},null,2));
}
