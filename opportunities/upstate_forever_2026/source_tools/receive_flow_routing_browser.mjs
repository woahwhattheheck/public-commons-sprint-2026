/** Complete receiving of original native Flow routes in the existing app.
 * Copyright TokenJunkieLabs. Caller owns the page, authenticated API, Workspace
 * and receiving lock. No server, scientific solver or second browser is created.
 */
import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>JSON.parse(JSON.stringify(value));
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?'['+value.map(canonical).join(',')+']':'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
const need=(ok,message)=>{if(!ok)throw Error(message);};
const query=(workspace,values)=>new URLSearchParams({workspace,...values}).toString();
const MEMBERS=['trace.json','originals.json','source-cells.json','routing_paths.py','cells.csv','edges.csv','terminals.csv','routes.geojson','route.svg','terrain-preview.png','index.html','MANIFEST.json','routing.zip'];
async function readSaved(filename){try{return JSON.parse(await readFile(filename,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function atomic(filename,value){
 const pending=filename+'.pending';await writeFile(pending,JSON.stringify(value,null,2)+'\n');await rename(pending,filename);
}
async function downloaded(page,locator,target,expected=null){
 const [transfer]=await Promise.all([page.waitForEvent('download'),locator.click()]);
 await transfer.saveAs(target);const body=await readFile(target);
 if(expected)need(body.length===expected.bytes&&hash(body)===expected.sha256,'Downloaded original member differs: '+expected.filename);
 return {path:target,bytes:body.length,sha256:hash(body)};
}
async function frame(page,directory,name,width,height){
 await page.setViewportSize({width,height});const target=path.join(directory,name+'.png');
 await page.screenshot({path:target,fullPage:true});const body=await readFile(target);
 return {name,path:target,bytes:body.length,sha256:hash(body)};
}
async function attachmentViews(page,directory,document){
 const attachment=await page.context().newPage(),screens=[];
 try{
  const readable=new Map();
  for(const name of MEMBERS)if(name!=='routing.zip')readable.set(name,await readFile(path.join(directory,name)));
  await attachment.route('https://flow-receiving.invalid/**',route=>{
   const name=new URL(route.request().url()).pathname.slice(1),body=readable.get(name);
   if(!body)return route.abort();
   const type=name.endsWith('.html')?'text/html; charset=utf-8':name.endsWith('.svg')?'image/svg+xml':name.endsWith('.png')?'image/png':name.endsWith('.json')||name.endsWith('.geojson')?'application/json; charset=utf-8':'text/plain; charset=utf-8';
   return route.fulfill({status:200,contentType:type,body});
  });
  await attachment.goto('https://flow-receiving.invalid/index.html');
  need((await attachment.locator('#document').textContent())&&same(JSON.parse(await attachment.locator('#document').textContent()),document),'Readable report embeds another original trace.');
  await attachment.locator('#find').fill('NO_MATCH_'+document.id);
  await attachment.getByText('No records match.',{exact:true}).waitFor();
  await attachment.locator('#find').fill('');
  for(const kind of ['cells','edges','terminals']){
   await attachment.locator('#kind').selectOption(kind);
   const next=attachment.locator('#next');if(await next.isEnabled()){await next.click();await attachment.locator('#prev').click();}
  }
  await attachment.locator('#kind').selectOption('cells');
  for(const [name,width,height]of[['html-desktop',1440,1000],['html-narrow',390,844]])screens.push(await frame(attachment,directory,name,width,height));
  for(const name of ['route.svg','terrain-preview.png']){
   await attachment.goto('https://flow-receiving.invalid/'+name);
   screens.push(await frame(attachment,directory,name+'-view',1100,800));
  }
  // Read the actual exported structured/text attachments through the browser.
  // Their complete bytes remain beside the report and in its original ZIP.
  for(const name of ['trace.json','originals.json','source-cells.json','routing_paths.py','cells.csv','edges.csv','terminals.csv','routes.geojson','MANIFEST.json']){
   await attachment.goto('https://flow-receiving.invalid/'+name);
   need((await attachment.locator('body').innerText()).length>0,'Open the original outgoing '+name);
  }
  return screens;
 }finally{await attachment.close();}
}
async function servedReportViews(page,directory,document){
 const [report]=await Promise.all([
  page.waitForEvent('popup'),
  page.locator('[data-flow-open-report-html]').click()
 ]);
 const screens=[];
 try{
  await report.waitForLoadState('domcontentloaded');
  need(same(JSON.parse(await report.locator('#document').textContent()),document),'The original served report changed its complete native trace.');
  // Operate the actual application route and its production CSP before opening
  // the downloaded offline copy. These controls require the maintained script.
  await report.locator('#find').fill('NO_MATCH_'+document.id);
  await report.getByText('No records match.',{exact:true}).waitFor();
  await report.locator('#find').fill('');
  for(const kind of ['cells','edges','terminals']){
   await report.locator('#kind').selectOption(kind);
   const next=report.locator('#next');
   if(await next.isEnabled()){await next.click();await report.locator('#prev').click();}
  }
  await report.locator('#kind').selectOption('cells');
  await report.getByText('Complete original binding and geometry',{exact:true}).click();
  need(same(JSON.parse(await report.locator('#source').textContent()),{binding:document.binding,geometry:document.geometry}),'The served report did not render its complete original source.');
  screens.push(await frame(report,directory,'served-html-desktop',1440,1000));
  screens.push(await frame(report,directory,'served-html-narrow',390,844));
  return screens;
 }finally{await report.close();}
}
async function receiveReport({page,api,workspace,stage,directory}){
 const value=await api('/api/flow-routing/report?'+query(workspace,{id:stage.report_id}));
 need(value.workspace_key===workspace&&value.id===stage.report_id&&value.report.id===stage.report_id,'Open the saved route in its actual Workspace.');
 need(same(value.report.selection,stage.selection)&&value.report.source_id===stage.source_id,'The report differs from the selected original source point.');
 need(same(value.document.selection,stage.selection)&&value.document.source_id===stage.source_id,'The complete report document changed selection.');
 const tickets=value._downloads||value.tickets;
 need(Array.isArray(tickets)&&tickets.length===MEMBERS.length&&same(tickets.map(t=>t.member).sort(),[...MEMBERS].sort()),'Receive all thirteen original routing members.');
 await mkdir(directory,{recursive:true});
 const [opened]=await Promise.all([
  page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname==='/api/flow-routing/report'&&new URL(r.url()).searchParams.get('id')===stage.report_id),
  page.locator('[data-flow-report="'+stage.report_id+'"]').click()
 ]);
 need(opened.ok()&&same((await opened.json()).report,value.report),'The app opened another original saved report.');
 const root=page.locator('[data-flow-routing]');
 const first=tickets.find(t=>t.member==='trace.json');
 await waitUntil(()=>root.locator('[data-flow-download="trace.json"]').getAttribute('href'),
  href=>typeof href==='string'&&href.split('?')[0]===first.url,'The original saved report has not rendered its exact attachment tickets.');
 const files=[];
 for(const ticket of tickets){
  need(ticket.workspace===workspace&&MEMBERS.includes(ticket.member)&&ticket.filename===ticket.member,'Original route ticket identity changed.');
  const descriptor=value.report.files[ticket.member];
  need(descriptor&&descriptor.path===ticket.member&&descriptor.bytes===ticket.bytes&&descriptor.sha256===ticket.sha256,'A route ticket differs from its immutable scientific record.');
  files.push({member:ticket.member,...await downloaded(page,root.locator('[data-flow-download="'+ticket.member+'"]'),path.join(directory,ticket.member),ticket)});
 }
 const trace=JSON.parse(await readFile(path.join(directory,'trace.json'),'utf8'));
 need(same(trace,value.document),'Actual downloaded trace differs from its saved full graph.');
 const originals=JSON.parse(await readFile(path.join(directory,'originals.json'),'utf8'));
 need(originals.source.id===stage.source_id&&same(originals.binding,value.document.binding),'Original source attachment changed its binding.');
 await atomic(path.join(directory,'report.json'),value.report);
 await root.locator('[data-flow-search]').fill('NO_MATCH_'+value.id);
 await root.getByText('No matching original records.',{exact:true}).waitFor();
 await root.locator('[data-flow-search]').fill('');
 for(const kind of ['cells','edges','terminals']){
  await root.locator('[data-flow-kind]').selectOption(kind);
  const next=root.locator('[data-flow-action="next"]');
  if(await next.isEnabled()){await next.click();await root.locator('[data-flow-action="previous"]').click();}
 }
 await root.locator('[data-flow-kind]').selectOption('cells');
 const screenshots=[await frame(page,directory,'app-desktop',1440,1000),await frame(page,directory,'app-narrow',390,844),...await servedReportViews(page,directory,value.document),...await attachmentViews(page,directory,value.document)];
 return {report:value.report,document_sha256:hash(await readFile(path.join(directory,'trace.json'))),files,screenshots};
}


async function savedWorking(page,workspace,projectId){
 return page.evaluate(({workspace,projectId})=>{
  const tab=sessionStorage.getItem('upstate-flow-routing-tab');
  if(!tab)return null;
  const raw=localStorage.getItem('upstate-flow-routing:v1:'+workspace+':'+projectId+':'+tab);
  return raw===null?null:JSON.parse(raw);
 },{workspace,projectId});
}
async function waitUntil(read,predicate,message,timeout=180000){
 const until=Date.now()+timeout;
 while(Date.now()<until){const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,400));}
 throw Error(message);
}
function taskMatches(task,request){
 need(task&&/^[0-9a-f]{64}$/.test(task.id)&&task.workspace===request.workspace&&task.action===request.action&&same(task.payload,request.payload)&&(!request.task_id||request.task_id===task.id),'The original task differs from this retained source selection.');
}
function commandBody(request){
 return {workspace:request.workspace,action:request.action,payload:clone(request.payload),operation_id:request.operation_id};
}
async function mount(page){
 await page.locator('[data-view="flow-routing"]').click();
 await page.locator('[data-flow-field="run"]').waitFor();
}
async function ready(page){
 await waitUntil(async()=>page.locator('[data-flow-action="download-working"]').isEnabled(),Boolean,'The original routing view did not open.');
}
async function openWorking(page,filename,selection){
 await page.locator('[data-flow-open-working]').setInputFiles(filename);
 await waitUntil(async()=>({
  run:await page.locator('[data-flow-field="run"]').inputValue(),
  row:await page.locator('[data-flow-field="row"]').inputValue(),
  column:await page.locator('[data-flow-field="column"]').inputValue(),
  title:await page.locator('[data-flow-field="title"]').inputValue(),
  enabled:await page.locator('[data-flow-action="open-working"]').isEnabled()
 }),v=>v.run===selection.run_id&&v.row===(selection.row===null?'':String(selection.row))&&v.column===(selection.column===null?'':String(selection.column))&&v.title===selection.title&&v.enabled,
 'The complete original working selection did not reopen.');
}
async function choose(page,selection){
 const root=page.locator('[data-flow-routing]');
 await root.locator('[data-flow-field="run"]').selectOption(selection.run_id);
 await root.locator('[data-flow-field="model"]').selectOption(selection.model);
 for(const field of ['row','column','title','notes'])await root.locator('[data-flow-field="'+field+'"]').fill(String(selection[field]));
 await root.locator('[data-flow-field="stop_at_stream"]').setChecked(selection.stop_at_stream);
}
async function originalSource({page,workspace,projectId,selection,directory}){
 const [response]=await Promise.all([
  page.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname==='/api/flow-routing/source'&&r.request().postDataJSON()?.workspace===workspace),
  page.locator('[data-flow-action="source"]').click()
 ]);
 need(response.ok(),'Opening the actual original native rasters failed.');
 const value=await response.json();
 need(value.workspace_key===workspace&&value.project_id===projectId&&value.source.run_id===selection.run_id&&value.source.model===selection.model,'The actual source belongs to another original run.');
 need(selection.row<value.geometry.height&&selection.column<value.geometry.width,'The supplied actual source point is outside its original raster.');
 const expected={arguments:value.source.native_stage.arguments,...value.source.files};
 for(const descriptor of value.source.companions)expected['companion:'+descriptor.path]=descriptor;
 need(Array.isArray(value.source_tickets)&&same(value.source_tickets.map(t=>t.role).sort(),Object.keys(expected).sort()),'Receive every original argument, raster and companion.');
 await page.waitForFunction(()=>!!document.querySelector('[data-flow-map]')?._flowBase);
 await mkdir(directory,{recursive:true});
 const received=[];
 for(const ticket of value.source_tickets){
  const descriptor=expected[ticket.role];
  need(ticket.workspace===workspace&&ticket.member===descriptor.path&&ticket.bytes===descriptor.bytes&&ticket.sha256===descriptor.sha256,'The original source download changed its recorded native identity.');
  // A role may contain path separators; keep all original bytes under an owned
  // digest filename and retain the complete original path/role separately.
  const filename=String(received.length+1).padStart(2,'0')+'-'+hash(ticket.role).slice(0,12)+'-'+path.basename(ticket.member);
  // Attribute equality is evaluated without interpolating original paths into CSS.
  const all=page.locator('[data-flow-source-download]');
  let selected=null;
  for(let i=0;i<await all.count();i++){const candidate=all.nth(i);if(await candidate.getAttribute('data-flow-source-download')===ticket.role){selected=candidate;break;}}
  need(selected,'Open the actual original source download '+ticket.role);
  received.push({role:ticket.role,member:ticket.member,...await downloaded(page,selected,path.join(directory,filename),ticket)});
 }
 await atomic(path.join(directory,'original-source.json'),value);
 const argumentsFile=received.find(v=>v.role==='arguments');
 need(argumentsFile&&same(JSON.parse(await readFile(argumentsFile.path,'utf8')),value.source.arguments),'Downloaded native arguments differ from the original recorded interpretation.');
 return {source:value.source,geometry:value.geometry,downloads:received,screenshots:[
  await frame(page,directory,'source-desktop',1440,1000),
  await frame(page,directory,'source-narrow',390,844)
 ]};
}
async function completeTask({page,api,workspace,projectId,stage,save,resuming}){
 let working=await savedWorking(page,workspace,projectId);
 if(!stage.request){
  const candidates=[working?.pending,...(working?.requests||[])].filter(v=>v&&same(v.payload?.selection,stage.selection));
  const ids=[...new Set(candidates.map(v=>v.operation_id))];
  need(ids.length<=1,'Several original operations match this source point; select the retained operation explicitly.');
  if(candidates.length){stage.request=clone(candidates[0]);stage.source_id=stage.request.payload.expected_source_id;await save();}
 }
 need(stage.request&&same(stage.request.payload.selection,stage.selection),'Retain the original submitted request before continuing.');
 need(stage.request.payload.expected_source_id===stage.source_id,'The retained original request changed its native source.');
 let task=null;
 const current=working?.pending;
 if(current){
  need(current.operation_id===stage.request.operation_id&&same(commandBody(current),commandBody(stage.request)),'Another original routing request is still selected.');
  if(current.task_id)stage.request.task_id=current.task_id;
 }
 if(stage.request.task_id)task=await api('/api/task?'+query(workspace,{id:stage.request.task_id}));
 else {
  const complete=(working?.requests||[]).find(v=>v.operation_id===stage.request.operation_id);
  if(complete?.task_id){stage.request.task_id=complete.task_id;task=await api('/api/task?'+query(workspace,{id:complete.task_id}));}
 }
 if(task)taskMatches(task,stage.request);
 // Resume through the actual UI whenever it retains this operation. The UI
 // preserves its request and moves it to history after the original task finishes.
 if(resuming&&current){
  await waitUntil(()=>page.locator('[data-flow-action="resume"]').isEnabled(),Boolean,'Original task controls did not become available.');
  await page.locator('[data-flow-action="resume"]').click();
 }
 if(!task){
  // Recovery after a lost response uses exactly the retained operation ID and
  // original payload. The maintained action endpoint returns that original task.
  task=await api('/api/actions',{method:'POST',body:commandBody(stage.request)});
  taskMatches(task,stage.request);
 }
 if(resuming&&!current&&['failed','interrupted','cancelled'].includes(task.state)){
  task=await api('/api/task/resume',{method:'POST',body:{id:task.id}});
  taskMatches(task,stage.request);
 }
 stage.request.task_id=task.id;await save();
 // A UI resume may still be replacing a previous terminal state. Observe that
 // single continuation, then report a newly failed attempt without replay loops.
 if(resuming&&current&&['failed','interrupted','cancelled'].includes(task.state)){
  task=await waitUntil(
   ()=>api('/api/task?'+query(workspace,{id:stage.request.task_id})),
   next=>!same(next,task),'The original task did not report its requested continuation.',30000);
 }
 const until=Date.now()+30*60*1000;
 while(true){
  taskMatches(task,stage.request);
  stage.task={id:task.id,state:task.state,result:task.result||null,error:task.error||null};await save();
  if(task.state==='complete')break;
  if(['failed','interrupted','cancelled'].includes(task.state))throw Error('Original routing task '+task.id+' is '+task.state+': '+(task.error?.message||'Continue this same operation on the next receiving attempt.'));
  need(Date.now()<until,'The original task is still retained; continue this same operation when it finishes.');
  await new Promise(resolve=>setTimeout(resolve,1200));
  task=await api('/api/task?'+query(workspace,{id:task.id}));
 }
 need(/^[0-9a-f]{64}$/.test(task.result?.id)&&task.result.source_id===stage.source_id&&same(task.result.selection,stage.selection),'The completed task changed its original source selection.');
 stage.report_id=task.result.id;await save();
 if(current||!resuming){
  // If the caller resumed after browser loss, this reload's original UI may
  // have no live poller. Continue the exact retained task once to complete its
  // local history instead of replacing the working record directly.
  working=await savedWorking(page,workspace,projectId);
  if(working?.pending&&await page.locator('[data-flow-action="resume"]').isEnabled())await page.locator('[data-flow-action="resume"]').click();
  await waitUntil(()=>savedWorking(page,workspace,projectId),
   v=>!v?.pending&&(v?.requests||[]).some(r=>r.operation_id===stage.request.operation_id&&r.report_id===stage.report_id),
   'The original complete task has not yet reconciled its browser request history.');
 }
 await page.locator('[data-flow-action="refresh"]').click();
 await page.locator('[data-flow-report="'+stage.report_id+'"]').waitFor();
 return task;
}

