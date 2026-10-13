// SPDX-License-Identifier: MIT
// Operates the exact outgoing review using the owner's existing browser Page.
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {openProject} from './project.mjs';
import {receiveSession} from './session.mjs';
import {inspectConfigurationCapture,canonical} from './core.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=(yes,message)=>{if(!yes)throw Error(message);};
export async function receiveConfigurationReview({page,applicationUrl,projectPath,outputDirectory,ownerCheck,actor}){
 need(page&&typeof ownerCheck==='function','Use the original owned Page and ownerCheck.');
 need(typeof actor==='string'&&actor.trim(),'Supply the actual receiving operator.');
 const originalBytes=await fs.readFile(projectPath),original=openProject(originalBytes.toString('utf8'));
 need(original.capture.schema==='otobo.review-source.v1'&&original.capture.source&&original.capture.before&&original.capture.after,'Select a complete reviewed reference with independent after capture.');
 await ownerCheck();
 const attempt='otobo-review-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8),root=join(resolve(outputDirectory),attempt);
 await fs.mkdir(root,{recursive:true,mode:0o700});
 const result={schema:'tjlabs.otobo-browser-receiving.v1',attempt,source:{path:resolve(projectPath),bytes:originalBytes.length,sha256:sha(originalBytes)},files:[],screens:[],families:[],dialogs:[],complete:false,visualInspection:'pending actual producing-peer viewing'};
 const checkpoint=async()=>{const temp=join(root,'result.json.tmp');await fs.writeFile(temp,JSON.stringify(result,null,2)+'\n',{mode:0o600});await fs.rename(temp,join(root,'result.json'));};
 async function retain(name,bytes){const path=join(root,name);await fs.writeFile(path,bytes,{flag:'wx',mode:0o600});const row={path,bytes:bytes.length,sha256:sha(bytes)};result.files.push(row);await checkpoint();return row;}
 async function idle(){await page.waitForFunction(()=>document.documentElement.dataset.otoboReading!=='true');}
 async function noError(){need(!result.unexpectedDialog,'Unexpected receiving dialog: '+result.unexpectedDialog);need(!(await page.locator('#error').isVisible()),'Review displayed an error: '+await page.locator('#error').textContent());}
 async function click(id){await ownerCheck();await page.locator('#'+id).click();await idle();}
 async function tab(name){await ownerCheck();await page.locator('[data-tab="'+name+'"]').click();need(await page.locator('#panel-'+name).isVisible(),'Selected section is not visible.');}
 async function select(id,value){await ownerCheck();await page.locator('#'+id).setInputFiles(value);await idle();}
 async function download(id,name){await ownerCheck();const waiting=page.waitForEvent('download');await click(id);const d=await waiting;need(!(await d.failure()),'Download failed: '+name);const path=join(root,name);await d.saveAs(path);const bytes=await fs.readFile(path),row={path,bytes:bytes.length,sha256:sha(bytes)};result.files.push(row);await checkpoint();return row;}
 async function screenshot(name,width){await ownerCheck();await page.setViewportSize({width,height:1000});const size=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));need(size.scroll<=size.width+1,'Document overflows the selected viewport.');const row=await retain(name,await page.screenshot({fullPage:true}));result.screens.push(row);await checkpoint();}
 const dialog=async value=>{try{await ownerCheck();result.dialogs.push(value.message());if(value.message().startsWith('Open this working copy?'))await value.accept();else{result.unexpectedDialog=value.message();await value.dismiss();}}catch(error){result.unexpectedDialog=error.message;try{await value.dismiss();}catch{}}};
 page.on('dialog',dialog);
 try{
  const url=new URL(applicationUrl);need(['http:','https:','file:'].includes(url.protocol),'Use the actual installed application or complete offline file.');
  await ownerCheck();const response=await page.goto(url.href,{waitUntil:'domcontentloaded'});need(response?.ok()||!response&&url.protocol==='file:','Review did not open.');
  await page.waitForFunction(()=>document.documentElement.dataset.otoboReviewReady==='true');
  for(const width of [1440,390])await screenshot('empty-'+width+'.png',width);
  await select('source-file',{name:'invalid-utf8.json',mimeType:'application/json',buffer:Buffer.from([0xff,0xfe,0x41])});
  need(await page.locator('#error').isVisible(),'Invalid UTF-8 did not show a recovery error.');
  await screenshot('invalid-source-390.png',390);
  const rejected=await download('download-selected','selected-invalid-original.bin');
  need((await fs.readFile(rejected.path)).equals(Buffer.from([0xff,0xfe,0x41])),'Rejected original bytes changed.');
  const texts={source:'\uFEFF'+JSON.stringify(original.capture.source,null,2)+'\n',before:JSON.stringify(original.capture.before,null,2)+'\n',after:JSON.stringify(original.capture.after,null,2)+'\n'};
  for(const role of ['source','before']){await select(role+'-file',{name:role+'.json',mimeType:'application/json',buffer:Buffer.from(texts[role])});await noError();}
  const intake=await download('save-working','original-preplan-working.json'),intakeBody=receiveSession(await fs.readFile(intake.path,'utf8'));
  need(intakeBody.working.intake.source.text===texts.source&&intakeBody.working.intake.before.text===texts.before&&!intakeBody.working.project,'Exact original intake was not retained.');
  await tab('plan');await select('plan-file',{name:'original-plan.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(original.mapping,null,2)+'\n')});await noError();
  const first=await page.locator('[data-record]').first().getAttribute('data-record');
  await page.locator('[data-record]').first().click();await page.locator('#overrides-json').fill('[{"path":');
  const unfinished=await download('save-working','unfinished-decision-working.json'),unfinishedBody=receiveSession(await fs.readFile(unfinished.path,'utf8'));
  need(unfinishedBody.working.editor.decisionDrafts[first].overridesText==='[{"path":','Unfinished decision text was lost.');
  await select('restore-file',unfinished.path);await noError();need(await page.locator('#overrides-json').inputValue()==='[{"path":','Unfinished decision did not reopen.');
  await page.locator('#decision-form button[type="submit"]').click();need(await page.locator('#error').isVisible(),'Malformed decision JSON did not remain recoverable.');
  await click('discard-decision-draft');await noError();
  const projectId='browser-before-'+randomUUID().slice(0,8);
  await page.locator('#project-id').fill(projectId);await page.locator('#reviewer').fill(actor.trim());await page.locator('#review-reason').fill('Reviewed the complete original ten-family plan and target baseline.');await page.locator('#approve').check();
  await click('save-reviewed');await noError();
  const beforeProject=await download('download-project','approved-before-project.json'),before=openProject(await fs.readFile(beforeProject.path,'utf8'));
  need(before.approval&&before.capture.after===null,'Pre-import project is not independently approved.');
  const approvedPlan=await download('download-plan','approved-native-plan.json');need(canonical(JSON.parse(await fs.readFile(approvedPlan.path,'utf8')))===canonical(original.mapping),'Approved native plan changed.');
  await tab('intake');await select('after-file',{name:'independent-after.json',mimeType:'application/json',buffer:Buffer.from(texts.after)});await noError();
  const afterIntake=await download('save-working','after-intake-working.json'),afterBody=receiveSession(await fs.readFile(afterIntake.path,'utf8'));
  need(afterBody.working.project===null&&afterBody.history.some(h=>canonical(h.working.project)===canonical(before)),'After intake lost the complete prior approved project.');
  await tab('plan');await page.locator('#project-id').fill('browser-after-'+randomUUID().slice(0,8));await page.locator('#review-reason').fill('Reviewed the independent returned capture and full configuration differences.');await page.locator('#approve').check();await click('save-reviewed');await noError();
  const approvedAfter=await download('download-project','approved-after-project.json'),after=openProject(await fs.readFile(approvedAfter.path,'utf8'));
  need(after.approval&&canonical(after.capture.after)===canonical(original.capture.after),'Returned target is not bound to the actual approved project.');
  await tab('comparison');const prepared=await download('download-comparison','native-comparison-input.json'),packet=JSON.parse(await fs.readFile(prepared.path,'utf8'));
  need(packet.manifest.schema==='otobo.prepared.v1'&&Array.isArray(packet.files),'Original native comparison source is incomplete.');
  await download('download-findings','complete-returned-findings.json');
  for(const family of await page.locator('#family-filter option').evaluateAll(nodes=>nodes.map(n=>n.value).filter(v=>v!=='all'))){
   await tab('plan');await page.locator('#family-filter').selectOption(family);
   const records=page.locator('[data-record]');
   for(let i=0;i<await records.count();i++){await ownerCheck();await records.nth(i).click();need(await page.locator('#record-detail').isVisible(),'Full native record did not open.');}
   result.families.push(family);
  }
  await page.locator('#family-filter').selectOption('all');await page.locator('#record-filter').fill('__receiving_no_match__');need(await page.locator('[data-record]').count()===0,'Filtered empty state did not open.');await page.locator('#record-filter').fill('');
  for(const section of ['intake','plan','comparison','history','files','native']){await tab(section);for(const width of [1440,390])await screenshot(section+'-'+width+'.png',width);}
  await tab('files');
  const sourceFiles=[];for(const role of ['source','before','after'])for(const file of inspectConfigurationCapture(original.capture[role]).files.values())sourceFiles.push({role,file});
  need(await page.locator('[data-file-id]').count()===sourceFiles.length,'Original file list omits retained members.');
  for(let i=0;i<sourceFiles.length;i++){
   const {role,file}=sourceFiles[i];await ownerCheck();const waiting=page.waitForEvent('download');await page.locator('[data-file-id]').nth(i).click();const d=await waiting;need(!(await d.failure()),'Original native file failed.');const path=join(root,'original-'+role+'-'+i+'.bin');await d.saveAs(path);const bytes=await fs.readFile(path);
   need(bytes.length===file.bytes&&sha(bytes)===file.sha256,'Original native file bytes changed: '+file.filename);result.files.push({path,bytes:bytes.length,sha256:sha(bytes)});
  }
  const whole=await download('save-working','complete-operated-working.json');await select('restore-file',whole.path);await noError();const reopened=await download('save-working','reopened-operated-working.json');need((await fs.readFile(whole.path)).equals(await fs.readFile(reopened.path)),'Whole operated workspace changed after reopen.');
  const final=receiveSession(await fs.readFile(whole.path,'utf8'));need(final.history.some(h=>h.working.project?.id===before.id),'Original pre-import project missing after full reopen.');
  result.approvedBefore=beforeProject;result.approvedAfter=approvedAfter;result.completeWorking=whole;result.prepared=prepared;result.complete=true;await checkpoint();return result;
 }catch(error){result.error=error.message;try{await checkpoint();}catch(retentionError){error.receivingRetentionError=retentionError.message;}error.receivingResult=result;throw error;}
 finally{page.off('dialog',dialog);}
}
