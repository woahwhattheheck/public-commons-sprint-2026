#!/usr/bin/env node
/** Continue the original FSU receiving case through the maintained browser. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath,pathToFileURL} from 'node:url';
import readline from 'node:readline';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const ROOT=path.resolve(process.env.FSU_OPERATOR_ROOT||path.join(HERE,'case'));
const SOURCE=path.resolve(process.env.FSU_APPLICATION_SOURCE||path.join(HERE,'../..'));
const ARCHIVE=path.resolve(process.env.FSU_ORIGINAL_ARCHIVE||path.join(ROOT,'FSU_Accepted_Market_Pay_Structure_Complete_Case_2026-10-12.zip'));
const COMMIT=process.env.FSU_SOURCE_COMMIT||'1b69ab4dd5e91eecb554367dba3e40fd48bbec50';
const PYTHON=process.env.FSU_PYTHON||'python3';
const OP='fsu-original-receiving-linked-recovery-20261012-f11';
const OUT=path.join(ROOT,'result'), REQUESTS=path.join(OUT,'requests');
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const stable=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
const insist=(test,message)=>{if(!test)throw new Error(message);};
function atomic(file,data){
 fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+crypto.randomUUID()+'.part';
 let fd;
 try{fd=fs.openSync(temp,'wx',0o600);fs.writeFileSync(fd,data);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;fs.renameSync(temp,file);
  const dir=fs.openSync(path.dirname(file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
 }finally{if(fd!==undefined)fs.closeSync(fd);if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
function retain(file,data){if(fs.existsSync(file))insist(fs.readFileSync(file).equals(data),'Retained original bytes differ: '+file);else atomic(file,data);return {path:file,bytes:data.length,sha256:sha(data)};}
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function native(action){
 const args=[path.join(HERE,'fsu_original_native.py'),action,'--source',SOURCE,'--root',ROOT,'--source-commit',COMMIT];
 if(action==='seed')args.push('--archive',ARCHIVE);
 const r=spawnSync(PYTHON,args,{encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 if(r.status!==0)throw new Error('Original native '+action+' failed: '+r.stderr+'\n'+r.stdout);
 return JSON.parse(r.stdout);
}
fs.mkdirSync(REQUESTS,{recursive:true});
const design=native('seed');
const journalPath=path.join(OUT,'browser-journal.json');
let journal=fs.existsSync(journalPath)?read(journalPath):{
 schema:'fsu.original-browser-continuation.v1',operation_id:OP,workspace_id:design.workspace_id,
 source_commit:COMMIT,started_at:new Date().toISOString(),requests:{},steps:{},downloads:{},errors:[],status:'IN_PROGRESS'
};
insist(journal.operation_id===OP&&journal.workspace_id===design.workspace_id,'The retained browser operation belongs to another case');
function save(){atomic(journalPath,bytes(journal));}
function step(name,value){journal.steps[name]={completed_at:new Date().toISOString(),...value};save();}
if(journal.status!=='COMPLETE')save();
let server,context,baseURL,routeError=null;
const runtimeModules=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
insist(runtimeModules,'Use the existing primary Playwright runtime');
const require=createRequire(path.join(runtimeModules,'playwright','package.json'));
const {chromium}=require('playwright');
const chromiumPath=process.env.FSU_CHROMIUM;
insist(chromiumPath&&fs.existsSync(chromiumPath),'Supply the retained existing Chromium executable');

async function startServer(workspaceDirectory=path.join(ROOT,'workspace')){
 server=spawn(PYTHON,[path.join(SOURCE,'cli.py'),'--workspace',workspaceDirectory,'serve','--port','0'],{
  cwd:SOURCE,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']
 });
 let stderr='';
 server.stderr.on('data',chunk=>{stderr+=chunk.toString();if(stderr.length>65536)stderr=stderr.slice(-65536);});
 const lineReader=readline.createInterface({input:server.stdout});
 return await new Promise((resolve,reject)=>{
  const timeout=setTimeout(()=>reject(new Error('Original application did not publish its loopback URL: '+stderr)),30000);
  server.once('exit',(code)=>{clearTimeout(timeout);reject(new Error('Original application ended before its URL: '+code+' '+stderr));});
  lineReader.on('line',line=>{
   try{const value=JSON.parse(line);if(value.url){insist(value.workspace_id===design.workspace_id,'The browser server opened another workspace');clearTimeout(timeout);resolve(value.url);}}
   catch(error){clearTimeout(timeout);reject(error);}
  });
 });
}
async function responseJSON(response){
 const raw=await response.body();let value;
 try{value=JSON.parse(raw.toString('utf8'));}catch{throw new Error('The original API did not return complete JSON: '+response.status());}
 if(!response.ok())throw Object.assign(new Error(value.error?.message||value.error||('HTTP '+response.status())),{response:value,status:response.status()});
 return value;
}
async function get(relative){return responseJSON(await context.request.get(baseURL+relative,{timeout:30000}));}
function adopt(pathname,value){
 const result=value?.result;
 if(!result)return;
 if(pathname.endsWith('/createHandoff')){
  insist(result.kind==='handoff'&&result.rows?.length===1&&result.rows[0].source?.data?.id===design.analysis_id,'The created handback lost its accepted original row');
  const ref={id:result.id,sha256:result.sha256};
  if(journal.linked_handoff)insist(JSON.stringify(journal.linked_handoff)===JSON.stringify(ref),'A second linked handback was created');
  journal.linked_handoff=ref;
 }else if(pathname.endsWith('/reviewAnnualChange')){
  insist(result.kind==='annual-review'&&result.previous?.id===design.previous_handoff.id&&result.current?.id===journal.linked_handoff?.id,'The annual decision lost its original edition pair');
  const ref={id:result.id,sha256:result.sha256};
  if(journal.linked_annual_review)insist(JSON.stringify(journal.linked_annual_review)===JSON.stringify(ref),'A second linked annual review was created');
  journal.linked_annual_review=ref;
 }
}
async function reconcile(){
 for(const [id,entry]of Object.entries(journal.requests)){
  const raw=fs.readFileSync(path.join(REQUESTS,entry.request_file));
  insist(sha(raw)===entry.request_sha256,'The original pre-dispatch request changed');
  if(entry.response_file){
   const saved=read(path.join(REQUESTS,entry.response_file));
   if(saved.status>=400)continue;
  }
  const response=await context.request.post(baseURL+entry.path,{data:raw,headers:{'Content-Type':'application/json'},timeout:30000});
  const responseRaw=await response.body();const value=JSON.parse(responseRaw.toString('utf8'));
  insist(response.ok(),'The original retained request could not reconcile: '+id);
  if(entry.response_file){
   const saved=read(path.join(REQUESTS,entry.response_file)),prior=JSON.parse(Buffer.from(saved.body_base64,'base64').toString('utf8'));
   insist(stable(prior.result)===stable(value.result)&&(prior.operation_revision??prior.revision)===value.operation_revision,'Native replay changed the retained original outcome');
  }else{
   entry.response_file=id+'.response.json';
   retain(path.join(REQUESTS,entry.response_file),bytes({status:response.status(),headers:response.headers(),body_base64:responseRaw.toString('base64')}));
   entry.response_sha256=sha(responseRaw);
  }
  entry.reconciled_at=new Date().toISOString();entry.reconciliation={current_revision:value.revision,operation_revision:value.operation_revision,replayed:value.replayed};adopt(entry.path,value);save();
 }
}
async function intercept(route){
 const request=route.request();
 if(request.method()!=='POST')return route.continue();
 try{
  const pathname=new URL(request.url()).pathname;
  const raw=Buffer.from(request.postData()||'','utf8'),body=JSON.parse(raw.toString('utf8'));
  insist(typeof body.operation_id==='string'&&/^[A-Za-z0-9._:-]{1,200}$/.test(body.operation_id),'The original UI mutation has no durable operation identity');
  const id=body.operation_id,safe=sha(Buffer.from(id)).slice(0,32);
  const existing=journal.requests[id];
  if(existing)insist(existing.path===pathname&&existing.request_sha256===sha(raw),'Original request identity was reused with changed input');
  else{
   const filename=safe+'.request.json';retain(path.join(REQUESTS,filename),raw);
   journal.requests[id]={operation_id:id,path:pathname,request_file:filename,request_sha256:sha(raw),prepared_at:new Date().toISOString()};
   save();
  }
  const entry=journal.requests[id];
  const response=await route.fetch({timeout:30000});const responseRaw=await response.body();
  const result=JSON.parse(responseRaw.toString('utf8'));
  const envelope={status:response.status(),headers:response.headers(),body_base64:responseRaw.toString('base64')};
  if(entry.response_file){
   const saved=read(path.join(REQUESTS,entry.response_file));
   if(saved.status<400){
    const prior=JSON.parse(Buffer.from(saved.body_base64,'base64').toString('utf8'));
    insist(response.ok()&&stable(prior.result)===stable(result.result)&&(prior.operation_revision??prior.revision)===result.operation_revision,'Original native UI replay changed its saved outcome');
   }
   const replay=safe+'.replay-'+((entry.replays?.length||0)+1)+'.json';
   retain(path.join(REQUESTS,replay),bytes(envelope));
   (entry.replays??=[]).push({file:replay,current_revision:result.revision,operation_revision:result.operation_revision,returned_at:new Date().toISOString()});
  }else{
   entry.response_file=safe+'.response.json';
   retain(path.join(REQUESTS,entry.response_file),bytes(envelope));
   entry.response_sha256=sha(responseRaw);entry.returned_at=new Date().toISOString();
  }
  if(response.ok())adopt(pathname,result);
  save();
  await route.fulfill({response,body:responseRaw});
 }catch(error){routeError=error;journal.errors.push({at:new Date().toISOString(),message:error.message,phase:'original-request'});save();await route.abort('failed');}
}
async function idle(page){
 await page.locator('.receiving[aria-busy="true"]').waitFor({state:'detached',timeout:30000});
 if(routeError)throw routeError;
}
async function receiving(page,tab){
 await page.locator('#nav [data-view="receiving"]').click();
 await page.locator('.receiving').waitFor({state:'visible'});await idle(page);
 if(tab){await page.locator('#receiving-tab-'+tab).click();await idle(page);}
}
async function reopen(page,id){
 await receiving(page,'history');
 await page.locator('#receiving-panel tr').filter({hasText:id}).getByRole('button',{name:'Reopen receiving record',exact:true}).click();await idle(page);
}
async function download(page,button,label){
 const event=page.waitForEvent('download',{timeout:30000});await button.click();
 const value=await event;const file=path.join(OUT,'browser-downloads',label);fs.mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.'+crypto.randomUUID()+'.part';await value.saveAs(temporary);const data=fs.readFileSync(temporary);
 const retained=retain(file,data);fs.unlinkSync(temporary);journal.downloads[label]={...retained,suggested_filename:value.suggestedFilename()};save();await idle(page);
 return retained;
}

function applicationSources(){
 const result={};
 const accept=/\.(py|mjs|js|css|html|json|md)$/i;
 function visit(absolute,relative){
  if(!fs.existsSync(absolute))return;
  const info=fs.lstatSync(absolute);
  insist(!info.isSymbolicLink(),'Use the retained regular application source: '+relative);
  if(info.isDirectory()){
   for(const entry of fs.readdirSync(absolute).sort())if(!['__pycache__','node_modules','.git'].includes(entry))visit(path.join(absolute,entry),relative+'/'+entry);
  }else if(info.isFile()&&accept.test(relative)){
   const raw=fs.readFileSync(absolute);
   result[relative]={bytes:raw.length,sha256:sha(raw)};
  }
 }
 for(const name of ['core.py','cli.py','server.py','AGENTS.md','CLAUDE.md','GEMINI.md',
                    'web','receiving','classification','publisher_intake','market_structure'])visit(path.join(SOURCE,name),name);
 for(const name of ['fsu-original-operator.mjs','fsu_original_native.py']){
  const raw=fs.readFileSync(path.join(HERE,name));result['receiving-driver/'+name]={bytes:raw.length,sha256:sha(raw)};
 }
 insist(result['core.py']&&result['server.py']&&result['web/app.js'],'Retain the complete selected application before opening the completed case');
 return result;
}
function relativeDescriptor(base,file){
 const raw=fs.readFileSync(file),relative=path.relative(base,file);
 insist(relative&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative),'Keep the visual attachment inside its original edition');
 return {path:relative.split(path.sep).join('/'),bytes:raw.length,sha256:sha(raw)};
}
async function closeNativeBrowser(){
 if(context){const selected=context;context=null;await selected.close();}
 if(server){
  const selected=server;server=null;
  if(selected.exitCode===null&&selected.signalCode===null){
   await new Promise(resolve=>{
    let timer;
    const done=()=>{clearTimeout(timer);resolve();};
    selected.once('exit',done);selected.kill('SIGTERM');
    timer=setTimeout(()=>{if(selected.exitCode===null&&selected.signalCode===null)selected.kill('SIGKILL');},5000);
   });
  }
 }
}
async function inspectCompletedCase(original){
 const completedFile=path.join(OUT,'browser-result.json'),completedRaw=fs.readFileSync(completedFile);
 const journalRaw=fs.readFileSync(journalPath),resultPath=path.join(OUT,'RESULT.json'),resultRaw=fs.readFileSync(resultPath);
 insist(stable(read(completedFile))===stable(journal.completed_result),'Use the original completed browser result');
 const selection={
  schema:'fsu.completed-case-visual-selection.v1',operation_id:OP,workspace_id:design.workspace_id,
  source_commit:COMMIT,application_sources:applicationSources(),browser_result_sha256:sha(completedRaw),
  native_result_sha256:sha(resultRaw),linked_handoff:original.linked_handoff,
  linked_annual_review:original.linked_annual_review,accepted_analysis_id:design.analysis_id,
  accepted_review_id:design.accepted_review_id,viewports:[1440,390]
 };
 const edition=sha(Buffer.from(stable(selection))),directory=path.join(OUT,'visual-editions',edition);
 fs.mkdirSync(directory,{recursive:true});
 const requestPath=path.join(directory,'selection.json');
 retain(requestPath,bytes(selection));
 const completedPath=path.join(directory,'visual-edition.json');
 const verifyHistorical=()=>{
  insist(fs.readFileSync(completedFile).equals(completedRaw),'The original completed browser result changed during visual continuation');
  insist(fs.readFileSync(journalPath).equals(journalRaw),'The original completed browser journal changed during visual continuation');
  insist(fs.readFileSync(resultPath).equals(resultRaw),'The original native completion changed during visual continuation');
 };
 const inspectSaved=value=>{
  insist(value.selection_sha256===edition&&stable(value.selection)===stable(selection),'The saved visual edition selects another source or case');
  for(const item of value.files){
   insist(typeof item.path==='string'&&item.path&&!item.path.includes('\\')&&!path.isAbsolute(item.path)&&
    !item.path.split('/').some(part=>part==='..'||part==='.'||!part),'The visual attachment path differs');
   const file=path.resolve(directory,item.path);
   insist(file.startsWith(directory+path.sep)&&fs.lstatSync(file).isFile()&&!fs.lstatSync(file).isSymbolicLink(),'Retain each original visual attachment');
   const raw=fs.readFileSync(file);insist(raw.length===item.bytes&&sha(raw)===item.sha256,'A completed visual attachment changed: '+item.path);
  }
 };
 if(fs.existsSync(completedPath)){
  const saved=read(completedPath);inspectSaved(saved);verifyHistorical();
  return {...original,visual_edition:{id:edition,path:completedPath,index:path.join(directory,'index.html'),sha256:sha(fs.readFileSync(completedPath)),reopened:true}};
 }
 const progressPath=path.join(directory,'progress.json'),files=new Map(),views=[],downloads={},pageErrors=[],blockedRequests=[];
 const progress=(phase,details={})=>atomic(progressPath,bytes({schema:'fsu.completed-case-visual-progress.v1',operation_id:OP,edition,phase,at:new Date().toISOString(),...details}));
 const add=file=>{const entry=relativeDescriptor(directory,file);files.set(entry.path,entry);return entry;};
 const saveAttachment=(relative,raw)=>{const file=path.join(directory,relative);retain(file,raw);return add(file);};
 async function capture(page,label){
  const previous=page.viewportSize();
  try{
   for(const width of selection.viewports){
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>document.fonts.ready);
    const raw=await page.screenshot({fullPage:true,animations:'disabled'}),entry=saveAttachment('screens/'+label+'-'+width+'-'+sha(raw).slice(0,16)+'.png',raw);
    views.push({label,viewport:{width,height:1000},file:entry});
    progress('rendering',{last_view:label,viewport:width});
   }
  }finally{if(previous)await page.setViewportSize(previous);}
 }
 async function downloadExisting(page,title,label){
  const event=page.waitForEvent('download',{timeout:30000});
  await page.getByRole('button',{name:title,exact:true}).click();
  const item=await event,temp=path.join(directory,'.download-'+crypto.randomUUID()+'.part');
  try{
   await item.saveAs(temp);const raw=fs.readFileSync(temp);
   const old=original.browser?.downloads?.[label]||journal.completed_result.downloads?.[label];
   if(old&&!label.endsWith('.html'))insist(raw.length===old.bytes&&sha(raw)===old.sha256,'The original completed download changed: '+label);
   // A changed renderer may create a successor HTML body; the original download stays untouched.
   const entry=saveAttachment('downloads/'+sha(raw)+'-'+label,raw);
   downloads[label]={...entry,suggested_filename:item.suggestedFilename()};
  }finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
 }
 async function browserFor(workspacePath,profileSuffix){
  baseURL=await startServer(workspacePath);
  const tmp=path.join(ROOT,'tmp');fs.mkdirSync(tmp,{recursive:true});
  context=await chromium.launchPersistentContext(path.join(ROOT,'visual-browser-'+edition.slice(0,16)+'-'+profileSuffix),{
   executablePath:chromiumPath,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
   args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
   env:{...process.env,TMPDIR:process.env.TMPDIR||tmp}
  });
  const page=context.pages()[0]||await context.newPage();page.setDefaultTimeout(30000);
  page.on('pageerror',error=>pageErrors.push({phase:profileSuffix,message:error.message}));
  await context.route('**/api/**',async route=>{
   if(['GET','HEAD','OPTIONS'].includes(route.request().method()))return route.continue();
   blockedRequests.push({method:route.request().method(),path:new URL(route.request().url()).pathname});
   return route.abort('blockedbyclient');
  });
  await page.goto(baseURL,{waitUntil:'domcontentloaded'});
  await page.locator('#nav [data-view="receiving"]').waitFor({state:'visible'});
  const actual=await get('/api/state');insist(stable(actual.workspace)===stable(original.workspace),'The completed receiving workspace changed');
  return page;
 }
 try{
  progress('opening-original-completed-case');
  let page=await browserFor(path.join(ROOT,'workspace'),'original');
  const actual=await get('/api/document/analysis/'+design.analysis_id);
  insist(actual.result_sha256===design.analysis_sha256&&actual.reviews.at(-1).id===design.accepted_review_id,'Original accepted pricing changed');
  await page.locator('#nav [data-view="reports"]').click();
  await page.locator('[data-action="review-analysis"][data-id="'+design.analysis_id+'"]').click();
  await page.locator('#review-form').waitFor({state:'visible'});
  insist(await page.locator('#review-form').getAttribute('data-sha')===design.analysis_sha256,'The visible accepted pricing differs');
  await capture(page,'original-accepted-pricing');
  await reopen(page,original.linked_handoff.id);
  for(const [title,label]of [['Download CSV','linked-handback.csv'],['Download TSV','linked-handback.tsv'],['Download complete handoff JSON','linked-handback.json'],['Download printable receiving report','linked-handback-report.html']])await downloadExisting(page,title,label);
  await capture(page,'linked-handback');
  await reopen(page,original.linked_annual_review.id);
  for(const [title,label]of [['Download complete annual review JSON','linked-annual-review.json'],['Download printable annual report','linked-annual-report.html']])await downloadExisting(page,title,label);
  await capture(page,'linked-annual-review');
  const reportPage=await context.newPage();
  try{
   for(const [label,item]of Object.entries(downloads))if(label.endsWith('.html')){
    await reportPage.goto(pathToFileURL(path.join(directory,item.path)).href,{waitUntil:'load'});
    await capture(reportPage,label.replace(/\.html$/,''));
   }
  }finally{await reportPage.close();}
  await closeNativeBrowser();
  progress('opening-restored-native-archive');
  page=await browserFor(path.join(ROOT,'independent-receiving'),'restored');
  await reopen(page,original.linked_handoff.id);await capture(page,'restored-linked-handback');
  await reopen(page,original.linked_annual_review.id);await capture(page,'restored-linked-annual-review');
  const reopenedAnnual=await get('/api/extensions/receiving/document/annual-review/'+original.linked_annual_review.id);
  insist(reopenedAnnual.sha256===original.linked_annual_review.sha256,'The reopened archive selected another annual review');
  await closeNativeBrowser();
  insist(!blockedRequests.length,'The read-only visual continuation attempted a business POST; inspect its original control');
  insist(!pageErrors.length,'The rendered completed product raised a page error: '+pageErrors.map(row=>row.message).join('; '));
  verifyHistorical();
  insist(stable(applicationSources())===stable(selection.application_sources),'The application source changed while its outgoing screens were inspected');
  const instructionPath=path.join(SOURCE,'AGENTS.md');
  const instructions=fs.readFileSync(instructionPath),instructionSource=selection.application_sources['AGENTS.md'];
  insist(instructionSource&&instructions.length===instructionSource.bytes&&sha(instructions)===instructionSource.sha256,
   'The current producer instruction bytes differ from the selected application source');
  saveAttachment('PRODUCER_INSPECTION.md',instructions);
  const htmlEscape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const link=(label,href)=>'<a href="'+htmlEscape(href)+'">'+htmlEscape(label)+'</a>';
  const guide='# FSU completed case: populated visual continuation\n\nThis edition reopens the original accepted pricing, linked handback, annual review and independently restored native backup through the existing application. It retains new exact report downloads and real 1440/390-pixel screens alongside the original completion.\n\nOpen index.html and LOOK at the actual images and exact downloaded reports. Open the CSV/TSV/JSON attachments and the restored native workspace in their recipient-facing application. Operate the real controls and fix visible defects in the current source. PRODUCER_INSPECTION.md carries the complete owner rule. Rendering does not record that a human or model viewed the images; the producing worker performs that step.\n\nOriginal completion: ../../RESULT.json\nOriginal browser completion: ../../browser-result.json\nNative archive: ../../native-backup/workspace.zip\nCurrent source: '+COMMIT+'\nVisual edition: '+edition+'\n';
  saveAttachment('README.md',Buffer.from(guide));
  const rows=Object.entries(downloads).map(([label,item])=>'<tr><td>'+link(label,item.path)+'</td><td>'+item.bytes+'</td><td class="hash">'+item.sha256+'</td></tr>').join('');
  const images=views.map(view=>'<details><summary>'+htmlEscape(view.label)+' · '+view.viewport.width+' px</summary><figure>'+link('Open exact screenshot',view.file.path)+'<img src="'+htmlEscape(view.file.path)+'" alt="'+htmlEscape(view.label)+'"></figure></details>').join('');
  const html='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FSU completed receiving case</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#171717;background:#fff;max-width:1150px;margin:auto;padding:24px}h1,h2{line-height:1.25}a{color:inherit;text-decoration:underline}.scroll{overflow:auto}table{border-collapse:collapse;width:100%}th,td{padding:10px;text-align:left;border:1px solid #ccc;vertical-align:top}.hash{font:12px/1.4 monospace;overflow-wrap:anywhere}figure{margin:28px 0;border-top:1px solid #bbb;padding-top:12px}figcaption{font-weight:600}img{display:block;max-width:100%;height:auto;margin-top:10px}li{margin:8px 0}@media(max-width:600px){body{padding:14px}table{min-width:560px}}</style><h1>FSU completed receiving case</h1><p>Original accepted annual consensus: USD 35,200 / 37,950 / 43,950. The source supplies no effective date.</p><p>This visual edition reopens the original receiving records and native archive. Open the exact reports and attachments below; inspect them in normal use.</p><ul><li>'+link('Complete native workspace ZIP','../../native-backup/workspace.zip')+'</li><li>'+link('Original completed result','../../RESULT.json')+'</li><li>'+link('Current producing-worker inspection course','PRODUCER_INSPECTION.md')+'</li></ul><h2>Original receiving exports and current printable reports</h2><div class="scroll"><table><thead><tr><th>Attachment</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+rows+'</tbody></table></div><h2>Populated original and reopened workspace</h2>'+images+'</html>';
  // An interrupted, unpublished edition may replace only its own index. Completed editions return above.
  insist(!fs.existsSync(completedPath),'The completed visual edition must remain immutable');
  const indexFile=path.join(directory,'index.html');atomic(indexFile,Buffer.from(html));add(indexFile);
  context=await chromium.launchPersistentContext(path.join(ROOT,'visual-index-'+edition.slice(0,16)),{
   executablePath:chromiumPath,headless:true,viewport:{width:1440,height:1000},
   args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']
  });
  const indexPage=context.pages()[0]||await context.newPage();
  await indexPage.goto(pathToFileURL(indexFile).href,{waitUntil:'load'});
  await capture(indexPage,'outgoing-attachment-index');await closeNativeBrowser();
  verifyHistorical();
  const result={schema:'fsu.completed-case-visual-edition.v1',status:'RENDERED',selection_sha256:edition,selection,
   created_at:new Date().toISOString(),files:[...files.values()].sort((a,b)=>a.path.localeCompare(b.path)),
   views,downloads,original_records_preserved:true,restored_workspace_opened:true,
   page_errors:pageErrors,blocked_requests:blockedRequests,
   producer_action:'Open index.html; LOOK at the actual images and reports, open all relevant attachments, operate the restored product, and repair visible defects before presenting it.'};
  retain(completedPath,bytes(result));inspectSaved(result);
  progress('rendered',{result:relativeDescriptor(directory,completedPath)});
  return {...original,visual_edition:{id:edition,path:completedPath,index:indexFile,sha256:sha(fs.readFileSync(completedPath)),reopened:false}};
 }catch(error){
  progress('interrupted',{error:error.stack||String(error),page_errors:pageErrors,blocked_requests:blockedRequests});
  throw error;
 }finally{await closeNativeBrowser();verifyHistorical();}
}

async function run(){
 if(journal.status==='COMPLETE'){
  const file=path.join(OUT,'browser-result.json');
  insist(journal.completed_result,'Original complete progress has no retained result');
  if(fs.existsSync(file))insist(fs.readFileSync(file).equals(bytes(journal.completed_result)),'Completed browser result changed');
  else atomic(file,bytes(journal.completed_result));
  return inspectCompletedCase(native('finalize'));
 }
 baseURL=await startServer();
 fs.mkdirSync(path.join(ROOT,'tmp'),{recursive:true});
 context=await chromium.launchPersistentContext(path.join(ROOT,'browser-profile'),{
  executablePath:chromiumPath,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],
  env:{...process.env,TMPDIR:process.env.TMPDIR||path.join(ROOT,'tmp')}
 });
 await reconcile();
 const page=context.pages()[0]||await context.newPage();
 page.setDefaultTimeout(30000);page.on('pageerror',error=>{journal.errors.push({at:new Date().toISOString(),phase:'page',message:error.message});save();});
 await page.route('**/api/**',intercept);
 await page.goto(baseURL,{waitUntil:'domcontentloaded'});
 await page.locator('#nav [data-view="receiving"]').waitFor({state:'visible'});
 const initial=await get('/api/state');
 insist(initial.workspace.id===design.workspace_id,'The actual application opened another original case');
 const accepted=await get('/api/document/analysis/'+design.analysis_id);
 insist(accepted.result_sha256===design.analysis_sha256&&accepted.reviews.at(-1).id===design.accepted_review_id,'The original analysis or acceptance changed');
 if(!journal.steps.detached_receiving_return){
  await reopen(page,design.origin.id);
  const originalButton=page.getByRole('button',{name:'Open original pricing analysis',exact:true});
  await originalButton.click();
  await page.locator('#analysis-form').waitFor({state:'visible'});
  await page.getByRole('button',{name:'Return to receiving',exact:true}).click();
  await page.locator('.receiving').waitFor({state:'visible'});await idle(page);
  const enabled=await page.locator('#receiving-tab-delivery').isEnabled();
  insist(enabled,'The cached receiving controls stayed disabled after original pricing navigation');
  step('detached_receiving_return',{original_review_id:design.origin.id,prior_analysis_id:design.origin.prior_analysis_id,controls_enabled:enabled});
 }
 if(!journal.steps.accepted_analysis_reopened){
  await page.locator('#nav [data-view="reports"]').click();
  await page.locator('[data-action="review-analysis"][data-id="'+design.analysis_id+'"]').click();
  await page.locator('#review-form').waitFor({state:'visible'});
  insist(await page.locator('#review-form').getAttribute('data-sha')===design.analysis_sha256,'The visible review no longer binds the original accepted result');
  step('accepted_analysis_reopened',{analysis_id:design.analysis_id,accepted_review_id:design.accepted_review_id});
 }
 await receiving(page,'delivery');
 await page.getByLabel('Receiving operator',{exact:true}).fill('F11 original FSU operator continuation');
 if(!journal.linked_handoff){
  await page.getByLabel('Reviewed source edition',{exact:true}).selectOption(design.snapshot_id);await idle(page);
  await page.getByRole('button',{name:'Clear selection',exact:true}).click();await idle(page);
  await page.getByLabel('Include original row '+design.analysis_id,{exact:true}).check();
  await page.getByLabel('Reuse receiving profile',{exact:true}).selectOption(design.previous_handoff.id);await idle(page);
  insist(await page.getByLabel('Recipient header 1',{exact:true}).inputValue()===design.profile.columns[0].header,'The original recipient profile was not reused');
  await page.getByRole('button',{name:'Preview receiving handback',exact:true}).click();await idle(page);
  await page.getByRole('button',{name:'Create receiving handoff',exact:true}).click();await idle(page);
  insist(journal.linked_handoff,'The original created handback was not captured before UI application');
  step('linked_handback_created',{...journal.linked_handoff,analysis_id:design.analysis_id});
 }else await reopen(page,journal.linked_handoff.id);
 const handoff=await get('/api/extensions/receiving/document/handoff/'+journal.linked_handoff.id);
 insist(handoff.sha256===journal.linked_handoff.sha256&&handoff.rows.length===1&&handoff.rows[0].source.data.id===design.analysis_id,'The reopened handback changed its accepted original row');
 for(const [title,label]of [['Download CSV','linked-handback.csv'],['Download TSV','linked-handback.tsv'],['Download complete handoff JSON','linked-handback.json'],['Download printable receiving report','linked-handback-report.html']]){
  if(!journal.downloads[label])await download(page,page.getByRole('button',{name:title,exact:true}),label);
 }
 if(!journal.linked_annual_review){
  await receiving(page,'annual');
  await page.getByLabel('Previous receiving edition',{exact:true}).selectOption(design.previous_handoff.id);await idle(page);
  await page.getByLabel('Current receiving edition',{exact:true}).selectOption(journal.linked_handoff.id);await idle(page);
  await page.getByRole('button',{name:'Compare receiving editions',exact:true}).click();await idle(page);
  await page.getByLabel('Decision for filtered records',{exact:true}).selectOption('accept-update');
  await page.getByLabel('Reason for filtered records',{exact:true}).fill('Close the original returned rounding question with accepted analysis '+design.analysis_id+'. Retain the exact published annual consensus 35,200 / 37,950 / 43,950 and its original two source comparisons. The printed 38.0 thousand is display rounding of 37,950.');
  await page.getByRole('button',{name:'Apply decision to filtered records',exact:true}).click();await idle(page);
  await page.getByRole('button',{name:'Save annual receiving review',exact:true}).click();await idle(page);
  insist(journal.linked_annual_review,'The native annual review was not captured before UI application');
  step('linked_annual_review_created',{...journal.linked_annual_review,previous:design.previous_handoff.id,current:journal.linked_handoff.id});
 }else await reopen(page,journal.linked_annual_review.id);
 for(const [title,label]of [['Download complete annual review JSON','linked-annual-review.json'],['Download printable annual report','linked-annual-report.html']]){
  if(!journal.downloads[label])await download(page,page.getByRole('button',{name:title,exact:true}),label);
 }
 await page.reload({waitUntil:'domcontentloaded'});
 await reopen(page,journal.linked_annual_review.id);
 const annual=await get('/api/extensions/receiving/document/annual-review/'+journal.linked_annual_review.id);
 insist(annual.sha256===journal.linked_annual_review.sha256&&annual.previous.id===design.previous_handoff.id&&annual.current.id===journal.linked_handoff.id,'Reopened annual receiving selected a different edition');
 step('saved_history_reopened',{annual_review_id:annual.id,previous_handoff:annual.previous.id,current_handoff:annual.current.id});
 for(const [label,kind,id]of [['linked-handback.csv','handoff-csv',handoff.id],['linked-handback.tsv','handoff-tsv',handoff.id],['linked-handback.json','handoff-json',handoff.id],['linked-annual-review.json','annual-review',annual.id]]){
  const response=await context.request.get(baseURL+'/api/extensions/receiving/download/'+kind+'/'+id);
  insist(response.ok(),'Native original download failed: '+label);
  const raw=await response.body();insist(sha(raw)===journal.downloads[label].sha256,'Actual browser download differs from native: '+label);
 }
 const result={schema:'fsu.actual-original-browser-result.v1',status:'COMPLETE',operation_id:OP,workspace_id:design.workspace_id,
  source_commit:COMMIT,started_at:journal.started_at,completed_at:new Date().toISOString(),
  actual_browser:await context.browser()?.version()||'persistent Chromium',executable:chromiumPath,
  linked_handoff:journal.linked_handoff,linked_annual_review:journal.linked_annual_review,
  original_analysis_id:design.analysis_id,original_accepted_review_id:design.accepted_review_id,
  steps:journal.steps,downloads:journal.downloads,visuals:journal.visuals||[],retained_requests:Object.keys(journal.requests).length,page_errors:journal.errors};
 atomic(path.join(OUT,'browser-result.json'),bytes(result));
 journal.completed_result=result;journal.status='COMPLETE';save();
 await closeNativeBrowser();
 return inspectCompletedCase(native('finalize'));
}
try{const result=await run();process.stdout.write(JSON.stringify(result)+'\n');}
catch(error){
 const entry={at:new Date().toISOString(),phase:journal.status==='COMPLETE'?'completed-visual-continuation':'continuation',message:error.stack||String(error)};
 if(journal.status==='COMPLETE')retain(path.join(OUT,'completed-continuation-errors',entry.at.replace(/[:.]/g,'-')+'-'+sha(bytes(entry)).slice(0,12)+'.json'),bytes(entry));
 else{journal.errors.push(entry);save();}
 process.stderr.write((error.stack||String(error))+'\n');process.exitCode=1;
}
finally{
 if(context)await context.close().catch(()=>{});
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(()=>{if(server.exitCode===null)server.kill('SIGKILL');resolve();},5000);});}
}