/**
 * Run inside the original equipped receiver's existing authenticated page.
 * api(path,{method,body}) must return the actual original JSON response.
 * Supply two explicit real source points on a completed retained NDR/SDR run;
 * the helper neither selects field data nor starts a scientific solver.
 * The caller holds the receiving directory's existing process lock.
 */
export async function receiveFlowRouting({page,api,workspace,workspaceDirectory,runId,model,points,directory}){
 need(typeof api==='function'&&typeof workspace==='string'&&path.isAbsolute(workspaceDirectory),'Use the original authenticated app and absolute Workspace path.');
 need(/^[0-9a-f]{64}$/.test(runId)&&['ndr','sdr'].includes(model)&&Array.isArray(points)&&points.length===2,'Supply one completed native run and two actual source points.');
 const selections=points.map(point=>{
  need(point&&Number.isSafeInteger(point.row)&&point.row>=0&&Number.isSafeInteger(point.column)&&point.column>=0&&typeof point.title==='string'&&point.title.trim()&&point.title.trim().length<=240&&typeof point.notes==='string'&&point.notes.length<=16000&&typeof point.stop_at_stream==='boolean','Keep each actual point, stopping choice, title and source interpretation explicit.');
  return {schema:'upstate.flow-routing-selection/v1',run_id:runId,model,row:point.row,column:point.column,stop_at_stream:point.stop_at_stream,title:point.title.trim(),notes:point.notes};
 });
 need(selections[0].row!==selections[1].row||selections[0].column!==selections[1].column,'Supply two distinct actual source cells.');
 directory=path.resolve(directory);await mkdir(directory,{recursive:true});
 const moduleSha=hash(await readFile(fileURLToPath(import.meta.url)));
 const catalogue=await api('/api/flow-routing/catalog?'+query(workspace,{}));
 need(catalogue.workspace_key===workspace&&catalogue.runs.some(r=>r.id===runId&&r.stages.some(s=>s.model===model)),'Choose an actual completed model from this original Workspace.');
 const identity={schema:'upstate.flow-routing-browser/v1',workspace,workspace_directory:workspaceDirectory,project_id:catalogue.project_id,run_id:runId,model,selections,module_sha256:moduleSha};
 const operationFile=path.join(directory,'operation.json');
 let operation=await readSaved(operationFile);
 if(operation)need(same(operation.identity,identity),'This receiving directory belongs to another complete original source course.');
 else operation={identity,started_at:new Date().toISOString(),selections:selections.map(selection=>({selection}))};
 const save=()=>atomic(operationFile,operation);
 await save();
 const originalURL=page.url(),originalViewport=page.viewportSize();
 let originalFile=operation.original_working?.path||null;
 try{
  await mount(page);await ready(page);
  let working=await savedWorking(page,workspace,catalogue.project_id);
  need(!await page.locator('[data-flow-action="download-original"]').count(),'Preserve and explicitly repair the unreadable original working record before this course.');
  if(working?.pending)need(selections.some(s=>same(s,working.pending.payload?.selection)),'Preserve the unrelated original pending routing operation before starting this course.');
  if(!originalFile){
   originalFile=path.join(directory,'before-course-working.json');
   operation.original_working=await downloaded(page,page.locator('[data-flow-action="download-working"]'),originalFile);
   operation.original_working.selection=JSON.parse(await readFile(originalFile,'utf8')).selection;await save();
  }else{
   const bytes=await readFile(originalFile);need(bytes.length===operation.original_working.bytes&&hash(bytes)===operation.original_working.sha256,'The complete original pre-course working selection changed.');
  }
  for(let index=0;index<2;index++){
   const stage=operation.selections[index],stageDirectory=path.join(directory,'selection-'+(index+1));
   await mkdir(stageDirectory,{recursive:true});
   working=await savedWorking(page,workspace,catalogue.project_id);
   if(!stage.request){
    const retained=[working?.pending,...(working?.requests||[])].filter(r=>r&&same(r.payload?.selection,stage.selection));
    const ids=[...new Set(retained.map(r=>r.operation_id))];
    need(ids.length<=1,'Choose the original retained operation when several requests use this same point.');
    if(retained.length){stage.request=clone(retained[0]);stage.source_id=stage.request.payload.expected_source_id;await save();}
   }
   if(!stage.report_id&&!stage.request){
    need(!working?.pending,'Continue the original previous task before another source point.');
    await choose(page,stage.selection);
    stage.source=await originalSource({page,workspace,projectId:catalogue.project_id,selection:stage.selection,directory:path.join(stageDirectory,'native-source')});
    stage.source_id=stage.source.source.id;await save();
    // Operate the actual working-file download and reopen, with a different
    // supplied real point temporarily visible, before any route is submitted.
    stage.working=await downloaded(page,page.locator('[data-flow-action="download-working"]'),path.join(stageDirectory,'working-selection.json'));
    const exported=JSON.parse(await readFile(stage.working.path,'utf8'));
    need(same(exported.selection,stage.selection)&&exported.source_id===stage.source_id&&!exported.pending,'The full downloaded working selection changed source.');
    await page.locator('[data-flow-field="row"]').fill(String(selections[1-index].row));
    await page.locator('[data-flow-field="column"]').fill(String(selections[1-index].column));
    await openWorking(page,stage.working.path,stage.selection);
    const reopenedSource=await originalSource({page,workspace,projectId:catalogue.project_id,selection:stage.selection,directory:path.join(stageDirectory,'reopened-native-source')});
    need(same(reopenedSource.source,stage.source.source)&&same(reopenedSource.geometry,stage.source.geometry),'Reopening the working selection changed its actual original native rasters.');
    stage.reopened_source=reopenedSource;await save();
    const [request]=await Promise.all([
     page.waitForRequest(r=>r.method()==='POST'&&new URL(r.url()).pathname==='/api/actions'&&r.postDataJSON()?.action==='flow-route.trace'&&same(r.postDataJSON()?.payload?.selection,stage.selection)),
     page.locator('[data-flow-action="trace"]').click()
    ]);
    stage.request=request.postDataJSON();await save();
    const response=await request.response();
    if(response?.ok()){
     const task=await response.json();taskMatches(task,stage.request);
     stage.request.task_id=task.id;await save();
    }
    await completeTask({page,api,workspace,projectId:catalogue.project_id,stage,save,resuming:false});
   }else if(!stage.report_id){
    await completeTask({page,api,workspace,projectId:catalogue.project_id,stage,save,resuming:true});
   }
   // A crash may have retained the report before its source download chapter.
   // Reopen the same original source without changing a saved report or request.
   working=await savedWorking(page,workspace,catalogue.project_id);
   if(stage.report_id&&working?.pending){
    need(stage.request&&working.pending.operation_id===stage.request.operation_id,'Preserve the unrelated original pending request.');
    await completeTask({page,api,workspace,projectId:catalogue.project_id,stage,save,resuming:true});
    working=await savedWorking(page,workspace,catalogue.project_id);
   }
   need(!working?.pending,'Reconcile the original task before inspecting the next saved point.');
   if(!stage.source){
    await choose(page,stage.selection);
    stage.source=await originalSource({page,workspace,projectId:catalogue.project_id,selection:stage.selection,directory:path.join(stageDirectory,'native-source')});
    need(stage.source.source.id===stage.source_id,'The resumed original route no longer has the same native source.');await save();
   }
   await page.locator('[data-flow-action="refresh"]').click();
   await page.locator('[data-flow-report="'+stage.report_id+'"]').waitFor();
   stage.received=await receiveReport({page,api,workspace,stage,directory:path.join(stageDirectory,'report')});
   stage.completed_at=new Date().toISOString();await save();
  }
  need(operation.selections[0].report_id!==operation.selections[1].report_id,'The original distinct source points did not retain distinct reports.');
  operation.after_working=await downloaded(page,page.locator('[data-flow-action="download-working"]'),path.join(directory,'after-course-working.json'));
  const after=JSON.parse(await readFile(operation.after_working.path,'utf8'));
  need(!after.pending&&operation.selections.every(s=>after.requests.some(r=>r.operation_id===s.request.operation_id&&r.report_id===s.report_id)),'Retain both original completed requests and reports in the full working copy.');
  // Reopen the complete current working file through the actual control.
  await openWorking(page,operation.after_working.path,after.selection);
  const before=JSON.parse(await readFile(originalFile,'utf8'));
  if(!before.pending){
   // Restore the operator's selection onto the complete current history. Do not
   // replace newly accepted native requests with the old pre-course snapshot.
   const restored={...after,selection:clone(before.selection),source_id:before.source_id,
    active_id:before.active_id,pending:null,
    prior_copies:[...new Set([...(after.prior_copies||[]),...(before.prior_copies||[])])]};
   const restoredFile=path.join(directory,'restored-original-selection.json');
   await atomic(restoredFile,restored);
   await openWorking(page,restoredFile,restored.selection);
   operation.restored_working=await downloaded(page,page.locator('[data-flow-action="download-working"]'),path.join(directory,'restored-selection-readback.json'));
   const reopened=JSON.parse(await readFile(operation.restored_working.path,'utf8'));
   need(same(reopened.selection,before.selection)&&reopened.active_id===before.active_id&&!reopened.pending&&same(reopened.requests,after.requests)&&same(reopened.prior_copies,restored.prior_copies),'Restoring the original point changed complete accepted request history.');
  }
  operation.completed_at=new Date().toISOString();operation.operation_file=operationFile;
  operation.operator_instruction='Personally inspect the actual desktop/narrow application, HTML/SVG/PNG and every source/report download, then run receive_flow_routing.py and open its restored Workspace through the same application.';
  await save();return clone(operation);
 }catch(error){
  operation.last_error={at:new Date().toISOString(),message:error.stack||String(error)};await save();throw error;
 }finally{
  // Failure retains the exact accepted/uncertain original request in place.
  if(originalViewport)await page.setViewportSize(originalViewport);
  if(page.url()!==originalURL)await page.goto(originalURL);
 }
}

