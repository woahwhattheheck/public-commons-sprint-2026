// MIT. Actual registered Grant Operations browser receiving; no substitute API.
import {readFile,writeFile,mkdir,rename,open,stat} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {validateArchive} from './operations_gravitee_model.mjs';
const [inputPath,accessPath]=process.argv.slice(2);
const input=JSON.parse(await readFile(inputPath,'utf8')),access=JSON.parse(await readFile(accessPath,'utf8'));
const root=resolve(input.directory),out=join(root,'artifacts'),reportPath=join(root,'Gravitee_Source_Desk_Browser.json');
await mkdir(out,{recursive:true,mode:0o700});
const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const same=(a,b)=>canonical(a)===canonical(b);
const need=(v,m)=>{if(!v)throw Error(m);};
const pretty=v=>JSON.stringify(v,null,2)+'\n';
const exists=async p=>{try{return (await stat(p)).isFile();}catch(e){if(e.code==='ENOENT')return false;throw e;}};
async function replace(path,body){const temp=path+'.tmp';const h=await open(temp,'w',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}await rename(temp,path);}
async function exact(path,body){if(await exists(path)){need((await readFile(path)).equals(Buffer.from(body)),'Preserve the exact original '+basename(path));return;}const h=await open(path,'wx',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}}
async function receipt(path){const b=await readFile(path);return {path,bytes:b.length,sha256:sha(b)};}
const report=await exists(reportPath)?JSON.parse(await readFile(reportPath,'utf8')):{schema:'stellar-forge.gravitee-source-desk-browser.v1',inputSha256:input.inputSha256,state:'PREPARED',phases:{},artifacts:{},requests:{},session:null};
need(report.inputSha256===input.inputSha256,'Resume the same whole original source input.');
let saveTail=Promise.resolve(),context,page,failure,closed=false;
function save(){const body=pretty(report);saveTail=saveTail.then(()=>replace(reportPath,body));return saveTail;}
async function remember(path){report.artifacts[basename(path)]=await receipt(path);await save();return path;}
async function keep(name,body){const path=join(out,name);await exact(path,body);return remember(path);}
const sessionKey='sf47.installations.'+input.caseId,prefix='/api/operations/'+input.caseId;
async function snapshot(){if(page&&!page.isClosed()){report.session=await page.evaluate(key=>sessionStorage.getItem(key),sessionKey);await save();}}
async function api(path,body){const response=await context.request.fetch(access.origin+path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+access.token,'Content-Type':'application/json'},data:body===undefined?undefined:JSON.stringify(body)});const value=await response.json();need(response.ok(),value.message||value.error?.message||'Original native request failed.');return value;}
async function idle(){
 await page.waitForFunction(()=>document.querySelector('.gravitee-source-desk')?.getAttribute('aria-busy')!=='true'&&document.querySelector('.installation-desk')?.getAttribute('aria-busy')!=='true',null,{timeout:60000});
 const errors=await page.locator('.gravitee-source-desk [role="alert"],.installation-message[role="alert"]').allTextContents();
 need(!errors.some(x=>x.trim()),errors.filter(Boolean).join('\n'));
}
async function click(action){await page.locator('[data-gv-action="'+action+'"]').click();await idle();await snapshot();}
async function stage(name,fn){if(report.phases[name])return;await fn();await snapshot();report.phases[name]={completedAt:new Date().toISOString()};await save();}
async function image(name){
 const path=join(out,name+'.png');await page.screenshot({path,fullPage:true});await remember(path);
}
async function capture(name){
 await page.setViewportSize({width:1440,height:1000});await image(name+'-desktop');
 await page.setViewportSize({width:390,height:844});await image(name+'-narrow');
 need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+2),'The actual narrow page overflows horizontally.');
 await page.setViewportSize({width:1440,height:1000});
}
async function download(action,name){
 const path=join(out,name);
 if(await exists(path)){await remember(path);return path;}
 const pending=page.waitForEvent('download');await click(action);const d=await pending;
 need(!await d.failure(),'The original full download failed.');await d.saveAs(path);return remember(path);
}
async function navigate(){
 await page.goto(access.origin+'/#access='+access.token,{waitUntil:'domcontentloaded'});
 await page.locator('#workbench').waitFor({state:'visible'});
 const plans=page.locator('#plan-select');if(await plans.inputValue()!==input.planId)await plans.selectOption(input.planId);
 await page.locator('[data-tab="operations"]').click();
 const cases=page.locator('select[name="caseSelect"]');await cases.waitFor({state:'visible'});
 if(await cases.inputValue()!==input.caseId)await cases.selectOption(input.caseId);
 need(await cases.inputValue()===input.caseId,'The browser selected another original case.');
 await page.locator('input[name="recordingActor"]').fill(input.actor);
 const nav=page.locator('[data-ops-navigation]'),toggle=nav.locator('[data-nav-toggle]');
 if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')==='false')await toggle.click();
 const group=nav.locator('details[data-nav-group]:has([data-nav-section="installations"])');
 if(await group.getAttribute('open')===null)await group.locator(':scope > summary').click();
 await group.locator('[data-nav-section="installations"]').click();await idle();
}
async function installationSession(){return page.evaluate(key=>JSON.parse(sessionStorage.getItem(key)||'null'),sessionKey);}
try{
 const imported=await import(pathToFileURL(input.playwright).href),chromium=imported.chromium??imported.default?.chromium;
 context=await chromium.launchPersistentContext(join(root,'browser-profile'),{executablePath:input.chromium,headless:true,acceptDownloads:true,viewport:{width:1440,height:1000},args:['--no-sandbox','--disable-dev-shm-usage'],timeout:60000});
 context.setDefaultTimeout(45000);
 if(report.session)await context.addInitScript(({key,value,origin})=>{if(location.origin===origin&&!sessionStorage.getItem(key))sessionStorage.setItem(key,value);},{key:sessionKey,value:report.session,origin:access.origin});
 page=context.pages()[0]??await context.newPage();
 await context.route(access.origin+prefix+'/command',async route=>{
  const request=route.request(),body=JSON.parse(request.postData()||'null');
  need(body&&['source.add','installation.save'].includes(body.action),'This receiving course only sends its selected original source/Installation commands.');
  const id=body.requestId,prior=report.requests[id];
  if(prior)need(same(prior.body,body),'Keep the exact original command body.');
  else {report.requests[id]={body,state:'PENDING'};await snapshot();await save();}
  const response=await route.fetch(),raw=await response.body();let result;try{result=JSON.parse(raw);}catch{}
  report.requests[id]={body,state:response.ok()?'RECORDED':'REJECTED',status:response.status(),result};
  await save();await route.fulfill({response,body:raw});await response.dispose();
 });
 page.on('pageerror',e=>{report.pageErrors??=[];report.pageErrors.push(e.message);});
 report.state='RUNNING';await save();
 for(const artifact of Object.values(report.artifacts))need(same(await receipt(artifact.path),artifact),'A retained complete browser artifact changed.');
 await navigate();
 // Reconcile the exact original request after a lost HTTP response before any replacement.
 for(const item of Object.values(report.requests).filter(x=>x.state==='PENDING')){
  const result=await api(prefix+'/command',item.body);item.result=result;item.state='RECORDED';await save();
 }
 const nativeRecovery=page.locator('[data-installation-action="recover"]');
 if(await nativeRecovery.count()){await nativeRecovery.click();await idle();await snapshot();}
 await stage('01-original-commercial-draft',async()=>{
  let s=await installationSession(),d=s?.drafts?.[s.draftKey];
  if(!d||d.installationId!==null||!same(d.document,input.document)){
   await page.locator('[data-installation-action="new"]').click();await idle();
   await page.locator('[data-installation-file]').setInputFiles(input.documentPath);await idle();
  }
  s=await installationSession();d=s.drafts[s.draftKey];
  need(!d.installationId&&same(d.document,input.document),'The complete original commercial document was not received.');
 });
 await page.locator('[data-installation-action="gravitee-open"]').click();await idle();
 const desk=page.locator('.gravitee-source-desk');await desk.waitFor({state:'visible'});
 const copyName=input.operationId+' original';
 await stage('02-complete-source-and-all-decisions',async()=>{
  const existing=desk.locator('[data-gv-action="copy-open"]').filter({hasText:copyName});
  if(await existing.count())await existing.first().click();
  else {
   await desk.locator('aside [data-gv-field="sourceId"]').selectOption(input.sourceId);
   await desk.locator('[data-gv-field="name"]').fill(copyName);await click('new');
  }
  const original=JSON.parse(await readFile(join(root,'Original_Native_Inspection.json'),'utf8')).result;
  for(let i=0;i<original.cohort.length;i++){
   const r=input.cohort.find(x=>same(x.reference,original.cohort[i].reference));need(r,'Retain every exact native row.');
   await desk.locator('[data-gv-row="'+i+'"][data-gv-key="included"]').setChecked(r.included);
   await desk.locator('[data-gv-row="'+i+'"][data-gv-key="stage"]').selectOption(r.stage);
   await desk.locator('[data-gv-row="'+i+'"][data-gv-key="purpose"]').fill(r.purpose);
  }
  await click('checkpoint');await capture('01-complete-api-cohort');
  await desk.locator('[data-gv-action="member"]').first().click();await idle();
  need((await desk.locator('.gv-source').textContent()).trim(),'The complete original record reader is empty.');
  while(await desk.locator('[data-gv-action="page"]').count())await click('page');
  await capture('02-original-record-source');
 });
 await stage('03-complete-native-preparation',async()=>{
  await desk.locator('[data-gv-action="view"][data-view="prepare"]').click();await idle();await click('template');
  for(const key of ['source.reference','source.authority','receiving.host','receiving.operator']){
   const [a,b]=key.split('.');await desk.locator('[data-gv-binding="'+key+'"]').fill(input.bindings[a][b]);
  }
  if(await desk.locator('[data-gv-action="recover"]').count())await click('recover');
  await click('attach');await click('prepare');await capture('03-complete-preparation');
  const file=await download('prepared-download','Complete_Installation_Preparation.json');
  const prepared=JSON.parse(await readFile(file,'utf8'));
  need(prepared.scope.caseId===input.caseId&&same(prepared.result.prepared.document.workshare,input.document.workshare),'Preparation changed the original commercial source.');
  report.cohortSourceId=prepared.result.snapshot.selectedCohortSource.sourceId;
  await download('download','Whole_Working_Copies_Before_Save.json');await save();
 });
 await stage('04-original-native-installation-save',async()=>{
  const prior=Object.values(report.requests).filter(x=>x.body.action==='installation.save'&&x.state==='RECORDED');
  need(prior.length<=1,'Preserve the one original receiving Installation save.');
  if(!prior.length){
   await click('receive');
   await page.locator('[data-installation-note]').fill('Receive the complete selected Gravitee API source and original commercial workshare.');
   await page.locator('[data-installation-action="preview"]').click();await idle();
   await snapshot();await page.locator('[data-installation-action="save"]').click();await idle();await snapshot();
  }
  const saved=Object.values(report.requests).filter(x=>x.body.action==='installation.save'&&x.state==='RECORDED');
  need(saved.length===1,'Receive one actual original Installation result.');
  const result=saved[0].result,row=await api(prefix+'/installations/'+result.recordId+'?revision='+result.revision);
  need(row.sha256===result.sha256&&same(row.preview.document,saved[0].body.data.document),'Native save differs from its original complete command.');
  report.installation={id:row.id,revision:row.revision,sha256:row.sha256};
  await keep('Actual_Saved_Installation.json',pretty(row));await capture('04-original-saved-installation');
 });
 await stage('05-complete-download-and-working-reopen',async()=>{
  await page.locator('[data-installation-action="gravitee-open"]').click();await idle();
  const path=await download('download','Whole_Working_Copies_Final.json'),raw=await readFile(path,'utf8'),v=validateArchive(raw);
  const original=v.copies.find(x=>x.name===copyName);need(original,'The downloaded working file lost the complete source copy.');
  need(original.source.metadata.sha256===input.sourceSha256&&original.selection.cohort.length===input.cohort.length,'The complete source/selection changed in download.');
  await desk.locator('[data-gv-import]').setInputFiles(path);await idle();
  await desk.locator('[data-gv-action="copy-open"]').filter({hasText:copyName}).first().click();await idle();await click('verify');
  await desk.locator('[data-gv-action="view"][data-view="history"]').click();await idle();
  need(await desk.locator('[data-gv-action="history-open"]').count(),'Complete working history was lost.');
  await capture('05-received-working-history');
 });
 if(input.laterSourceId)await stage('06-later-full-edition-comparison',async()=>{
  await desk.locator('[data-gv-action="view"][data-view="compare"]').click();await idle();
  await desk.locator('main [data-gv-field="sourceId"]').selectOption(input.laterSourceId);await click('compare');
  const choices=desk.locator('[data-gv-choice]'),count=await choices.count();
  need(count>0&&Array.isArray(input.laterChoices)&&input.laterChoices.length===count,'Supply each explicit later-edition decision.');
  for(let i=0;i<count;i++)await choices.nth(i).selectOption(input.laterChoices[i]);
  await capture('06-complete-edition-comparison');await click('compare-apply');
  await download('download','Whole_Working_Copies_Later_Edition.json');
  await capture('07-explicit-later-source');
 });
 await stage('07-cold-browser-working-reopen',async()=>{
  await snapshot();await page.reload({waitUntil:'domcontentloaded'});await navigate();
  await page.locator('[data-installation-action="gravitee-open"]').click();await idle();
  await desk.locator('[data-gv-action="copy-open"]').filter({hasText:copyName}).first().click();await idle();await click('verify');
  await capture('08-cold-working-reopen');
 });
 need(!report.pageErrors?.length,'The original browser reported a JavaScript error.');
 report.state='COMPLETE';
}catch(e){failure=e;report.state='INTERRUPTED';report.error={name:e.name,message:e.message};}
finally{
 try{await snapshot();if(context)await context.close();closed=true;}catch(e){failure??=e;report.state='INTERRUPTED';report.closeError=e.message;}
 report.lifetimes=closed?'CLOSED':'UNCONFIRMED';await save();
 process.stdout.write(JSON.stringify({state:report.state,phases:Object.keys(report.phases),artifacts:Object.keys(report.artifacts).length,report:await receipt(reportPath)})+'\n');
}
if(failure)throw failure;
