#!/usr/bin/env node
/** The actual original operator at desktop/narrow widths, exact replay and cold reopening. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const args={};for(let i=2;i<process.argv.length;i+=2)args[process.argv[i].replace(/^--/,'')]=process.argv[i+1];
for(const name of ['config','author-connection','receiver-connection','output','browser','playwright','profile'])if(!args[name])throw Error('Supply --'+name);
const bytes=await fs.readFile(args.config),config=JSON.parse(bytes),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
const selectionSHA=sha(bytes),out=path.resolve(args.output),base=path.dirname(path.resolve(args.config));
const canonical=x=>x===null||typeof x!=='object'?JSON.stringify(x):Array.isArray(x)?'['+x.map(canonical).join(',')+']':'{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+canonical(x[k])).join(',')+'}';
const same=(a,b)=>canonical(a)===canonical(b);
await fs.mkdir(out,{recursive:true});
const attempt='attempt-'+crypto.randomUUID();
async function retained(relative,body){if(relative!=='result.json')relative=attempt+'/'+relative;const target=path.join(out,relative);await fs.mkdir(path.dirname(target),{recursive:true});try{const old=await fs.readFile(target);if(!old.equals(body))throw Error('Retained browser artifact differs: '+relative);}catch(e){if(e.code!=='ENOENT')throw e;await fs.writeFile(target,body,{flag:'wx'});}return {path:relative,bytes:body.length,sha256:sha(body)};}
async function verify(item){const body=await fs.readFile(path.join(out,item.path));if(body.length!==item.bytes||sha(body)!==item.sha256)throw Error('Original browser artifact changed: '+item.path);}
let prior;try{prior=JSON.parse(await fs.readFile(path.join(out,'result.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(prior){if(prior.state!=='complete'||prior.selection_sha256!==selectionSHA)throw Error('This browser output belongs to another original selected study.');for(const file of prior.files)await verify(file);process.stdout.write(JSON.stringify(prior)+'\n');process.exit(0);}
const ownerPath=path.join(out,'.browser-owner.json');let owner;
const profilePath=path.resolve(args.profile),browserExecutable=await fs.realpath(args.browser);
async function actualProfileBrowsers(){
 const rows=[];
 for(const name of await fs.readdir('/proc')){
  if(!/^\d+$/.test(name))continue;
  try{
   const identity=await proc(name);if(!identity||identity.state==='Z')continue;
   const argv=(await fs.readFile('/proc/'+name+'/cmdline')).toString('utf8').split('\0').filter(Boolean);
   const flag=argv.indexOf('--user-data-dir'),selected=argv.includes('--user-data-dir='+profilePath)||(flag>=0&&argv[flag+1]===profilePath);
   if(selected&&await fs.realpath('/proc/'+name+'/exe')===browserExecutable)rows.push({...identity,argv,profile:profilePath,executable:browserExecutable});
  }catch(e){if(!['ENOENT','ESRCH','EACCES'].includes(e.code))throw e;}
 }
 return rows;
}
async function proc(pid){try{const text=await fs.readFile('/proc/'+pid+'/stat','utf8'),fields=text.slice(text.lastIndexOf(')')+2).split(' ');return {pid:Number(pid),state:fields[0],pgid:Number(fields[2]),start_ticks:fields[19]};}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}}
try{
 const old=JSON.parse(await fs.readFile(ownerPath,'utf8'));
 if(old.selection_sha256!==selectionSHA||!Number.isInteger(old.pid)||!old.start_ticks)throw Error('Retain the exact original browser owner identity.');
 const live=await proc(old.pid);if(live&&live.start_ticks===old.start_ticks&&live.state!=='Z')throw Error('The original browser is still alive.');
 if(!live||live.start_ticks===old.start_ticks)for(const name of await fs.readdir('/proc'))if(/^\d+$/.test(name)){const member=await proc(name);if(member&&member.pgid===old.pid&&member.state!=='Z')throw Error('The original browser process group still owns this continuation.');}
 if((await actualProfileBrowsers()).length)throw Error('The exact original detached Chromium still owns this private profile; reconcile it through the original course.');
 await fs.rename(ownerPath,path.join(out,attempt+'-retired-owner.json'));
}catch(e){if(e.code!=='ENOENT')throw e;}
try{owner=await fs.open(ownerPath,'wx',0o600);}catch(e){throw Error('The existing browser course has an owner file. Reconcile that exact original process before continuation: '+e.message);}
const self=await proc(process.pid);
await owner.writeFile(JSON.stringify({pid:process.pid,start_ticks:self.start_ticks,selection_sha256:selectionSHA}));
let chromium;
let context=null,closePromise=null,interrupted=false,routeError=null,closed=false;
const files=[],observations=[],errors=[];
async function close(){
 if(!context){closed=true;return;}if(closePromise)return closePromise;
 closePromise=(async()=>{
  await context.close();
  const until=Date.now()+10000;
  while((await actualProfileBrowsers()).length){if(Date.now()>=until)throw Error('The owned detached Chromium has not exited.');await new Promise(resolve=>setTimeout(resolve,100));}
  closed=true;
 })();return closePromise;
}
const signal=()=>{interrupted=true;if(context)void close().catch(e=>errors.push('Browser close: '+e.message));};
process.on('SIGTERM',signal);process.on('SIGINT',signal);
async function capture(page,name){
 if(interrupted)throw Error('Original browser course was interrupted.');
 const image=await page.screenshot({fullPage:true});files.push(await retained(name+'.png',image));
 const body=await page.locator('body').innerText();files.push(await retained(name+'.txt',Buffer.from(body)));
}
async function clickDownload(page,locator,relative,expected){
 const event=page.waitForEvent('download');await locator.click();const download=await event;
 const temp=path.join(out,'.download-'+crypto.randomUUID());await download.saveAs(temp);
 const body=await fs.readFile(temp);await fs.unlink(temp);
 if(expected&&(body.length!==expected.bytes||sha(body)!==expected.sha256))throw Error('The actual clicked download differs from its original source: '+relative);
 const descriptor=await retained(relative,body);files.push(descriptor);return {descriptor,body};
}
async function field(page,selector,value){await page.locator(selector).fill(String(value??''));}
async function authorDefinition(page){
 const s=config.definition;
 await field(page,'#extent-title',s.title);await field(page,'#extent-reason',s.reason);
 await page.locator('#extent-baseline').selectOption(s.baseline_run_id);
 await page.locator('#extent-source').selectOption(JSON.stringify([s.stream_source.source_collection_id,s.stream_source.source_id]));
 await field(page,'#extent-layer',s.stream_source.layer||'');
 await page.getByRole('button',{name:'Inspect original layers and fields',exact:true}).click();
 await page.locator('#extent-source-preview').getByText('Original field',{exact:true}).waitFor();
 for(const [name,value]of Object.entries(s.stream_source.where||{})){
  await page.locator('[data-filter-add="shared"]').click();
  const row=page.locator('.extent-filter').filter({has:page.locator('[data-where="shared"]')}).last();
  await row.locator('[data-friendly="field"]').fill(name);
  await row.locator('[data-friendly="type"]').selectOption(value===null?'null':typeof value);
  if(value!==null)await row.locator('[data-friendly="value"]').fill(String(value));
 }
 for(let index=0;index<s.placements.length;index++){
  const placement=s.placements[index];await page.locator('#extent-add-placement').click();
  await page.locator('[data-friendly="id"][data-placement="'+index+'"]').fill(placement.id);
  await page.locator('[data-friendly="title"][data-placement="'+index+'"]').fill(placement.title);
  for(const [name,value]of Object.entries(placement.where||{})){
   await page.locator('[data-filter-add="placement"][data-placement="'+index+'"]').click();
   const row=page.locator('fieldset').filter({has:page.locator('[data-friendly="id"][data-placement="'+index+'"]')}).locator('.extent-filter').last();
   await row.locator('[data-friendly="field"]').fill(name);await row.locator('[data-friendly="type"]').selectOption(value===null?'null':typeof value);
   if(value!==null)await row.locator('[data-friendly="value"]').fill(String(value));
  }
 }
 await field(page,'#extent-widths',s.widths_m.join(', '));await field(page,'#extent-from',s.from_codes.join(', '));
 await field(page,'#extent-to',s.to_code);await page.locator('#extent-scope').selectOption(s.scope);
}
async function open(page,connection,workspace){
 await page.goto(connection.operator_url,{waitUntil:'domcontentloaded'});
 const nav=page.locator('[data-view="restoration-extents"]');await nav.waitFor({timeout:30000});await nav.click();
 await page.locator('#extent-prepare').waitFor();
 await page.waitForFunction(()=>document.querySelector('#extent-baseline')?.options.length>1);
 const identity=await page.evaluate(async({workspace,token})=>{
  const response=await fetch('/api/restoration-extents/catalog?'+new URLSearchParams({workspace}),{headers:{Authorization:'Bearer '+token}});
  if(!response.ok)throw Error('Cannot read the original extension catalogue.');return response.json();
 },{workspace,token:new URLSearchParams(new URL(connection.operator_url).hash.slice(1)).get('token')});
 if(identity.project.id!==config.project_id||identity.workspace_key!==workspace)throw Error('The actual browser opened another original project.');
 await page.locator('[data-study="'+config.study_id+'"]').click();
 await page.locator('#extent-selected code').filter({hasText:config.report.id}).first().waitFor();
 return identity;
}
async function reviewPage(page,label,connection,workspace){
 const catalog=await open(page,connection,workspace);
 await capture(page,label+'/desktop-study');
 await page.setViewportSize({width:390,height:844});await capture(page,label+'/phone-study');
 const errorsOnPage=await page.locator('#extent-error').innerText();if(errorsOnPage.trim())throw Error(errorsOnPage);
 await page.setViewportSize({width:1440,height:1000});
 await page.getByRole('button',{name:'Refresh retained run states',exact:true}).click();
 await page.locator('#extent-selected code').filter({hasText:config.report.id}).first().waitFor();
 for(const [kind,expected]of Object.entries(config.report_files)){
  const name=path.basename(expected.path);
  const clicked=await clickDownload(page,page.locator('#extent-report-output a').filter({hasText:name}).first(),label+'/downloads/'+name,expected);
  if(name.endsWith('.html')){
   const reportPage=await context.newPage();
   try{
    await reportPage.goto(pathToFileURL(path.join(out,clicked.descriptor.path)).href);
    await reportPage.getByRole('heading',{name:'All selected scenarios and support',exact:true}).waitFor();
    if(await reportPage.locator('table').count()<2)throw Error('The actual downloaded native report lacks its complete response tables.');
    await capture(reportPage,label+'/report-desktop');
    await reportPage.setViewportSize({width:390,height:844});await capture(reportPage,label+'/report-phone');
   }finally{await reportPage.close();}
  }else{
   const attachment=await context.newPage();
   try{
    const exactText=clicked.body.toString('utf8').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
    await attachment.setContent('<!doctype html><meta charset="utf-8"><style>body{background:#fff;color:#171717;font:15px/1.5 monospace;margin:24px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><pre>'+exactText+'</pre>');
    await capture(attachment,label+'/attachment-'+kind);
   }finally{await attachment.close();}
  }
 }
 observations.push({workspace,label,study_id:config.study_id,report_id:config.report.id,
  completed_effective_runs:config.study.execution_run_ids,files:Object.keys(config.report_files),
  catalog_studies:catalog.studies.map(s=>s.id)});
}
try{
 ({chromium}=await import(pathToFileURL(path.resolve(args.playwright)).href));
 context=await chromium.launchPersistentContext(path.resolve(args.profile),{
  executablePath:path.resolve(args.browser),headless:true,acceptDownloads:true,
  viewport:{width:1440,height:1000},timeout:10000,args:['--no-sandbox','--disable-dev-shm-usage']});
 if(interrupted)throw Error('Original browser startup was interrupted.');
 const actualBrowsers=await actualProfileBrowsers();
 if(!actualBrowsers.length)throw Error('The actual owned Chromium executable/profile identity is unavailable.');
 await fs.writeFile(path.join(path.dirname(profilePath),attempt+'-chromium-processes.json'),JSON.stringify({selection_sha256:selectionSHA,browsers:actualBrowsers},null,2)+'\n',{flag:'wx',mode:0o600});
 const author=JSON.parse(await fs.readFile(args['author-connection'],'utf8'));
 const receiver=JSON.parse(await fs.readFile(args['receiver-connection'],'utf8'));
 for(const c of [author,receiver]){
  const u=new URL(c.operator_url);if(u.protocol!=='http:'||u.hostname!=='127.0.0.1')throw Error('Use the original loopback operator connection.');
 }
 let lost=false,accepted=null,reportAttempts=0,routeFinishedResolve=null;
 let routeFinished=new Promise(resolve=>{routeFinishedResolve=resolve;});
 await context.route('**/api/**',async route=>{
  let selectedRoute=false;
  try{
   const request=route.request(),url=new URL(request.url());
   if(request.method()!=='POST'){await route.continue();return;}
   if(url.pathname==='/api/session'){await route.continue();return;}
   // Navigation-state saves are outside this scientific receiving operation.
   if(url.pathname==='/api/operator-session'){await route.abort('blockedbyclient');return;}
   if(url.pathname==='/api/actions'&&url.origin===author.origin){
    const body=request.postDataJSON();
    if(!same(body,config.report_request))throw Error('Browser attempted a different scientific operation.');
    selectedRoute=true;reportAttempts++;
    if(!lost){lost=true;const response=await route.fetch();accepted=await response.json();
     if(!response.ok()||accepted.state!=='complete'||accepted.result?.id!==config.report.id)throw Error('Original report replay did not return its saved completion.');
     await route.abort('failed');return;}
    await route.continue();return;
   }
   throw Error('This receiving course did not authorize another mutation: '+url.pathname);
  }catch(e){routeError=e.message;await route.abort('failed').catch(()=>{});}
  finally{if(selectedRoute)routeFinishedResolve?.();}
 });
 const page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 await open(page,author,config.author_workspace);
 await page.getByRole('button',{name:'New study',exact:true}).click();
 await authorDefinition(page);
 const workingDownload=await clickDownload(page,page.locator('#extent-backup'),'author/Restoration_Authored_Working.json');
 const working=JSON.parse(workingDownload.body);
 const normalized=x=>({...x,stream_source:{...x.stream_source,where:x.stream_source.where||{}},placements:x.placements.map(p=>({...p,where:p.where||{}}))});
 if(!same(normalized(working.spec),normalized(config.definition)))throw Error('Ordinary source controls did not preserve the authored scientific selection.');
 const beforeImport=await page.evaluate(workspace=>sessionStorage.getItem('upstate-restoration-last:'+workspace),config.author_workspace);
 await page.locator('#extent-import').setInputFiles({name:'Restoration_Authored_Working.json',mimeType:'application/json',buffer:workingDownload.body});
 await page.waitForFunction(({title,workspace,before})=>sessionStorage.getItem('upstate-restoration-last:'+workspace)!==before&&document.querySelector('#extent-title')?.value===title,{title:config.definition.title,workspace:config.author_workspace,before:beforeImport});
 await capture(page,'author/working-desktop');
 await page.setViewportSize({width:390,height:844});await capture(page,'author/working-phone');await page.setViewportSize({width:1440,height:1000});
 const pending={...working,id:crypto.randomUUID(),selected_study_id:config.study_id,
  pending:{request:config.report_request,attempts:[],last_error:null,created_at:new Date().toISOString()}};
 const pendingBody=Buffer.from(JSON.stringify(pending,null,2)+'\n');
 files.push(await retained('author/Original_Report_Pending_Working.json',pendingBody));
 await page.locator('#extent-import').setInputFiles({name:'Original_Report_Pending_Working.json',mimeType:'application/json',buffer:pendingBody});
 await page.locator('#extent-replay:visible').waitFor();
 await page.locator('#extent-replay').click();
 let timeout;try{await Promise.race([routeFinished,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Original response interruption did not settle.')),45000);})]);}finally{clearTimeout(timeout);}
 if(routeError||!accepted)throw Error(routeError||'The original report response was not received before interruption.');
 await page.locator('#extent-error').filter({hasText:'exact original request'}).waitFor();
 await capture(page,'author/original-lost-response');
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('[data-view="restoration-extents"]').click();
 await page.locator('#extent-replay:visible').waitFor();
 await page.locator('#extent-replay').click();
 await page.waitForFunction(()=>document.querySelector('#extent-pending')?.textContent==='No unresolved original request.');
 if(reportAttempts!==2)throw Error('Expected the same original report replay exactly twice.');
 if(routeError)throw Error(routeError);
 await reviewPage(page,'author',author,config.author_workspace);
 const finalWorking=await clickDownload(page,page.locator('#extent-backup'),'author/Restoration_Complete_Working.json');
 const finalValue=JSON.parse(finalWorking.body);
 if(finalValue.pending||!finalValue.history.some(r=>r.task?.result?.id===config.report.id))throw Error('The completed working copy lacks the exact original result.');
 await page.close();
 const receivedPage=await context.newPage();receivedPage.on('pageerror',e=>errors.push(e.message));
 await reviewPage(receivedPage,'receiving',receiver,config.receiver_workspace);
 await receivedPage.reload({waitUntil:'domcontentloaded'});
 await receivedPage.locator('[data-view="restoration-extents"]').click();
 await receivedPage.locator('[data-study="'+config.study_id+'"]').click();
 await receivedPage.locator('#extent-selected code').filter({hasText:config.report.id}).first().waitFor();
 await capture(receivedPage,'receiving/plain-reopen');
 await receivedPage.close();
 if(interrupted||routeError||errors.length)throw Error(routeError||errors.join('; ')||'Original browser operation interrupted.');
 await close();
 if(!closed)throw Error('The owned browser did not confirm closure.');
 const result={schema:'upstate.restoration-extent-browser-result/v1',state:'complete',
  selection_sha256:selectionSHA,project_id:config.project_id,study_id:config.study_id,
  report_id:config.report.id,report_replay_task_id:accepted.id,report_replay_attempts:reportAttempts,
  observations,files};
 await retained('result.json',Buffer.from(JSON.stringify(result,null,2)+'\n'));
 process.stdout.write(JSON.stringify(result)+'\n');
}catch(e){
 await fs.writeFile(path.join(out,'interruption.json'),JSON.stringify({state:'interrupted',selection_sha256:selectionSHA,error:e.message,route_error:routeError,files},null,2)+'\n');
 throw e;
}finally{
 let closeError;
 try{await close();}catch(e){closeError=e;await fs.writeFile(path.join(out,'closure-error.txt'),String(e.stack||e));}
 if(closed){await owner.close();await fs.unlink(ownerPath);}
 if(closeError)throw closeError;
}
