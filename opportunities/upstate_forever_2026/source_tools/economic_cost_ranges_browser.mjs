// Copyright (c) 2026 TokenJunkie Labs. MIT License.
// One original native course owns this private browser and its inherited operation lease.
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const SCHEMA='upstate.economic-cost-ranges-browser-course/v1',ACTION='economic.cost-ranges.build';
const need=(v,m)=>{if(!v)throw Error(m);},sha=b=>createHash('sha256').update(b).digest('hex');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const stable=v=>Array.isArray(v)?'['+v.map(stable).join(',')+']':object(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}':JSON.stringify(v);
const same=(a,b)=>stable(a)===stable(b),bytes=v=>Buffer.from(stable(v)+'\n');
const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const read=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function syncDir(p){const h=await fs.open(p,'r');try{await h.sync();}finally{await h.close();}}
async function keep(p,raw,{replace=false}={}){
 await fs.mkdir(path.dirname(p),{recursive:true,mode:0o700});
 if(!Buffer.isBuffer(raw))raw=Buffer.from(raw);
 const temp=p+'.partial-'+randomUUID(),f=await fs.open(temp,'wx',0o600);
 try{await f.writeFile(raw);await f.sync();}finally{await f.close();}
 try{if(replace)await fs.rename(temp,p);else try{await fs.link(temp,p);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(p)).equals(raw),'An original retained artifact changed: '+path.basename(p));}}
 finally{await fs.rm(temp,{force:true});}
 await syncDir(path.dirname(p));
}
const json=(p,v,options)=>keep(p,bytes(v),options);
function inside(root,name){need(typeof name==='string'&&name&&!name.includes('\\')&&!name.split('/').some(x=>!x||x==='.'||x==='..')&&!path.isAbsolute(name),'Use an original relative artifact name.');const full=path.resolve(root,name);need(full.startsWith(root+path.sep),'Artifact leaves the original browser phase.');return full;}
async function desc(root,file){const full=inside(root,file),s=await fs.lstat(full);need(s.isFile()&&!s.isSymbolicLink(),'Retain an ordinary original artifact.');const raw=await fs.readFile(full);return{file,bytes:raw.length,sha256:sha(raw)};}
async function verify(root,d){const actual=await desc(root,d.file);need(same(actual,{file:d.file,bytes:d.bytes,sha256:d.sha256}),'The original browser artifact changed: '+d.file);return inside(root,d.file);}
async function pidIdentity(pid){try{const s=await fs.readFile('/proc/'+pid+'/stat','utf8');return{pid:Number(pid),start:s.slice(s.lastIndexOf(')')+2).split(/\s+/)[19]};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function profileProcesses(profile){
 const rows=[];
 for(const pid of await fs.readdir('/proc'))if(/^\d+$/.test(pid))try{const args=(await fs.readFile('/proc/'+pid+'/cmdline','utf8')).split('\0');if(args.includes('--user-data-dir='+profile))rows.push(await pidIdentity(pid));}catch(e){if(!['ENOENT','EACCES','ESRCH'].includes(e.code))throw e;}
 return rows.filter(Boolean);
}
async function reconcileProfile(profile){
 const old=await profileProcesses(profile);
 for(const p of old)if(same(await pidIdentity(p.pid),p))try{process.kill(p.pid,'SIGTERM');}catch(e){if(e.code!=='ESRCH')throw e;}
 const deadline=Date.now()+10000;
 while((await profileProcesses(profile)).length&&Date.now()<deadline)await pause(100);
 need(!(await profileProcesses(profile)).length,'The original private Chromium remains active; retain the existing operation instead of launching another.');
 return old;
}
async function playwright(){
 try{return await import('playwright');}catch(first){
  const roots=[process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,process.env.PLAYWRIGHT_NODE_MODULES].filter(Boolean);
  for(const root of roots)try{const require=createRequire(path.join(root,'_original_course.cjs'));return await import(pathToFileURL(require.resolve('playwright')).href);}catch{}
  throw Error('Select the existing installed Playwright runtime; no installation is performed. '+first.code);
 }
}
async function main(){
 need(process.argv.length===4&&process.argv[2]==='--config','Use --config ORIGINAL_PRIVATE_CONFIG.');
 const config=await read(path.resolve(process.argv[3])),root=path.resolve(config.output),definition=await read(config.definitionPath);
 need(['author','received'].includes(config.phase)&&object(config.binding),'Select the original author or received phase.');
 const publicConfig={};for(const [k,v]of Object.entries(config))if(!['operatorUrl','output','binding','executable','python','archiveInspector'].includes(k))publicConfig[k]=v;
 need(same(publicConfig,config.binding),'Browser binding changed from its native owner.');
 const url=new URL(config.operatorUrl),origin=url.origin,token=new URLSearchParams(url.hash.slice(1)).get('token');
 need(token&&/^https?:$/.test(url.protocol),'Use the actual original operator capability URL.');
 const clean=x=>String(x).split(token).join('[original capability]');
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const resultPath=path.join(root,'result.json'),statePath=path.join(root,'browser-state.json'),ownerPath=path.join(root,'owner.json');
 const lock=Number(process.env.ECO_COST_RANGE_LOCK_FD);
 need(Number.isSafeInteger(lock)&&lock>=3&&(await fs.readFile('/proc/self/fdinfo/'+lock,'utf8')).includes('lock:'),'Inherit the original native course operation lock.');
 if(await exists(resultPath)){const r=await read(resultPath);need(r.complete&&r.closed&&same(r.binding,config.binding),'The retained browser result belongs to another original phase.');for(const d of r.artifacts)await verify(root,d);return r;}
 let state=await exists(statePath)?await read(statePath):{schema:SCHEMA,binding:config.binding,steps:{},artifacts:{},downloads:[],request:null,task_id:null};
 need(state.schema===SCHEMA&&same(state.binding,config.binding),'Retain the original complete browser checkpoint.');
 if(state.route_error){state.route_error_history??=[];state.route_error_history.push(state.route_error);delete state.route_error;}
 const save=()=>json(statePath,state,{replace:true});
 async function record(file){const d=await desc(root,file);const old=state.artifacts[file];if(old)need(same(old,d),'A prior original artifact changed.');state.artifacts[file]=d;await save();return d;}
 for(const d of Object.values(state.artifacts))await verify(root,d);
 const profile=path.resolve(root,'../../.private/cost-range-profile-'+config.phase);
 need(!profile.startsWith(root+path.sep),'Private profile must remain outside the delivered artifact tree.');
 await fs.mkdir(profile,{recursive:true,mode:0o700});
 if(await exists(ownerPath)){const old=await read(ownerPath);need(same(old.binding,config.binding)&&old.profile===profile,'Original browser ownership changed.');need(!old.process||!same(await pidIdentity(old.process.pid),old.process),'The original Node owner is still alive.');}
 const recovered=await reconcileProfile(profile);
 const owner={schema:SCHEMA,binding:config.binding,profile,process:await pidIdentity(process.pid),state:'launching',reconciled:recovered};
 await json(ownerPath,owner,{replace:true});
 let context=null,closing=null,closeError=null,signalError=null,operationError=null,page=null,archiveChild=null;
 const errors=[];
 const close=()=>{if(!context)return Promise.resolve();if(!closing)closing=context.close().catch(e=>{closeError=e;throw e;});return closing;};
 const stop=name=>{signalError??=Error('Original browser interrupted by '+name);if(archiveChild)try{archiveChild.kill('SIGTERM');}catch{}void close().catch(()=>{});};
 const term=()=>stop('SIGTERM'),int=()=>stop('SIGINT');
 process.on('SIGTERM',term);process.on('SIGINT',int);
 const act=a=>'[data-ecr-action="'+a+'"]',field=a=>'[data-ecr-field="'+a+'"]';
 async function screenshot(name,p=page){
  const file='views/'+name+'.png',textFile='views/'+name+'.txt';
  if(!(await exists(inside(root,file))))await p.screenshot({path:inside(root,file),fullPage:true});
  await record(file);
  if(!(await exists(inside(root,textFile))))await keep(inside(root,textFile),await p.locator('body').innerText());
  await record(textFile);
 }
 async function downloaded(file,action,p=page){
  const full=inside(root,file);
  if(await exists(full)){await record(file);return full;}
  const event=p.waitForEvent('download');
  await action();const d=await event,temp=full+'.download-'+randomUUID();
  await fs.mkdir(path.dirname(full),{recursive:true});
  await d.saveAs(temp);const failure=await d.failure();need(!failure,'The original browser download failed: '+failure);
  try{await keep(full,await fs.readFile(temp));}finally{await fs.rm(temp,{force:true});}
  await record(file);return full;
 }
 async function step(name,fn){if(state.steps[name])return state.steps[name];const value=await fn();state.steps[name]=value??true;await save();return state.steps[name];}
 async function openOperator(){
  if(page){await page.close({runBeforeUnload:false});page=null;}
  page=await context.newPage();page.on('dialog',d=>d.accept().catch(()=>{}));
  await page.goto(config.operatorUrl,{waitUntil:'load'});
  const select=page.locator('#workspace-select');await select.waitFor({state:'visible'});
  await page.waitForFunction(key=>Array.from(document.querySelectorAll('#workspace-select option')).some(x=>x.value===key),config.workspace);
  if(await select.inputValue()!==config.workspace)await select.selectOption(config.workspace);
  await page.locator('[data-view="economic-cost-ranges"]').click();
  await page.locator('[data-ecr-root]').waitFor({state:'visible'});
  const response=await page.evaluate(async workspace=>{const r=await fetch('/api/state?workspace='+encodeURIComponent(workspace)+'&compact=true');if(!r.ok)throw Error('Original workspace state failed');return r.json();},config.workspace);
  need(response.workspace_key===config.workspace&&response.data.project.id===config.projectId,'The rendered operator selected another original project.');
 }
 async function completeWorking(name){
  const full=await downloaded(name,()=>page.locator(act('working-download')).click());
  const packet=await read(full);need(packet.schema==='upstate.economic-browser-recovery/v1'&&packet.workspace_key===config.workspace&&packet.state.schema==='upstate.economic-cost-ranges-working/v1','Actual working download has another native schema/scope.');
  need(sha(Buffer.from(stable(packet.state)))===packet.sha256,'Actual working download hash differs.');
  return{full,packet};
 }
 async function verifyVisibleDefinition(expected){
  const event=page.waitForEvent('download');await page.locator(act('definition-download')).click();const download=await event;
  const temp=path.join(root,'.definition-read-'+randomUUID());await download.saveAs(temp);
  try{need(!await download.failure()&&same(await read(temp),expected),'The actual visible reopened definition differs from its retained original.');}finally{await fs.rm(temp,{force:true});}
 }
 async function importWorking(file,{pending=false}={}){
  const packet=await read(file);
  await page.locator('input[data-ecr-file="working"]').setInputFiles(file);
  if(pending){
   await page.locator('[data-ecr-result="'+config.previewSha256+'"] [data-ecr-download]').first().waitFor({state:'visible',timeout:180000});
  }else{
   await page.waitForFunction(value=>document.querySelector('[data-ecr-field="title"]')?.value===value,packet.state.definition.title);
   await verifyVisibleDefinition(packet.state.definition);
   const check=await completeWorking('working/Reopened_'+path.basename(file));
   need(same(check.packet.state.definition,packet.state.definition)&&same(check.packet.state.source,packet.state.source),'Reopened visible working copy differs from its actual original definition/source.');
  }
 }
 async function openSaved(){
  await page.locator(act('refresh')).click();
  const id=config.rangeId||config.previewSha256;
  const button=page.locator(act('saved')+'[data-id="'+id+'"]');await button.waitFor({state:'visible',timeout:180000});await button.click();
  await page.locator('[data-ecr-result="'+id+'"] [data-ecr-download]').first().waitFor({state:'visible'});
  const full=await completeWorking('working/Saved_'+id+'.json');
  need(full.packet.state.opened_id===id,'Rendered saved selection is not the original range identity.');
  return full.packet;
 }
 async function visibleScenarios(){
  const select=page.locator(field('run'));
  if(await select.count())for(const row of definition.rows){await select.selectOption(row.run_id);await page.waitForFunction(value=>document.querySelector('[data-ecr-field="run"]')?.value===value.id&&document.querySelector('[data-ecr-editor] h3')?.textContent===value.label,{id:row.run_id,label:row.label});await page.locator('[data-ecr-editor] details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));await screenshot('scenario-'+row.run_id);}
 }
 async function attachments(){
  const id=config.rangeId||config.previewSha256;
  const detail=await page.evaluate(async({workspace,id})=>{const r=await fetch('/api/economic-cost-ranges/detail?workspace='+encodeURIComponent(workspace)+'&id='+encodeURIComponent(id));if(!r.ok)throw Error('Original saved detail unavailable');return r.json();},{workspace:config.workspace,id});
  need(detail.id===id&&same(detail.definition,definition),'The actual rendered saved report differs from its authored source.');
  await keep(inside(root,'observations/Rendered_Saved_Detail.json'),bytes(detail));await record('observations/Rendered_Saved_Detail.json');
  const tickets=detail._downloads;need(Array.isArray(tickets)&&Array.isArray(detail.files),'Retain all original saved outputs.');
  for(const expected of detail.files){
   const ticket=tickets.find(x=>x.path===expected.path||path.basename(x.path||x.filename||'')===expected.path);
   need(ticket&&typeof ticket.url==='string','The original saved file has no visible native download ticket: '+expected.path);
   const absolute=new URL(ticket.url,origin).href;
   const anchors=page.locator('[data-ecr-result="'+id+'"] a[data-ecr-download]');
   let chosen=-1;for(let i=0;i<await anchors.count();i++)if(new URL(await anchors.nth(i).getAttribute('href'),origin).href===absolute){chosen=i;break;}
   need(chosen>=0,'The original attachment is missing from the actual operator.');
   const file='downloads/'+expected.path,full=await downloaded(file,()=>anchors.nth(chosen).click());
   const actual=await desc(root,file);need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'Actual browser attachment differs from the saved native file: '+expected.path);
   const row={...actual,original_file:expected.path};
   const old=state.downloads.find(x=>x.original_file===expected.path);if(old)need(same(old,row),'The earlier original download changed.');else state.downloads.push(row);
   await save();
   if(/\.(json|csv)$/.test(expected.path)){
    const raw=await fs.readFile(full,'utf8');
    const escaped=raw.replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    const view='attachment-views/'+expected.path+'.html';
    await keep(inside(root,view),'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+expected.path+'</title><style>body{color:#171717;background:white;font:15px/1.5 system-ui;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+expected.path+'</h1><p>Literal downloaded bytes: '+actual.sha256+'</p><pre>'+escaped+'</pre>');
    await record(view);
    const p=await context.newPage();try{await p.goto(pathToFileURL(inside(root,view)).href);await screenshot('attachment-'+expected.path,p);}finally{await p.close();}
   }
  }
  need(state.downloads.length===detail.files.length,'Inspect the complete saved attachment set.');
  const p=await context.newPage();
  try{
   await p.goto(pathToFileURL(inside(root,'downloads/index.html')).href,{waitUntil:'load'});
   await p.locator('h1').waitFor({state:'visible'});need(await p.locator('h1').innerText()===definition.title,'Downloaded report title differs from the authored comparison.');
   await p.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
   const reportText=await p.locator('body').innerText();need(reportText.includes(definition.edition_id),'Downloaded report omits its original source identity.');
   for(const row of definition.rows)need(reportText.includes(row.run_id),'Downloaded report omits an authored original scenario.');
   await screenshot('downloaded-report-desktop',p);await p.setViewportSize({width:390,height:844});await screenshot('downloaded-report-390',p);
  }finally{await p.close();}
 }

 async function archiveReports(){
  for(const [name,label]of [['original-economic-package.zip','original-economic'],['cost-ranges-package.zip','sourced-ranges']]){
   const source=state.downloads.find(d=>d.original_file===name);need(source,'Retain the actual complete original package '+name);
   const directory=inside(root,'archives/'+label),manifestFile=path.join(directory,'Archive_Opened_Members.json');
   let manifest;
   if(await exists(manifestFile)){manifest=await read(manifestFile);need(manifest.archive.sha256===source.sha256&&manifest.archive.bytes===source.bytes,'The opened archive selects other original bytes.');for(const d of manifest.members)await verify(directory,d);}
   else{
    need(config.python&&config.archiveInspector,'The original Python archive reader is required.');
    manifest=await new Promise((resolve,reject)=>{
     const child=spawn(config.python,['-B',config.archiveInspector,'--inspect-report-archive','--archive',inside(root,source.file),'--sha256',source.sha256,'--output',directory],{stdio:['ignore','pipe','pipe',lock],env:{...process.env,ECO_COST_RANGE_LOCK_FD:'3'}});
     archiveChild=child;let out='',err='',timed=false;
     const timer=setTimeout(()=>{timed=true;child.kill('SIGTERM');},120000);
     child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);
     child.on('error',e=>{clearTimeout(timer);archiveChild=null;reject(e);});
     child.on('close',code=>{clearTimeout(timer);archiveChild=null;if(code!==0||timed)return reject(Error('Original archive inspection did not finish: '+clean(err)));try{resolve(JSON.parse(out));}catch(e){reject(e);}});
    });
   }
   need(manifest.schema==='upstate.original-report-archive-inspection/v1','The original archive reader returned another format.');
   for(const d of manifest.members)await record('archives/'+label+'/'+d.file);
   await record('archives/'+label+'/Archive_Opened_Members.json');
   if(signalError)throw signalError;
   const report=await context.newPage();
   try{
    await report.goto(pathToFileURL(path.join(directory,'index.html')).href,{waitUntil:'load'});
    await report.locator('body').waitFor({state:'visible'});
    if(label==='original-economic'){
     const embedded=report.locator('#decision-report');await embedded.waitFor({state:'attached'});
     const actual=JSON.parse(await embedded.textContent()),original=await read(inside(root,'downloads/original-report.json'));
     need(same(actual,original),'The actually opened Economic archive report differs from its complete original report.');
     await report.waitForFunction(()=>document.body.innerText.trim().length>150);
    }else{
     await report.locator('h1').waitFor({state:'visible'});
     need(await report.locator('h1').innerText()===definition.title,'The extracted sourced-range report changed its title.');
    }
    await report.locator('details').evaluateAll(nodes=>nodes.forEach(n=>n.open=true));
    await screenshot('archive-'+label+'-desktop',report);await report.setViewportSize({width:390,height:844});await screenshot('archive-'+label+'-390',report);
    const links=await report.locator('a[href]').evaluateAll(nodes=>nodes.map((n,index)=>({index,href:n.href,raw:n.getAttribute('href'),download:n.hasAttribute('download'),label:n.textContent})));
    const observed=[];
    for(const link of links){
     const u=new URL(link.href);if(u.protocol!=='file:'||link.raw.startsWith('#'))continue;
     u.hash='';u.search='';const target=fileURLToPath(u);
     need(target.startsWith(directory+path.sep),'A declared archive link leaves its original package.');
     const relative=path.relative(directory,target).split(path.sep).join('/');
     const expected=manifest.members.find(d=>d.file===relative);need(expected,'A declared report link is missing from the complete archive: '+relative);
     if(link.download){
      const file='archive-downloads/'+label+'/'+relative;
      await downloaded(file,()=>report.locator('a[href]').nth(link.index).click(),report);
      const actual=await desc(root,file);need(actual.bytes===expected.bytes&&actual.sha256===expected.sha256,'A report-linked original attachment changed on download.');
      observed.push({...link,file,bytes:actual.bytes,sha256:actual.sha256});
     }else observed.push({...link,original_member:expected});
    }
    await json(inside(root,'observations/Archive_Links_'+label+'.json'),{archive:source,links,downloaded:observed});await record('observations/Archive_Links_'+label+'.json');
   }finally{await report.close();}
  }
 }

 try{
  const runtime=await playwright(),chromium=runtime.chromium||runtime.default?.chromium;need(chromium,'Existing Chromium API unavailable.');
  const options={headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},timeout:10000};if(config.executable)options.executablePath=path.resolve(config.executable);
  context=await chromium.launchPersistentContext(profile,options);
  owner.state='open';owner.browser_processes=await profileProcesses(profile);await json(ownerPath,owner,{replace:true});
  if(signalError)throw signalError;
  const watched=new WeakSet(),watch=p=>{if(watched.has(p))return;watched.add(p);p.on('pageerror',e=>errors.push({name:e.name,message:clean(e.message),stack:clean(e.stack||''),page:clean(p.url())}));};
  context.on('page',watch);for(const p of context.pages())watch(p);
  context.setDefaultTimeout(30000);context.setDefaultNavigationTimeout(60000);
  await fs.mkdir(path.join(root,'views'),{recursive:true});
  // Exact origin only: capability is never forwarded to an external attachment/source.
  await context.route('**/*',async route=>{
   try{
    const request=route.request(),u=new URL(request.url());
    if(u.origin!==origin){await route.continue();return;}
    const headers={...request.headers(),Authorization:'Bearer '+token};
    if(config.phase==='author'&&u.pathname==='/api/actions'&&request.method()==='POST'){
     const body=request.postDataJSON();
     if(body.action===ACTION&&body.workspace===config.workspace&&body.payload?.expected_preview_sha256===config.previewSha256){
      need(same(body.payload.definition,definition),'The browser attempted another authored definition.');
      if(state.request)need(same(body,state.request),'A recovery tried to replace the original save operation.');
      else{
       // The real UI has already frozen and retained this request. Export those exact bytes before send.
       const pending=await completeWorking('working/Pending_Original_Request.json');
       need(same(pending.packet.state.pending.payload,body.payload)&&pending.packet.state.pending.operation_id===body.operation_id,'The actual pending working file differs from the original outgoing request.');
       state.request=body;state.pending_working='working/Pending_Original_Request.json';await save();await json(inside(root,'observations/Original_Browser_Request.json'),body);await record('observations/Original_Browser_Request.json');
       const response=await route.fetch({headers}),raw=await response.body();
       await keep(inside(root,'observations/Original_Save_Response.json'),raw);await record('observations/Original_Save_Response.json');
       state.response_status=response.status();state.withheld=true;await save();
       await route.abort('failed');return;
      }
     }
    }
    await route.continue({headers});
   }catch(e){state.route_error={message:clean(e.message)};await save().catch(()=>{});try{await route.abort('failed');}catch{}}
  });
  await openOperator();
  if(config.phase==='author'&&await exists(inside(root,'working/Pending_Original_Request.json'))){
   const p=(await read(inside(root,'working/Pending_Original_Request.json'))).state.pending;
   need(p&&p.workspace===config.workspace&&p.action===ACTION&&same(p.payload.definition,definition)&&p.payload.expected_preview_sha256===config.previewSha256,'Retained original pending file names another request.');
   const original={workspace:p.workspace,action:p.action,operation_id:p.operation_id,payload:p.payload};
   if(state.request)need(same(state.request,original),'Original pending request identity changed.');
   state.request=original;state.pending_working='working/Pending_Original_Request.json';await save();await json(inside(root,'observations/Original_Browser_Request.json'),original);await record('observations/Original_Browser_Request.json');
  }
  if(config.phase==='author'){
   if(!state.request){
    await page.locator(field('edition')).selectOption(definition.edition_id);await page.locator(act('source')).click();
    await page.locator(field('title')).waitFor({state:'visible'});
    await page.locator('input[data-ecr-file="definition"]').setInputFiles(config.definitionPath);
    await page.waitForFunction(title=>document.querySelector('[data-ecr-field="title"]')?.value===title,definition.title);
    await step('unfinished-working',async()=>{
     if(!(await exists(inside(root,'working/Unfinished_Original_Working.json')))){await page.locator(field('title')).fill('');await completeWorking('working/Unfinished_Original_Working.json');}
     const original=await read(inside(root,'working/Unfinished_Original_Working.json'));need(original.state.definition.title==='','The retained unfinished title differs.');
     await openOperator();await importWorking(inside(root,'working/Unfinished_Original_Working.json'));await screenshot('unfinished-reopened');return{file:'working/Unfinished_Original_Working.json'};
    });
    await openOperator();
    // Reopen the retained exact draft before restoring the original authored title.
    await importWorking(inside(root,'working/Unfinished_Original_Working.json'));
    await page.locator(field('title')).fill(definition.title);
    const restored=await completeWorking('working/Prepared_Authored_Working.json');
    need(same(restored.packet.state.definition,definition),'Restoring the unfinished draft changed authored ranges.');
    await visibleScenarios();
    await page.locator(act('preview')).click();
    await page.locator('[data-ecr-result="'+config.previewSha256+'"] '+act('save')).waitFor({state:'visible'});
    await screenshot('preview-desktop');
    await page.locator(act('save')).click();
    const deadline=Date.now()+180000;while(!state.withheld&&!state.route_error&&Date.now()<deadline)await pause(100);
    need(!state.route_error&&state.withheld,'Original save did not reach retained lost-response boundary.');
   }
   need(state.request&&state.pending_working,'Retain the original pending working file before recovery.');
   await openOperator();await importWorking(inside(root,state.pending_working),{pending:true});
   const observed=await completeWorking('working/Completed_Original_Working.json');
   const receipt=observed.packet.state.receipts.find(x=>x.operation_id===state.request.operation_id&&x.range_id===config.previewSha256);
   need(receipt&&receipt.task_id,'The saved result lacks the original retained request receipt.');
   state.task_id=receipt.task_id;state.range_id=receipt.range_id;await save();
  }
  await openSaved();
  await screenshot('saved-desktop');await page.setViewportSize({width:390,height:844});await screenshot('saved-390');await page.setViewportSize({width:1440,height:1000});
  await attachments();
  await archiveReports();
  // Fresh-page read proves the saved result opens independently from its authoring copy.
  await openOperator();await openSaved();await screenshot('saved-fresh-reopen');
  need(!state.route_error,'An original request route failed.');
  if(errors.length){throw Error('The actual product raised uncaught page errors; preserve the recorded errors and correct the original source before declaring completion.');}
  if(signalError)throw signalError;
  state.observations={page_errors:errors,prior_route_errors:state.route_error_history||[],prior_page_errors:state.page_error_history||[],completed_at:new Date().toISOString()};await save();
 }catch(e){operationError=e;}
 finally{
  try{await close();}catch(e){closeError=e;}
  if(context&&!closeError&&(await profileProcesses(profile)).length)closeError=Error('Owned Chromium has not fully closed.');
  if(errors.length){state.page_error_history??=[];state.page_error_history.push(...errors);await save();}
  owner.state=closeError?'close-failed':context?'closed':'launch-ended';owner.error=operationError?clean(operationError.message):null;owner.close_error=closeError?clean(closeError.message):null;
  await json(ownerPath,owner,{replace:true});process.off('SIGTERM',term);process.off('SIGINT',int);
 }
 if(closeError)throw closeError;if(operationError)throw operationError;if(signalError)throw signalError;need(!errors.length,'Actual product raised uncaught page errors during closing.');
 need(context,'Actual browser phase did not run.');
 await json(inside(root,'observations/Browser_Lifecycle.json'),{closed:true,page_errors:errors,prior_route_errors:state.route_error_history||[],operation:config.operation,phase:config.phase});await record('observations/Browser_Lifecycle.json');
 const result={schema:SCHEMA,complete:true,closed:true,binding:config.binding,request:state.request,task_id:state.task_id,range_id:state.range_id||config.rangeId,downloads:state.downloads,artifacts:Object.values(state.artifacts),observations:state.observations};
 await json(resultPath,result);return result;
}
main().then(r=>process.stdout.write(JSON.stringify({complete:r.complete,range_id:r.range_id})+'\n'),e=>{process.stderr.write(JSON.stringify({error:e.message,state:'Retain original operation, private profile and exact pending request; reconcile before resume.'})+'\n');process.exitCode=2;});