/** Read-only receiving on the original application's registered cold Workspace. */
export async function receiveReopenedFlowRouting({page,api,workspace,operationFile,directory}){
 const original=await readSaved(operationFile);
 need(original?.completed_at&&original.selections?.length===2,'Open the completed original two-point browser operation.');
 const catalogue=await api('/api/flow-routing/catalog?'+query(workspace,{}));
 need(catalogue.workspace_key===workspace&&catalogue.project_id===original.identity.project_id,'The restored Workspace belongs to another original project.');
 directory=path.resolve(directory);await mkdir(directory,{recursive:true});
 const originalURL=page.url(),originalViewport=page.viewportSize(),reports=[];
 try{
  await mount(page);await ready(page);
  for(let i=0;i<original.selections.length;i++){
   const stage=original.selections[i];
   need(catalogue.reports.some(r=>r.id===stage.report_id),'The complete restored Workspace lost a saved route.');
   const value=await receiveReport({page,api,workspace,stage,directory:path.join(directory,'selection-'+(i+1))});
   need(same(value.report,stage.received.report)&&value.document_sha256===stage.received.document_sha256,'The restored app changed a complete report or original graph.');
   reports.push(value);
  }
  const result={schema:'upstate.flow-routing-cold-browser/v1',original_operation:path.resolve(operationFile),project_id:catalogue.project_id,workspace,reports,completed_at:new Date().toISOString()};
  await atomic(path.join(directory,'cold-browser.json'),result);return result;
 }finally{
  if(originalViewport)await page.setViewportSize(originalViewport);
  if(page.url()!==originalURL)await page.goto(originalURL);
 }
}
