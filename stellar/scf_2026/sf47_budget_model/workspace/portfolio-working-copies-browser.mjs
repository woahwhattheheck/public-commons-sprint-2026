// MIT. Optional complete Portfolio continuation in the original case browser course.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,dirname} from 'node:path';

export async function operatePortfolioWorkingCopies(host){
 const {page,browser,input,out,progress,phase,saveProgress,native,screenshot,atomic,fileIdentity}=host;
 const cold=host.mode==='portfolio-cold',folder=join(out,'exports');
 const json=v=>JSON.stringify(v,null,2)+'\n',stamp=()=>new Date().toISOString();
 await mkdir(folder,{recursive:true,mode:0o700});
 assert.match(input.portfolioId||'',/^portfolio-[a-f0-9]{32}$/,'Select the original saved allocation explicitly.');
 const sourcePaths=['portfolio-working-copies.mjs','portfolio-working-copy-store.mjs','portfolio.mjs','portfolio.css'];
 assert.ok(input.portfolioSourceSha256&&sourcePaths.every(name=>/^[a-f0-9]{64}$/.test(input.portfolioSourceSha256[name]||'')),'Pin every served Portfolio source in the original context.');
 const original=await native('/api/operations/'+input.caseId+'/portfolios/'+input.portfolioId);
 assert.equal(original.id,input.portfolioId);
 const binding={operationId:input.operationId,caseId:input.caseId,planId:input.planId,portfolioId:input.portfolioId,portfolioSha256:original.sha256,sourceSha256:input.portfolioSourceSha256};
 if(progress.portfolioBinding)assert.deepEqual(progress.portfolioBinding,binding,'Continue the exact original Portfolio operation and installed source.');
 else{progress.portfolioBinding=binding;await saveProgress();}
 assert.equal(progress.operationId,input.operationId,'Continue the original operation ID.');
 async function wait(target,check,message,timeout=60000){const until=Date.now()+timeout;let last;while(Date.now()<until){try{const value=await check();if(value)return value;}catch(error){last=error;}await new Promise(r=>setTimeout(r,120));}throw new Error(message+'; '+(last?.message||'')+' '+(await target.locator('[data-portfolio-status],[data-portfolio-storage]').allTextContents().catch(()=>[])).join(' | '));}
 async function idle(target){await target.locator('.portfolio').waitFor({state:'visible'});await wait(target,()=>target.locator('.portfolio').getAttribute('aria-busy').then(v=>v!=='true'),'Open the complete original Portfolio');}
 async function action(target,name){const b=target.locator('[data-portfolio-action="'+name+'"]');await wait(target,()=>b.isEnabled(),'Original Portfolio action '+name);await b.click();await idle(target);}
 async function open(target){
  await target.goto(input.baseUrl+'/#access='+encodeURIComponent(input.ownerKey),{waitUntil:'domcontentloaded'});
  await target.locator('#workbench').waitFor({state:'visible'});
  if(!(await target.locator('[name=caseSelect]').count()))await target.locator('[data-tab=operations]').click();
  const choice=target.locator('[name=caseSelect]');await choice.waitFor();if(await choice.inputValue()!==input.caseId)await choice.selectOption(input.caseId);
  await wait(target,()=>choice.inputValue().then(v=>v===input.caseId),'Select original operating case');
  const nav=target.locator('[data-ops-navigation]');
  let buttons=target.locator('[data-ops-tab=portfolio]');
  if(await nav.count()){
   const browse=nav.getByRole('button',{name:'Browse sections',exact:true});if(await browse.count()&&await browse.isVisible()&&await browse.getAttribute('aria-expanded')!=='true')await browse.click();
   buttons=nav.locator('[data-nav-section=portfolio]');
   const group=nav.locator('details[data-nav-group]').filter({has:nav.locator('[data-nav-section=portfolio]')}).first();
   if(await group.count()&&!(await group.evaluate(node=>node.open)))await group.locator('summary').click();
  }
  const button=await wait(target,async()=>{for(const b of await buttons.all())if(await b.isVisible())return b;return null;},'Open original Portfolio navigation');await button.click();await idle(target);
 }
 async function collection(target){
  return target.evaluate(async caseId=>{
   const {createPortfolioWorkingCopyStore}=await import('/portfolio-working-copy-store.mjs');
   const store=createPortfolioWorkingCopyStore('sf47.portfolio-working.'+caseId,{validateSession:async value=>value});
   try{return await store.open();}finally{await store.close();}
  },input.caseId);
 }
 async function selected(target){const all=await collection(target);return all.copies.find(c=>c.id===all.selectedCopyId)||null;}
 async function retained(target,predicate,message){return wait(target,async()=>{const c=await selected(target);return c&&predicate(c)?c:null;},message);}
 async function chooseCopy(target,id){
  const stored=(await collection(target)).copies.find(c=>c.id===id);assert.ok(stored,'Retain the original course copy.');
  if(stored.archived){
   const courseId=progress.phases['portfolio-two-window-current-memory-recovery']?.result?.secondCopyId;
   assert.equal(id,courseId,'Only restore the copy archived by this original receiving course.');
   await target.locator('[data-working-archived]').selectOption(id);await action(target,'working-restore');
  }
  await target.locator('[data-working-copy]').selectOption(id);await idle(target);await retained(target,c=>c.id===id,'Open selected complete copy');
 }
 async function saveDownload(target,trigger,name){
  const pending=target.waitForEvent('download',{timeout:180000});await trigger();const value=await pending,path=join(folder,name);await value.saveAs(path);
  const meta=await fileIdentity(path);progress.files[name]=meta;await saveProgress();return meta;
 }
 async function capture(name,viewport={width:1440,height:1000}){return screenshot(name,viewport);}
 function requestedNote(label){return (input.portfolioNote||'Original Portfolio working-copy receiving')+' — '+label+' — '+input.operationId;}
 async function editSelected(target){
  await target.locator('[data-portfolio-action=tab][data-id=inputs]').click();await idle(target);
  if(await target.locator('[data-portfolio-action=edit-saved]').count())await action(target,'edit-saved');
  if(await target.locator('[data-portfolio-profile]').inputValue()!=='base'){await target.locator('[data-portfolio-profile]').selectOption('base');await idle(target);}
 }
 async function note(target,value){await target.locator('[data-portfolio-input=note]').fill(value);return retained(target,c=>c.head.state.draft?.note===value,'Retain the exact current note');}
 async function checkpoint(target,label){await target.locator('[data-working-checkpoint-label]').fill(label);await action(target,'working-checkpoint');return retained(target,c=>c.checkpoints.some(x=>x.label===label),'Retain complete checkpoint');}
 async function verifyFile(path){
  const value=JSON.parse(await readFile(path,'utf8'));assert.equal(value.schema,'stellar-forge.portfolio-working-copy.v1');
  let sessions=0,attachments=0;
  function session(s){assert.equal(s.caseId,input.caseId);sessions++;for(const a of s.state.attachments){assert.equal(typeof a.contentBase64,'string');const bytes=Buffer.from(a.contentBase64,'base64');assert.equal(bytes.length,a.metadata.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),a.metadata.sha256);attachments++;}}
  function copy(c){session(c.head);for(const h of c.checkpoints)session(h.session);for(const l of c.lineage)copy(l.sourceCopy);}
  copy(value.copy);return {value,sessions,attachments};
 }
 // Re-read actual served bytes on every continuation; completed phase data is not a source check.
 const actual={};
 for(const name of sourcePaths){const bytes=await native('/'+name,{binary:true});actual[name]=createHash('sha256').update(bytes).digest('hex');assert.equal(actual[name],input.portfolioSourceSha256[name],'Receive the exact selected source: '+name);}
 progress.phases['portfolio-exact-installed-source']={complete:true,completedAt:stamp(),result:actual};
 await saveProgress();
 await open(page);
 if(cold){
  const previous=JSON.parse(await readFile(join(input.directory,'browser-portfolio-result.json'),'utf8'));
  await phase('portfolio-cold-original-case-and-copy',async()=>{
   await chooseCopy(page,previous.selectedCopyId);const copy=await selected(page);assert.equal(copy.head.state.pending,null);assert.equal(copy.head.state.savedChoice,previous.savedPortfolioId);
   const saved=await native('/api/operations/'+input.caseId+'/portfolios/'+previous.savedPortfolioId);assert.equal(saved.sha256,previous.savedPortfolioSha256);
   await capture('portfolio-cold-desktop.png');await capture('portfolio-cold-phone.png',{width:390,height:844});
   return {copyId:copy.id,portfolioId:saved.id,sha256:saved.sha256};
  });
  await saveDownload(page,()=>action(page,'working-export'),'portfolio-cold-working-copy.json');await verifyFile(join(folder,'portfolio-cold-working-copy.json'));
  return {schema:'stellar-forge.portfolio-working-copy-browser.v1',operationId:input.operationId,caseId:input.caseId,mode:'cold',completedAt:stamp(),phases:progress.phases,files:progress.files,visualReview:progress.visualReview};
 }
 const baseline=await phase('portfolio-original-source-and-first-images',async()=>{
  const incoming=await selected(page);
  if(!incoming?.head.state.draft){await capture('portfolio-00-empty-desktop.png');await capture('portfolio-00-empty-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});}
  await page.locator('[data-portfolio-saved]').selectOption(input.portfolioId);await idle(page);
  const copy=await retained(page,c=>c.head.state.savedChoice===input.portfolioId,'Open original saved allocation');
  assert.equal(copy.head.state.saved.sha256,original.sha256);
  await page.locator('[data-working-name]').fill('Portfolio receiving — '+input.operationId);await action(page,'working-rename');
  const label='Original saved allocation';const current=await checkpoint(page,label),cp=current.checkpoints.find(x=>x.label===label);
  await capture('portfolio-00-original-desktop.png');await capture('portfolio-00-original-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
  process.stdout.write(json({phase:'portfolio-first-images',images:['portfolio-00-original-desktop.png','portfolio-00-original-phone.png'],instruction:'Open and LOOK at these exact rendered images now; screenshot creation is not producer inspection.'}));
  return {copyId:copy.id,checkpointId:cp.id,originalPortfolioId:original.id,originalSha256:original.sha256,forecastId:original.inputs.forecastId};
 });
 await phase('portfolio-unfinished-form-and-cold-desk-recovery',async()=>{
  await chooseCopy(page,baseline.copyId);await editSelected(page);
  const first=original.inputs.resources[0];assert.ok(first,'Use the original populated resource allocation.');
  const explicitDay=first.hoursByWeekday.findIndex(v=>v!==null&&v!==undefined&&v!=='');
  assert.ok(explicitDay>=0,'Select a resource with an explicitly entered original weekday capacity.');
  const capacity=page.locator('[data-portfolio-resource="0"][data-capacity-day="'+explicitDay+'"]');
  await capacity.fill('-');
  await page.locator('[data-portfolio-action=add-date][data-index="0"]').click();
  await page.locator('dialog input[name=date]').fill('2026-11-');
  await page.locator('dialog input[name=hours]').fill('2.');
  await page.locator('[data-portfolio-action=cancel-dialog]').click();
  await note(page,requestedNote('unfinished capacity retained'));
  const before=await retained(page,c=>Object.values(c.head.state.resourceDialogs).some(d=>d.values.date==='2026-11-'&&d.values.hours==='2.'),'Retain unfinished resource form');
  await capture('portfolio-01-unfinished-desktop.png');
  await page.reload({waitUntil:'domcontentloaded'});await open(page);
  const after=await selected(page);assert.equal(after.id,before.id);assert.deepEqual(after.head.state.resourceDialogs,before.head.state.resourceDialogs);
  assert.equal(await capacity.inputValue(),'-');
  await action(page,'preview');assert.match(await page.locator('[data-portfolio-status]').textContent(),/partly typed|Finish/);
  await capture('portfolio-02-unfinished-error-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
  await action(page,'working-dialog');assert.equal(await page.locator('dialog input[name=date]').inputValue(),'2026-11-');assert.equal(await page.locator('dialog input[name=hours]').inputValue(),'2.');
  await page.locator('[data-portfolio-action=cancel-dialog]').click();
  await capacity.fill(String(first.hoursByWeekday[explicitDay]));
  await action(page,'working-dialog');
  let date=new Date(original.inputs.calendar.startDate+'T00:00:00Z');
  while(Object.hasOwn(first.hoursByDate||{},date.toISOString().slice(0,10))||[null,undefined,''].includes(first.hoursByWeekday[(date.getUTCDay()+6)%7]))date.setUTCDate(date.getUTCDate()+1);
  const day=(date.getUTCDay()+6)%7,ymd=date.toISOString().slice(0,10),hours=first.hoursByWeekday[day];assert.notEqual(hours,null,'Choose an explicitly valued original weekday.');
  await page.locator('dialog input[name=date]').fill(ymd);await page.locator('dialog input[name=hours]').fill(String(hours));await page.locator('dialog button[type=submit]').click();await idle(page);
  const current=await note(page,requestedNote('same original weekday capacity retained as explicit dated assumption'));
  assert.equal(current.head.state.draft.resources[0].hoursByDate[ymd],String(hours));
  const completed=await checkpoint(page,'Completed dated capacity');return {copyId:completed.id,date:ymd,hours,checkpointId:completed.checkpoints.at(-1).id};
 });
 const fork=await phase('portfolio-checkpoint-fork-complete-source-receive',async()=>{
  await chooseCopy(page,baseline.copyId);const later=await selected(page);
  await page.locator('[data-working-history]').selectOption(JSON.stringify([baseline.checkpointId]));await action(page,'working-fork');
  const forked=await selected(page);assert.notEqual(forked.id,baseline.copyId);assert.deepEqual(forked.head,later.checkpoints.find(x=>x.id===baseline.checkpointId).session);
  const file=await saveDownload(page,()=>action(page,'working-export'),'portfolio-complete-working-copy.json'),received=await verifyFile(file.path);
  await action(page,'working-import');await page.locator('[data-working-file]').setInputFiles(file.path);await idle(page);
  const imported=await retained(page,c=>c.id!==forked.id&&c.lineage.some(x=>x.kind==='import'),'Receive full original copy');
  assert.deepEqual(imported.head,received.value.copy.head);
  assert.ok((await collection(page)).copies.some(c=>c.id===baseline.copyId&&c.head.state.draft.note===later.head.state.draft.note));
  const corrupt=structuredClone(received.value);const attachment=corrupt.copy.head.state.attachments[0];assert.ok(attachment);
  attachment.contentBase64=Buffer.from('changed source bytes').toString('base64');const bad=join(folder,'rejected-changed-source.json');await atomic(bad,corrupt);
  await action(page,'working-import');await page.locator('[data-working-file]').setInputFiles(bad);await idle(page);
  assert.equal((await selected(page)).id,imported.id);assert.match(await page.locator('[data-portfolio-status]').textContent(),/source bytes differ|source.*differs|Retain/);
  await capture('portfolio-03-source-error-desktop.png');await capture('portfolio-03-source-error-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
  return {forkedCopyId:forked.id,importedCopyId:imported.id,sessions:received.sessions,attachments:received.attachments};
 });
 const concurrent=await phase('portfolio-two-window-current-memory-recovery',async()=>{
  await chooseCopy(page,fork.importedCopyId);
  const second=await browser.newPage();second.setDefaultTimeout(60000);second.on('dialog',d=>d.accept());
  try{
   await open(second);await editSelected(page);
   const firstNote=requestedNote('first window preserved'),secondNote=requestedNote('second window preserved');
   await note(page,firstNote);await editSelected(second);
   await second.locator('[data-portfolio-input=note]').fill(secondNote);
   await wait(second,()=>second.locator('[data-portfolio-status],[data-portfolio-storage]').allTextContents().then(rows=>rows.some(x=>/Another page changed/.test(x))),'Observe original stale-window rejection');
   assert.equal((await selected(page)).head.state.draft.note,firstNote);
   const file=await saveDownload(second,()=>action(second,'working-export'),'portfolio-second-window-recovery.json'),recovered=await verifyFile(file.path);
   assert.equal(recovered.value.copy.head.state.draft.note,secondNote);
   await action(second,'working-reload');assert.equal((await selected(second)).head.state.draft.note,firstNote);
   await action(second,'working-import');await second.locator('[data-working-file]').setInputFiles(file.path);await idle(second);
   const copy=await retained(second,c=>c.head.state.draft.note===secondNote,'Receive second-window work separately');
   assert.notEqual(copy.id,fork.importedCopyId);
   return {firstCopyId:fork.importedCopyId,secondCopyId:copy.id,firstNote,secondNote};
  }finally{await second.close();}
 });
 await open(page);
 await chooseCopy(page,concurrent.secondCopyId);
 await phase('portfolio-native-preview',async()=>{
  const pattern='**/api/operations/'+input.caseId+'/portfolio-preview';
  await page.route(pattern,async route=>{
   try{
    const response=await route.fetch();
    for(const [name,viewport]of [['portfolio-04-loading-desktop.png',{width:1440,height:1000}],['portfolio-04-loading-phone.png',{width:390,height:844}]]){
     await page.setViewportSize(viewport);const path=join(out,name);await page.screenshot({path,fullPage:true});const file=await fileIdentity(path);
     progress.visualReview??={};progress.visualReview[name]={filename:name,bytes:file.bytes,sha256:file.sha256,viewport,stage:'CAPTURED_FOR_INTERNAL_REVIEW',context:'Actual original preview request awaiting its retained response'};await saveProgress();
    }
    await page.setViewportSize({width:1440,height:1000});await route.fulfill({response});
   }catch(error){await route.abort('failed').catch(()=>{});throw error;}
  },{times:1});
  try{await action(page,'preview');}finally{await page.unroute(pattern);}
  const copy=await retained(page,c=>Boolean(c.head.state.preview),'Retain original native allocation preview');
  assert.equal(copy.head.state.preview.inputs.forecastId,original.inputs.forecastId);
  await capture('portfolio-04-native-preview-desktop.png');await capture('portfolio-04-native-preview-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
  return {copyId:copy.id,previewSha256:copy.head.state.preview.previewSha256};
 });
 const saved=await phase('portfolio-original-native-save-after-lost-response',async()=>{
  const requestFile=join(out,'original-portfolio-save-request.json'),responseFile=join(out,'original-portfolio-save-response.json');
  let copy=await selected(page),priorRequest=null,priorResponse=null;
  try{priorRequest=JSON.parse(await readFile(requestFile,'utf8'));priorResponse=JSON.parse(await readFile(responseFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
  if(!copy.head.state.pending&&priorResponse?.recordId){
   assert.equal(priorResponse.action,'portfolio.save');assert.equal(priorResponse.id,input.caseId);
   const result=await native('/api/operations/'+input.caseId+'/portfolios/'+priorResponse.recordId);
   assert.deepEqual(result.inputs,priorRequest.data.inputs);assert.equal(result.previewSha256,priorRequest.data.expectedPreviewSha256);
   await page.locator('[data-portfolio-saved]').selectOption(result.id);await idle(page);
   return {copyId:copy.id,requestId:priorRequest.requestId,portfolioId:result.id,sha256:result.sha256,expectedVersion:priorRequest.expectedVersion,recoveredCompletedPhase:true};
  }
  if(!copy.head.state.pending){
   const pattern='**/api/operations/'+input.caseId+'/command';
   let rejectedStatus=null;
   await page.route(pattern,async route=>{
    try{
     const request=route.request().postDataJSON();assert.equal(request.action,'portfolio.save');await atomic(requestFile,request);
     const response=await route.fetch(),raw=await response.body();await atomic(responseFile,raw);
     if(!response.ok()){rejectedStatus=response.status();await route.fulfill({response});return;}
     await route.abort('failed');
    }catch(error){await route.abort('failed').catch(()=>{});throw error;}
   },{times:1});
   try{await action(page,'save');}finally{await page.unroute(pattern);}
   assert.equal(rejectedStatus,null,'The original save was rejected; retain its original request and resolve that case response before continuing.');
   copy=await retained(page,c=>Boolean(c.head.state.pending),'Retain exact original pending Portfolio request');
  }
  const body=copy.head.state.pending.payload;await atomic(requestFile,body);
  await open(page);const reopened=await selected(page);assert.deepEqual(reopened.head.state.pending.payload,body);
  await action(page,'retry-save');
  copy=await retained(page,c=>!c.head.state.pending&&Boolean(c.head.state.savedChoice),'Receive original Portfolio save receipt');
  const result=await native('/api/operations/'+input.caseId+'/portfolios/'+copy.head.state.savedChoice);
  assert.equal(result.previewSha256,body.data.expectedPreviewSha256);assert.deepEqual(result.inputs,body.data.inputs);
  const history=await native('/api/operations/'+input.caseId+'/history?after='+Math.max(0,body.expectedVersion-1)+'&limit=200');
  const rows=Array.isArray(history)?history:history.events||history.history||[];
  assert.equal(rows.filter(e=>e.requestId===body.requestId).length,1,'The original request must have one native event');
  await atomic(join(out,'received-original-portfolio.json'),result);
  return {copyId:copy.id,requestId:body.requestId,portfolioId:result.id,sha256:result.sha256,expectedVersion:body.expectedVersion};
 });
 await phase('portfolio-saved-download-archive-restore-and-reopen',async()=>{
  await page.locator('[data-portfolio-saved]').selectOption(saved.portfolioId);await idle(page);
  await saveDownload(page,()=>action(page,'download-portfolio'),'saved-portfolio-complete.zip');
  await saveDownload(page,()=>action(page,'working-export'),'portfolio-final-working-copy.json');await verifyFile(join(folder,'portfolio-final-working-copy.json'));
  const response=await native('/api/operations/'+input.caseId+'/export.zip',{binary:true});const path=join(folder,'original-operations-case.zip');await atomic(path,response);progress.files['original-operations-case.zip']=await fileIdentity(path);await saveProgress();
  await action(page,'working-archive');await page.locator('[data-working-archived]').selectOption(saved.copyId);await action(page,'working-restore');assert.equal((await selected(page)).id,saved.copyId);
  await open(page);assert.equal((await selected(page)).head.state.savedChoice,saved.portfolioId);
  await capture('portfolio-05-final-desktop.png');await capture('portfolio-05-final-phone.png',{width:390,height:844});
  return {copyId:saved.copyId,portfolioId:saved.portfolioId};
 });
 return {schema:'stellar-forge.portfolio-working-copy-browser.v1',operationId:input.operationId,caseId:input.caseId,mode:'operate',completedAt:stamp(),selectedCopyId:saved.copyId,savedPortfolioId:saved.portfolioId,savedPortfolioSha256:saved.sha256,phases:progress.phases,files:progress.files,visualReview:progress.visualReview,sourcePortfolioId:original.id,sourcePortfolioSha256:original.sha256};
}
