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
 if(input.portfolioAvailability)sourcePaths.push('portfolio-availability.mjs','portfolio-availability-desk.mjs','portfolio-availability.css');
 if(input.portfolioEffort){for(const name of ['portfolio-availability.mjs','portfolio-effort.mjs','portfolio-effort-desk.mjs','portfolio-effort.css'])if(!sourcePaths.includes(name))sourcePaths.push(name);}
 if(input.portfolioSequence){for(const name of ['portfolio-availability.mjs','portfolio-sequence.mjs','portfolio-sequence-desk.mjs','portfolio-sequence.css'])if(!sourcePaths.includes(name))sourcePaths.push(name);}
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
   const {staffDeskStorageKey,currentStaffContext}=await import('/staff-session.mjs');
   const {createPortfolioWorkingCopyStore}=await import('/portfolio-working-copy-store.mjs');
   const store=createPortfolioWorkingCopyStore(staffDeskStorageKey('sf47.portfolio-working.'+caseId,currentStaffContext()),{validateSession:async value=>value});
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
 async function verifyRetainedArtifacts(record,directory,label){
  for(const [name,expected]of Object.entries(record.files||{})){
   assert.ok(expected&&typeof expected.path==='string'&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&/^[a-f0-9]{64}$/.test(expected.sha256||''),'Retain the complete original file identity: '+label+' / '+name);
   let actual;try{actual=await fileIdentity(expected.path);}catch(error){throw new Error('Recover the exact retained Portfolio output '+expected.path+' before continuing '+label+'. Prior phase and file identity remain unchanged. '+error.message);}
   assert.equal(actual.bytes,expected.bytes,'Retained Portfolio output size changed: '+expected.path);
   assert.equal(actual.sha256,expected.sha256,'Retained Portfolio output bytes changed: '+expected.path);
  }
  for(const [name,expected]of Object.entries(record.visualReview||{})){
   assert.ok(expected&&typeof expected.filename==='string'&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0&&/^[a-f0-9]{64}$/.test(expected.sha256||''),'Retain the original rendered image identity: '+label+' / '+name);
   const path=join(directory,expected.filename);let actual;
   try{actual=await fileIdentity(path);}catch(error){throw new Error('Recover the exact original rendered Portfolio image '+path+' before continuing '+label+'. Prior visual review remains unchanged. '+error.message);}
   assert.equal(actual.bytes,expected.bytes,'Original Portfolio image size changed: '+path);
   assert.equal(actual.sha256,expected.sha256,'Original Portfolio image bytes changed: '+path);
  }
 }
 // Re-read actual served bytes on every continuation; completed phase data is not a source check.
 const actual={};
 for(const name of sourcePaths){const bytes=await native('/'+name,{binary:true});actual[name]=createHash('sha256').update(bytes).digest('hex');assert.equal(actual[name],input.portfolioSourceSha256[name],'Receive the exact selected source: '+name);}
 progress.phases['portfolio-exact-installed-source']={complete:true,completedAt:stamp(),result:actual};
 await saveProgress();
 await verifyRetainedArtifacts(progress,out,'the same receiving continuation');
 await open(page);
 if(cold){
  const previous=JSON.parse(await readFile(join(input.directory,'browser-portfolio-result.json'),'utf8'));
  assert.equal(previous.operationId,input.operationId);assert.equal(previous.caseId,input.caseId);
  await verifyRetainedArtifacts(previous,join(input.directory,'browser-portfolio'),'the original completed receiving result');
  await phase('portfolio-cold-original-case-and-copy',async()=>{
   await chooseCopy(page,previous.selectedCopyId);const copy=await selected(page);assert.equal(copy.head.state.pending,null);assert.equal(copy.head.state.savedChoice,previous.savedPortfolioId);
   const saved=await native('/api/operations/'+input.caseId+'/portfolios/'+previous.savedPortfolioId);assert.equal(saved.sha256,previous.savedPortfolioSha256);
   await capture('portfolio-cold-desktop.png');await capture('portfolio-cold-phone.png',{width:390,height:844});
   return {copyId:copy.id,portfolioId:saved.id,sha256:saved.sha256};
  });
  await saveDownload(page,()=>action(page,'working-export'),'portfolio-cold-working-copy.json');await verifyFile(join(folder,'portfolio-cold-working-copy.json'));
  await verifyRetainedArtifacts(progress,out,'the cold receiving result');
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
 if(input.portfolioAvailability)await phase('portfolio-resource-availability-complete-review',async()=>{
  await editSelected(page);let current=await selected(page);
  const resource=current.head.state.draft.resources[0],calendar=current.head.state.draft.calendar;
  assert.ok(resource,'Continue the original populated resource.');
  const start=calendar.startDate,last=new Date(Date.parse(start+'T00:00:00Z')+2*86400000).toISOString().slice(0,10);
  assert.ok(calendar.horizonDays>=3,'The selected original course uses at least three program dates.');
  const tab=()=>page.locator('[data-portfolio-action=tab][data-id=availability]').click();
  const av=async name=>{await page.locator('[data-av-action="'+name+'"]').click();await idle(page);};
  await tab();await page.locator('[data-av-field=profile]').selectOption('base');await page.locator('[data-av-field=resource]').selectOption(resource.id);await page.locator('[data-av-field=kind]').selectOption('RANGE');
  await page.locator('[data-av-field=hours]').fill('0.');
  await page.locator('[data-av-field=from]').fill(start.slice(0,-2));
  await page.locator('[data-av-field=note]').fill(requestedNote('three-day capacity planning review'));
  await retained(page,c=>Object.values(c.head.state.availabilityDesk.drafts).some(d=>d.resourceId===resource.id&&d.hours==='0.'&&d.from===start.slice(0,-2)),'Retain incomplete original calendar controls');
  await open(page);await tab();
  assert.equal(await page.locator('[data-av-field=hours]').inputValue(),'0.');
  assert.equal(await page.locator('[data-av-field=from]').inputValue(),start.slice(0,-2));
  await capture('portfolio-availability-01-unfinished-desktop.png');
  await page.locator('[data-av-field=kind]').selectOption('RANGE');
  await page.locator('[data-av-field=operation]').selectOption('SET');
  await page.locator('[data-av-field=from]').fill(start);await page.locator('[data-av-field=to]').fill(last);
  await page.locator('[data-av-field=hours]').fill('0');
  for(const box of await page.locator('[data-av-weekday]').all())await box.check();
  await page.locator('[data-av-field=includeClosed]').check();await av('prepare');
  await retained(page,c=>Object.values(c.head.state.availabilityDesk.drafts).some(d=>d.proposal?.rows.length===3),'Retain every original/current/proposed date');
  await capture('portfolio-availability-02-review-desktop.png');await capture('portfolio-availability-02-review-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
  process.stdout.write(json({phase:'portfolio-availability-first-images',images:['portfolio-availability-02-review-desktop.png','portfolio-availability-02-review-phone.png'],instruction:'Open and LOOK at these exact resource-calendar screens before continuing the outgoing product review.'}));
  const reviewFile=await saveDownload(page,()=>av('review-json'),'portfolio-resource-availability-before.json');
  const review=JSON.parse(await readFile(reviewFile.path,'utf8'));assert.equal(review.rows.length,3);assert.ok(review.rows.every(r=>r.proposed.hours==='0'));
  const already=(await selected(page)).head.state.availabilityDesk.history.find(h=>h.proposal.command.kind==='RANGE'&&h.proposal.command.operation==='SET'&&h.proposal.command.hours==='0'&&h.proposal.command.from===start&&h.proposal.command.to===last&&h.proposal.command.note===requestedNote('three-day capacity planning review'));
  const rangeDates=Array.from({length:3},(_,i)=>new Date(Date.parse(start+'T00:00:00Z')+i*86400000).toISOString().slice(0,10));
  const alreadyCurrent=(await selected(page)).head.state.draft.resources.find(r=>r.id===resource.id);
  if(already&&rangeDates.every(d=>String(alreadyCurrent.hoursByDate[d])==='0'))await av('clear-review');else await av('apply');
  current=await retained(page,c=>c.head.state.availabilityDesk.history.some(h=>h.proposal.command.note===requestedNote('three-day capacity planning review'))&&rangeDates.every(d=>String(c.head.state.draft.resources.find(r=>r.id===resource.id).hoursByDate[d])==='0'),'Retain complete applied resource review');
  assert.equal(current.head.state.draft.resources[0].hoursByDate[start],'0');
  const appliedHistory=structuredClone(current.head.state.availabilityDesk.history);
  await saveDownload(page,()=>av('csv'),'portfolio-resource-availability-calendar.csv');
  await saveDownload(page,()=>av('json'),'portfolio-resource-availability-calendar.json');
  const working=await saveDownload(page,()=>action(page,'working-export'),'portfolio-availability-complete-working-copy.json');
  const received=await verifyFile(working.path);assert.deepEqual(received.value.copy.head.state.availabilityDesk.history,appliedHistory);
  await open(page);current=await selected(page);assert.deepEqual(current.head.state.availabilityDesk.history,appliedHistory);assert.equal(current.head.state.draft.resources[0].hoursByDate[start],'0');
  await tab();await page.locator('[data-av-field=kind]').selectOption('WEEKLY');
  await page.locator('[data-av-field="value:0"]').fill('');
  await av('prepare');
  const weeklyFile=await saveDownload(page,()=>av('review-json'),'portfolio-resource-availability-weekly-review.json');
  const weekly=JSON.parse(await readFile(weeklyFile.path,'utf8'));assert.equal(weekly.rows.length,calendar.horizonDays);
  assert.equal(weekly.proposal.command.values[0],'');assert.equal(weekly.proposal.nextResource.hoursByWeekday[0],null);
  await av('clear-review');
  await page.locator('[data-portfolio-action=tab][data-id=inputs]').click();
  return {copyId:current.id,resourceId:resource.id,from:start,to:last,dates:3,explicitHours:'0',repeatingReviewDates:weekly.rows.length,completeAppliedReviews:appliedHistory.length,weeklyUnknownReviewedOnly:true,sourceForecastId:current.head.state.draft.forecastId};
 });
 if(input.portfolioEffort){
  const course=await phase('portfolio-effort-original-basis',async()=>{
   await editSelected(page);const copy=await selected(page);
   const chosen=await page.evaluate(async state=>{
    const E=await import('/portfolio-effort.mjs'),view=E.effortView(state.draft,state.sourceTasks),from=view.resources[0]?.id,to=view.resources[1]?.id;
    if(!from||!to)throw Error('Select an original populated allocation with two resources.');
    const available=view.rows.filter(r=>!r.inherited&&r.totals.state==='BALANCED'&&r.assignments[from]!==undefined&&r.assignments[from]!==null&&Number(r.assignments[from])>0&&(!Object.hasOwn(r.assignments,to)||r.assignments[to]!==null));
    const row=available.find(r=>r.kind==='PHASE')||available[0];if(!row)throw Error('Retain an original balanced task or phase with entered source effort.');
    return {rowKey:row.key,taskId:row.taskId,phaseId:row.phaseId,from,to,beforeAssignments:row.assignments,forecastId:view.forecastId,forecastSha256:view.forecastSha256,sourceHours:row.expectedHours};
   },copy.head.state);
   const expected=await page.evaluate(async ({state,chosen,note})=>{
    const E=await import('/portfolio-effort.mjs'),command={kind:'TRANSFER',rowKeys:[chosen.rowKey],fromResourceId:chosen.from,toResourceId:chosen.to,hours:'all',initializeDestination:true,note};
    const p=E.prepareEffort(state.draft,state.sourceTasks,command),r=E.reviewEffort(state.draft,state.sourceTasks,p);
    return {proposal:p,afterAssignments:r.rows[0].after};
   },{state:copy.head.state,chosen,note:requestedNote('original complete work reassignment review')});
   const record={copyId:copy.id,...chosen,...expected};const path=join(out,'portfolio-effort-original-selection.json');await atomic(path,record);progress.files['portfolio-effort-original-selection.json']=await fileIdentity(path);await saveProgress();return record;
  });
  await phase('portfolio-effort-complete-assignment-review',async()=>{
   await chooseCopy(page,course.copyId);await editSelected(page);
   const tab=()=>page.locator('[data-portfolio-action=tab][data-id=effort]').click(),ea=async name=>{const el=page.locator('[data-effort-action="'+name+'"]');await wait(page,()=>el.isEnabled(),'Work allocation action '+name);await el.click();await idle(page);};
   await tab();
   await page.locator('[data-effort-field=query]').fill(course.taskId);await ea('search');
   const rowButton=page.locator('[data-effort-action=open-row]').filter({hasText:'Edit assignments'});let clicked=false;
   for(const button of await rowButton.all())if(await button.getAttribute('data-key')===course.rowKey){await button.click();clicked=true;break;}assert.ok(clicked,'Open the original selected work row.');
   const originalField=page.locator('[data-effort-row-value="'+course.from+'"]');await originalField.fill('0.');
   await retained(page,c=>Object.values(c.head.state.effortDesk.drafts).some(d=>d.rowDrafts[course.rowKey]?.[course.from]?.value==='0.'),'Retain the incomplete original assignment field');
   await open(page);await tab();assert.equal(await page.locator('[data-effort-row-value="'+course.from+'"]').inputValue(),'0.');
   await capture('portfolio-effort-01-unfinished-desktop.png');
   let selectedRow=false;for(const box of await page.locator('[data-effort-select]').all())if(await box.getAttribute('data-effort-select')===course.rowKey){await box.check();selectedRow=true;break;}assert.ok(selectedRow,'Select the original work row.');
   await page.locator('[data-effort-field=fromResourceId]').selectOption(course.from);
   await page.locator('[data-effort-field=toResourceId]').selectOption(course.to);
   await page.locator('[data-effort-field=hours]').fill('all');
   await page.locator('[data-effort-field=initializeDestination]').check();
   await page.locator('[data-effort-field=note]').fill(requestedNote('original complete work reassignment review'));
   const current=await selected(page),hist=current.head.state.effortDesk.history.find(h=>h.proposal.command.note===requestedNote('original complete work reassignment review'));
   const currentMap=await page.evaluate(async ({state,key})=>{const E=await import('/portfolio-effort.mjs');return E.effortView(state.draft,state.sourceTasks).rows.find(r=>r.key===key).assignments;},{state:current.head.state,key:course.rowKey});
   if(hist)assert.deepEqual(currentMap,course.afterAssignments,'The previously applied course row changed; retain its original review and resolve it explicitly.');
   else assert.deepEqual(currentMap,course.beforeAssignments,'The original course row changed before its retained review; preserve both editions.');
   await ea('prepare-transfer');
   await capture('portfolio-effort-02-review-desktop.png');await capture('portfolio-effort-02-review-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
   process.stdout.write(json({phase:'portfolio-effort-first-images',images:['portfolio-effort-02-review-desktop.png','portfolio-effort-02-review-phone.png'],instruction:'Open and LOOK at the complete assignment screens and important controls before presenting this product.'}));
   await saveDownload(page,()=>ea('review-json'),'portfolio-effort-complete-review.json');
   if(hist)await ea('clear-review');else await ea('apply');
   const applied=await retained(page,c=>c.head.state.effortDesk.history.some(h=>h.proposal.command.note===requestedNote('original complete work reassignment review')),'Retain the complete applied assignment history');
   const actual=await page.evaluate(async ({state,key})=>{const E=await import('/portfolio-effort.mjs');return E.effortView(state.draft,state.sourceTasks).rows.find(r=>r.key===key);},{state:applied.head.state,key:course.rowKey});
   assert.deepEqual(actual.assignments,course.afterAssignments);assert.equal(actual.totals.state,'BALANCED');assert.equal(actual.expectedHours,course.sourceHours);
   assert.equal(Object.values(applied.head.state.effortDesk.drafts).find(d=>d.profile==='base'&&d.forecastId===course.forecastId).rowDrafts[course.rowKey][course.from].value,'0.','Unrelated unfinished assignment survives the explicit transfer.');
   await saveDownload(page,()=>ea('csv'),'portfolio-effort-complete-assignments.csv');await saveDownload(page,()=>ea('json'),'portfolio-effort-complete-data.json');
   const file=await saveDownload(page,()=>action(page,'working-export'),'portfolio-effort-complete-working-copy.json'),received=await verifyFile(file.path);
   assert.deepEqual(received.value.copy.head.state.effortDesk,applied.head.state.effortDesk);
   await open(page);assert.deepEqual((await selected(page)).head.state.effortDesk,applied.head.state.effortDesk);
   await page.locator('[data-portfolio-action=tab][data-id=inputs]').click();
   return {copyId:course.copyId,forecastId:course.forecastId,taskId:course.taskId,phaseId:course.phaseId,sourceHours:course.sourceHours,beforeAssignments:course.beforeAssignments,afterAssignments:actual.assignments,fullSources:received.attachments,unfinishedFieldRetained:true};
  });
 }
 if(input.portfolioSequence){
  const course=await phase('portfolio-sequence-original-basis',async()=>{
   await editSelected(page);const copy=await selected(page);
   const chosen=await page.evaluate(async ({state,note})=>{
    const Q=await import('/portfolio-sequence.mjs'),v=Q.sequenceView(state.draft,state.sourceTasks,state.installationCandidates);
    const candidates=v.rows.filter(r=>r.phaseId===null&&!r.inherited&&r.sourceAvailable&&!r.source.timing&&r.values.releaseDate&&r.values.priority<1000000);
    for(const row of candidates){
     const releaseDate=new Date(Date.parse(row.values.releaseDate+'T00:00:00Z')+86400000).toISOString().slice(0,10);
     if(row.values.dueDate&&releaseDate>row.values.dueDate)continue;
     for(const option of row.dependencyOptions){
      const other=v.rows.find(r=>r.key===option.key);
      if(row.values.dependsOn.includes(option.id)||!other||other.phaseId!==null||other.source.timing||other.values.releaseDate>row.values.releaseDate)continue;
      const fields={...row.values,releaseDate,priority:row.values.priority+1,dependsOn:[...row.values.dependsOn,option.id]};
      try{const proposal=Q.prepareSequence(state.draft,state.sourceTasks,state.installationCandidates,{kind:'EDIT',rows:[{key:row.key,fields}],note}),review=Q.reviewSequence(state.draft,state.sourceTasks,state.installationCandidates,proposal);
       if(review.canApply)return {rowKey:row.key,taskId:row.taskId,phaseId:row.phaseId,forecastId:v.forecastId,forecastSha256:v.forecastSha256,beforeValues:row.values,afterValues:fields,addedPredecessor:option.id,proposal};
      }catch{}
     }
    }
    throw Error('Select the actual populated original Portfolio with a source-dated task and a cycle-free original predecessor; retain the original case and selection.');
   },{state:copy.head.state,note:requestedNote('original complete delivery sequence review')});
   const record={copyId:copy.id,...chosen},path=join(out,'portfolio-sequence-original-selection.json');await atomic(path,record);progress.files['portfolio-sequence-original-selection.json']=await fileIdentity(path);await saveProgress();return record;
  });
  await phase('portfolio-sequence-complete-delivery-review',async()=>{
   await chooseCopy(page,course.copyId);await editSelected(page);
   const tab=()=>page.locator('[data-portfolio-action=tab][data-id=sequence]').click(),sa=async name=>{const el=page.locator('[data-sequence-action="'+name+'"]');await wait(page,()=>el.isEnabled(),'Delivery sequence action '+name);await el.click();await idle(page);};
   await tab();await page.locator('[data-sequence-field=query]').fill('__no_original_work_matches__');await sa('search');await capture('portfolio-sequence-00-empty-desktop.png');
   await page.locator('[data-sequence-field=query]').fill(course.taskId);await sa('search');let found=false;
   for(const b of await page.locator('[data-sequence-action=open-row]').all())if(await b.getAttribute('data-key')===course.rowKey){await b.click();found=true;break;}assert.ok(found,'Open the exact original sequence row.');
   await page.locator('[data-sequence-row=releaseDate]').fill(course.beforeValues.releaseDate.slice(0,5));
   await retained(page,c=>Object.values(c.head.state.sequenceDesk.drafts).some(d=>d.rowDrafts[course.rowKey]?.releaseDate===course.beforeValues.releaseDate.slice(0,5)),'Retain incomplete original work release');
   await open(page);await tab();assert.equal(await page.locator('[data-sequence-row=releaseDate]').inputValue(),course.beforeValues.releaseDate.slice(0,5));
   await capture('portfolio-sequence-01-unfinished-desktop.png');
   const current=await selected(page),hist=current.head.state.sequenceDesk.history.find(h=>h.proposal.command.note===requestedNote('original complete delivery sequence review'));
   const actualBefore=await page.evaluate(async ({state,key})=>{const Q=await import('/portfolio-sequence.mjs');return Q.sequenceView(state.draft,state.sourceTasks,state.installationCandidates).rows.find(r=>r.key===key).values;},{state:current.head.state,key:course.rowKey});
   assert.deepEqual(actualBefore,hist?course.afterValues:course.beforeValues,'Retain the exact original sequence before continuing its reviewed mutation.');
   await page.locator('[data-sequence-row=releaseDate]').fill('2026-02-31');await sa('prepare-row');assert.match(await page.locator('[data-sequence-status]').innerText(),/real calendar date/);await capture('portfolio-sequence-01-invalid-date-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
   for(const field of ['releaseDate','dueDate','minBusinessDays','priority','note'])await page.locator('[data-sequence-row="'+field+'"]').fill(course.afterValues[field]===null?'':String(course.afterValues[field]));
   for(const box of await page.locator('[data-sequence-predecessor]').all())if(await box.isEnabled())await box.setChecked(course.afterValues.dependsOn.includes(await box.getAttribute('data-sequence-predecessor')));
   await page.locator('[data-sequence-field=note]').fill(requestedNote('original complete delivery sequence review'));
   await sa('prepare-row');await capture('portfolio-sequence-02-review-desktop.png');await capture('portfolio-sequence-02-review-phone.png',{width:390,height:844});await page.setViewportSize({width:1440,height:1000});
   process.stdout.write(json({phase:'portfolio-sequence-first-images',images:['portfolio-sequence-00-empty-desktop.png','portfolio-sequence-01-invalid-date-phone.png','portfolio-sequence-02-review-desktop.png','portfolio-sequence-02-review-phone.png'],instruction:'Open and LOOK at the actual original source/date/predecessor review, empty and error states; operate important controls and inspect every complete download before presenting this product.'}));
   await saveDownload(page,()=>sa('review-json'),'portfolio-delivery-complete-review.json');
   if(hist)await sa('clear-review');else await sa('apply');
   const applied=await retained(page,c=>c.head.state.sequenceDesk.history.some(h=>h.proposal.command.note===requestedNote('original complete delivery sequence review')),'Retain complete original delivery changes');
   const actual=await page.evaluate(async ({state,key})=>{const Q=await import('/portfolio-sequence.mjs');return Q.sequenceView(state.draft,state.sourceTasks,state.installationCandidates).rows.find(r=>r.key===key);},{state:applied.head.state,key:course.rowKey});
   assert.deepEqual(actual.values,course.afterValues);assert.ok(actual.values.dependsOn.includes(course.addedPredecessor));
   await saveDownload(page,()=>sa('csv'),'portfolio-delivery-complete-sequence.csv');await saveDownload(page,()=>sa('json'),'portfolio-delivery-complete-data.json');
   const file=await saveDownload(page,()=>action(page,'working-export'),'portfolio-delivery-complete-working-copy.json'),received=await verifyFile(file.path);assert.deepEqual(received.value.copy.head.state.sequenceDesk,applied.head.state.sequenceDesk);
   await open(page);assert.deepEqual((await selected(page)).head.state.sequenceDesk,applied.head.state.sequenceDesk);
   await page.locator('[data-portfolio-action=tab][data-id=inputs]').click();
   return {copyId:course.copyId,taskId:course.taskId,phaseId:course.phaseId,forecastId:course.forecastId,beforeValues:course.beforeValues,afterValues:actual.values,addedPredecessor:course.addedPredecessor,fullSources:received.attachments,originalSourceDatesUnchanged:true};
  });
 }
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
 await verifyRetainedArtifacts(progress,out,'the complete receiving result');
 return {schema:'stellar-forge.portfolio-working-copy-browser.v1',operationId:input.operationId,caseId:input.caseId,mode:'operate',completedAt:stamp(),selectedCopyId:saved.copyId,savedPortfolioId:saved.portfolioId,savedPortfolioSha256:saved.sha256,phases:progress.phases,files:progress.files,visualReview:progress.visualReview,sourcePortfolioId:original.id,sourcePortfolioSha256:original.sha256};
}
