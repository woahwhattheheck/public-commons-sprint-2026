#!/usr/bin/env node
/** Actual ordinary-account portal -> same original source/results -> receiving. */
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
const require = (condition,message) => {if(!condition)throw new Error(message);};
const input=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const output=path.resolve(input.output_directory);
await fs.mkdir(output,{recursive:true,mode:0o700});
const stable=value=>Array.isArray(value)?'['+value.map(stable).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}':JSON.stringify(value);
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
const digest=value=>sha(stable(value)+'\n');
async function info(file){const raw=await fs.readFile(file);return {bytes:raw.length,sha256:sha(raw)};}
async function verify(file,expected){const value=await info(file);require(value.bytes===expected.bytes&&value.sha256===expected.sha256,'Original portal artifact changed: '+file);return value;}
async function read(file){try{return JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function publish(file,value){
 const raw=Buffer.from(stable(value)+'\n'),temporary=file+'.'+crypto.randomUUID()+'.tmp';
 await fs.mkdir(path.dirname(file),{recursive:true,mode:0o700});
 const handle=await fs.open(temporary,'wx',0o600);
 try {await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 try{await fs.link(temporary,file);}catch(e){if(e.code!=='EEXIST')throw e;require((await fs.readFile(file)).equals(raw),'The original portal browser publication differs: '+file);}
 finally{await fs.unlink(temporary).catch(()=>{});}
 const directory=await fs.open(path.dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}
const saved=await read(path.join(output,'browser-result.json'));
if(saved){
 require(saved.operation_id===input.operation_id&&saved.workspace_id===input.expected.workspace_id&&saved.input_sha256===digest(input),'The retained browser result has another original input.');
 for(const row of saved.files)await verify(path.join(output,row.path),row);
 process.stdout.write(JSON.stringify({state:'complete',replayed:true,result_file:path.join(output,'browser-result.json')})+'\n');
 process.exitCode=0;
}else{
 const browserModule=createRequire(path.join(path.resolve(input.playwright_directory),'package.json'))('playwright-core');
 const credentials=JSON.parse(await fs.readFile(input.credentials_file,'utf8'));
 const origin=new URL(input.base_url).origin,portalPath=input.portal_path;
 require(origin===input.base_url.replace(/\/$/,''),'Use one exact local portal origin.');
 const browser=await browserModule.chromium.launch({executablePath:input.chromium_executable,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 let stopping=false;
 const close=()=>{stopping=true;return browser.close();};
 process.on('SIGINT',close);process.on('SIGTERM',close);
 const files=[],inspectionFiles=[],requests=[],failures=[];let context,page,cfg,apiBase,prefix,activePhase=null,activeAction=null;
 try{
  context=await browser.newContext({viewport:{width:1440,height:1040},acceptDownloads:true});
  page=await context.newPage();
  page.on('pageerror',error=>failures.push({kind:'page',message:error.message}));
  page.on('response',response=>{const u=new URL(response.url());if(u.origin===origin&&response.status()>=400&&!u.pathname.includes('/api/'))failures.push({kind:'resource',status:response.status(),url:u.pathname});});
  async function login(target,role){
   const response=await target.goto(origin+input.login_path,{waitUntil:'domcontentloaded'});
   require(response?.ok(),'The real Tethys login page is unavailable.');
   await target.locator('[name="username"]').fill(credentials.accounts[role].username);
   await target.locator('[name="password"]').fill(credentials.accounts[role].password);
   await Promise.all([target.waitForURL(u=>!u.pathname.endsWith('/accounts/login/'),{timeout:30000}),target.locator('#login-submit').click()]);
  }
  async function json(url,options={}){
   const response=await context.request.fetch(origin+url,options);
   let value;try{value=await response.json();}catch{throw new Error('The original portal did not return JSON for '+url+' ('+response.status()+').');}
   if(!response.ok())throw new Error(value.error?.message||'Portal HTTP '+response.status());
   return value;
  }
  async function state(){return json(apiBase+'/state?project_id='+encodeURIComponent(input.expected.project_id));}
  async function operation(id){const r=await context.request.get(origin+apiBase+'/operations/'+encodeURIComponent(id));if(r.status()===404)return null;require(r.ok(),'Original operation readback failed.');return r.json();}
  async function go(route){
   require(!stopping,'The original portal browser is stopping.');
   if(page.url().split('#')[0]!==origin+portalPath)await page.goto(origin+portalPath,{waitUntil:'domcontentloaded'});
   await page.evaluate(route=>{location.hash=route;},route);
   await page.locator('#content').waitFor({state:'visible'});
   await page.waitForFunction(id=>document.querySelector('#workspace-identity')?.textContent.includes(id),input.expected.workspace_id);
   await page.waitForFunction(route=>{
    const content=document.querySelector('#content'),[section,id]=route.split('/');
    if(!content)return false;
    if(section==='sources'&&id)return Boolean(content.querySelector('[data-view-source="'+id+'"]'));
    if(section==='runs'&&id)return content.textContent.includes(id)&&content.textContent.includes('Complete native file closure');
    if(section==='reports'&&id)return content.textContent.includes(id)&&content.textContent.includes('Original report');
    const forms={overview:'project-create',compare:'comparison-select',receiving:'receiver-save',backup:'backup-create',history:'operation-read'};
    return forms[section]?Boolean(content.querySelector('#'+forms[section])):Boolean(document.querySelector('[data-nav="'+section+'"].active'));
   },route);
   require((await state()).workspace.id===input.expected.workspace_id,'The browser selected another original workspace.');
  }
  async function capture(name){
   const filename='screenshots/'+name+'.png',full=path.join(output,filename);
   await fs.mkdir(path.dirname(full),{recursive:true,mode:0o700});
   await page.screenshot({path:full,fullPage:true});
   inspectionFiles.push({path:filename,...await info(full),local_inspection_only:true});
  }
  await login(page,'operator');
  await page.goto(origin+input.home_path,{waitUntil:'networkidle'});
  require((await page.locator('body').innerText()).includes(credentials.accounts.operator.username),'The real portal launcher has another account.');
  await capture('01-portal-private-launcher');
  const opened=await page.goto(origin+portalPath,{waitUntil:'networkidle'});
  require(opened?.ok(),'The original private workspace URL did not open.');
  await page.waitForFunction(()=>Boolean(window.GROUNDWATER_CONFIG?.apiBase));
  cfg=await page.evaluate(()=>window.GROUNDWATER_CONFIG);
  apiBase=new URL(cfg.apiBase,origin).pathname;
  prefix='groundwater:'+origin+apiBase+':';
  require(cfg.actor===credentials.accounts.operator.username&&cfg.portal.workspaceId===input.expected.workspace_id&&cfg.portal.scope==='user','Actual account/bootstrap/private workspace binding differs.');
  require(cfg.csrfToken&&cfg.portal.permissions.configure_runtime===false&&cfg.portal.permissions.use_shared_workspace===false,'The ordinary account is not using its expected native permissions.');
  await page.locator('#project-select').selectOption(input.expected.project_id);
  await page.waitForFunction(id=>document.querySelector('#project-select')?.value===id,input.expected.project_id);
  await go('overview');await capture('02-original-workspace');

  // All business writes are observed and retained before the original route continues.
  await page.route(origin+apiBase+'/action',async route=>{
   try{
    const request=route.request().postDataJSON();
    require(activePhase&&request.action===activeAction,'An unselected portal write was attempted.');
    require(request.actor===cfg.actor,'The browser request has another actor.');
    const record={phase:activePhase,action:activeAction,operation_id:input.operation_id,workspace_id:input.expected.workspace_id,
                  dispatch_url:origin+apiBase+'/action',request};
    const file=path.join(output,'requests',activePhase+'.json');
    const prior=await read(file);
    require(!prior||stable(prior)===stable(record),'The original portal phase has another retained request.');
    await publish(file,record);
    await route.continue();
   }catch(error){failures.push({kind:'request',message:error.message});await route.abort();throw error;}
  });
  async function settled(original){
   const current=await state(),id=original.result.id;
   if(original.action==='report.deliver')return current.deliveries.find(x=>x.id===id)?.state==='complete';
   if(original.action.startsWith('backup.'))return current.backups.find(x=>x.id===id)?.status==='complete';
   return true;
  }
  async function perform(phase,action,formId,fill){
   activePhase=phase;activeAction=action;
   const requestFile=path.join(output,'requests',phase+'.json');
   let record=await read(requestFile),original=record?await operation(record.request.operation_id):null;
   if(original){
    require(stable(original.request)===stable(record.request),'The native result has a different original request.');
   }
   if(!original||!await settled(original)){
    if(record){
     const pending={request:record.request,dispatchUrl:record.dispatch_url,workspaceId:record.workspace_id,
                    file:null,formKey:'portal:'+phase,createdAt:'retained-original'};
     await page.evaluate(({prefix,pending})=>localStorage.setItem(prefix+'pending',JSON.stringify(pending)),{prefix,pending});
     await page.reload({waitUntil:'networkidle'});
     await page.locator('#retry-request').waitFor({state:'visible'});
     const response=page.waitForResponse(r=>r.url()===origin+apiBase+'/action'&&r.request().method()==='POST',{timeout:120000});
     await page.locator('#retry-request').click();
     const returned=await response;
     require(returned.ok(),'The original portal continuation returned HTTP '+returned.status()+'. Its exact request is retained.');
    }else{
     const form=page.locator('#'+formId);await form.waitFor({state:'visible'});await fill(form);
     const response=page.waitForResponse(r=>r.url()===origin+apiBase+'/action'&&r.request().method()==='POST',{timeout:120000});
     await form.locator('button[type="submit"]').click();
     const returned=await response;
     require(returned.ok(),'The original portal action returned HTTP '+returned.status()+'. Its exact request is retained.');
     record=await read(requestFile);require(record,'The selected browser request was not retained.');
    }
    original=await operation(record.request.operation_id);
    require(original&&stable(original.request)===stable(record.request),'The original portal operation is not yet authoritative; continue its same request.');
    require(await settled(original),'The original delivery or backup remains unfinished; continue its same request.');
   }
   require(original.request.actor===cfg.actor,'The original Store did not retain the authenticated account.');
   requests.push({id:original.id,phase,action:original.action,request_sha256:original.request_sha256,result_sha256:digest(original.result)});
   activePhase=null;activeAction=null;
   await page.reload({waitUntil:'networkidle'});
   return original.result;
  }
  const enter=(form,name,value)=>form.locator('[name="'+name+'"]').fill(String(value));
  const pick=(form,name,value)=>form.locator('[name="'+name+'"]').selectOption(String(value));

  const sourceId=input.expected.source_ids[0];
  await go('sources/'+sourceId);
  await page.locator('[data-view-source][data-path="publisher/examples/scripts/ex-gwf-twri.py"]').click();
  await page.locator('#source-viewer').waitFor({state:'visible'});
  require((await page.locator('#source-viewer-text').innerText()).length>0,'Original publisher source was not rendered.');
  await capture('03-original-publisher-source');
  for(const selected of input.expected.runs){
   await go('runs/'+selected.id);
   await page.locator('#content h2').first().waitFor({state:'visible'});
   require((await page.locator('#content').innerText()).includes(selected.id),'The actual original run did not render.');
  }
  await capture('04-native-results-and-units');
  await go('compare');
  const comparison=page.locator('#comparison-select');
  const last=input.expected.runs.at(-1),reference=input.expected.runs.find(x=>x.id!==last.id);
  await pick(comparison,'baseline_run_id',reference.id);await pick(comparison,'run_id',last.id);
  await comparison.locator('button[type="submit"]').click();
  await page.locator('#comparison-result').waitFor({state:'visible'});
  await capture('05-original-comparison');
  const reportId=input.expected.reports[0].id;
  await go('reports/'+reportId);await capture('06-frozen-report');
  const downloads=[];
  for(const format of ['zip','json','html','csv']){
   const link=page.locator('a[href*="/reports/'+reportId+'/export"][href$="format='+format+'"]').first();
   await link.waitFor({state:'visible'});
   const href=await link.getAttribute('href');
   require(href.startsWith(apiBase+'/reports/'+reportId+'/export'),'The report link lost its original bound API URL.');
   const response=await context.request.get(origin+href);
   require(response.ok(),'The selected original report export is unavailable.');
   const raw=await response.body(),filename='downloads/'+reportId+'.'+format;
   await fs.mkdir(path.dirname(path.join(output,filename)),{recursive:true,mode:0o700});
   const expected=input.report_formats[format];
   require(raw.length===expected.bytes&&sha(raw)===expected.sha256,'The original '+format+' report bytes changed.');
   await fs.writeFile(path.join(output,filename),raw,{mode:0o600});
   const row={path:filename,bytes:raw.length,sha256:sha(raw)};files.push(row);downloads.push({format,...row});
  }
  // Real server authorization and CSRF checks use no successful domain mutation.
  const beforePermissions=await state();
  const deniedRequest={action:'runtime.configure',actor:cfg.actor,operation_id:input.operation_id+'-denied-runtime',
                       expected_version:beforePermissions.workspace.version,payload:{}};
  const denied=await context.request.post(origin+apiBase+'/action',{data:deniedRequest,
      headers:{'Content-Type':'application/json','X-CSRFToken':cfg.csrfToken,'Origin':origin}});
  require(denied.status()===403,'The ordinary operator unexpectedly has runtime administration.');
  const noCsrf=await context.request.post(origin+apiBase+'/action',{data:{...deniedRequest,action:'receiver.save',operation_id:input.operation_id+'-no-csrf'},
      headers:{'Content-Type':'application/json','Origin':origin}});
  require(noCsrf.status()===403,'The native action accepted a missing CSRF token.');
  require((await state()).workspace.version===beforePermissions.workspace.version,'A denied request changed the original domain.');
  const foreign=await browser.newContext({viewport:{width:1300,height:900}});
  try{
   const foreignPage=await foreign.newPage();await login(foreignPage,'reader');
   await foreignPage.goto(origin+input.home_path,{waitUntil:'domcontentloaded'});
   const answer=await foreign.request.get(origin+apiBase+'/state');
   const error=await answer.json();
   require(answer.status()===409&&error.error?.code==='portal_principal_changed','A different account opened the original private workspace binding.');
  }finally{await foreign.close();}

  let receiver,delivery,acknowledgment,backup;
  if(input.reopen_only){
   await verify(input.original_browser_result.path,input.original_browser_result);
   const original=await read(input.original_browser_result.path);
   require(original.operation_id===input.operation_id&&original.workspace_id===input.expected.workspace_id,'The stopped portal reopen has another original outcome.');
   receiver={id:original.receiver_id};delivery={id:original.delivery_id};acknowledgment={id:original.acknowledgment_id};backup={id:original.backup_id};
   for(const item of original.operations){
    const retained=await operation(item.id);
    require(retained&&retained.request_sha256===item.request_sha256&&digest(retained.result)===item.result_sha256,'The reopened original operation changed.');
    requests.push(item);
   }
   await go('receiving');await capture('07-reopened-private-receiving');
  }else{
  await go('receiving');
  receiver=await perform('receiver','receiver.save','receiver-save',async form=>{
   await enter(form,'name','Ordinary portal operator technical receiving');
   await enter(form,'directory',cfg.receiverDirectory);
  });
  await go('receiving');
  delivery=await perform('delivery','report.deliver','report-deliver',async form=>{
   await pick(form,'report_id',reportId);await pick(form,'receiver_id',receiver.id);
   await enter(form,'reason','Actual local Tethys demonstration: receive the exact original frozen groundwater report in this account’s private Paths directory.');
  });
  await go('receiving');
  acknowledgment=await perform('acknowledgment','delivery.acknowledge','delivery-acknowledge',async form=>{
   await pick(form,'id',delivery.id);await pick(form,'decision','accepted');
   await enter(form,'by',cfg.actor);await enter(form,'occurred_on',new Date().toISOString());
   await enter(form,'reference',input.operation_id+'/local-portal-receiving');
   await enter(form,'reason','The local demonstration operator verified the complete original package, declared units, original source and native outputs. This records technical receipt in this portal, with no customer, field-calibration or production-tenant acceptance.');
  });
  await go('receiving');await capture('07-private-delivery-and-decision');
  await go('backup');
  backup=await perform('backup','backup.create','backup-create',async form=>{
   await enter(form,'reason','Complete same-workspace backup after ordinary Tethys account receiving; preserve original native runs, reports and both original and portal operations.');
  });
  }
  const backupResponse=await context.request.get(origin+apiBase+'/backups/'+backup.id+'/download');
  require(backupResponse.ok(),'The continued original workspace backup is unavailable.');
  const backupRaw=await backupResponse.body(),backupFile='downloads/portal-workspace-backup.zip';
  await fs.writeFile(path.join(output,backupFile),backupRaw,{mode:0o600});
  const backupRow=(await state()).backups.find(x=>x.id===backup.id);
  require(backupRow?.status==='complete'&&backupRow.bytes===backupRaw.length&&backupRow.sha256===sha(backupRaw),'The portal backup download differs from its original recorded file.');
  files.push({path:backupFile,bytes:backupRaw.length,sha256:sha(backupRaw)});
  await go('history');
  const historyForm=page.locator('#operation-read');
  await enter(historyForm,'operation_id',input.expected.operations[0].id);
  await historyForm.locator('button[type="submit"]').click();
  await page.locator('#operation-result').waitFor({state:'visible'});await capture('08-original-operation-reopen');
  await page.reload({waitUntil:'networkidle'});await go('reports/'+reportId);await capture('09-reopened-original-report');
  const finalState=await state();
  require(finalState.runs.length===input.expected.runs.length&&finalState.runs.every(x=>input.expected.runs.some(y=>y.id===x.id)),'Portal receiving introduced another native run.');
  require(failures.length===0,'The actual portal/browser returned an unclosed script or resource error: '+JSON.stringify(failures));
  if(!input.reopen_only)for(const original of requests){
   const file='requests/'+original.phase+'.json';
   files.push({path:file,...await info(path.join(output,file))});
  }
  const result={schema:'groundwater.tethys-browser-result.v1',state:'complete',operation_id:input.operation_id,
      input_sha256:digest(input),reopen_only:Boolean(input.reopen_only),workspace_id:input.expected.workspace_id,actor:cfg.actor,portal_path:portalPath,api_base:apiBase,
      accounts:{operator:input.accounts.operator,reader:input.accounts.reader},
      source_ids:input.expected.source_ids,run_ids:input.expected.runs.map(x=>x.id),report_id:reportId,
      receiver_id:receiver.id,delivery_id:delivery.id,acknowledgment_id:acknowledgment.id,backup_id:backup.id,
      operations:requests,downloads,permission_checks:{ordinary_operator:true,runtime_administration_denied:true,
      csrf_required:true,other_account_private_binding_denied:true},native_runs_started:0,
      technical_receiving_only:true,customer_acceptance:false,files,inspection_files:inspectionFiles,completed_at:new Date().toISOString()};
  await context.close();context=null;await browser.close();
  process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);
  await publish(path.join(output,'browser-result.json'),result);
  process.stdout.write(JSON.stringify({state:'complete',result_file:path.join(output,'browser-result.json')})+'\n');
 }finally{
  if(context)await context.close().catch(()=>{});
  await browser.close().catch(()=>{});
  process.removeListener('SIGINT',close);process.removeListener('SIGTERM',close);
 }
}
