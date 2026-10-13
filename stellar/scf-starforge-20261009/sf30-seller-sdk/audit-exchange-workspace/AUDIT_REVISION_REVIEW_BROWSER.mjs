#!/usr/bin/env node
/** Operate the installed recipient controls against one original author workspace. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const args={};for(let i=2;i<process.argv.length;i+=2){if(!process.argv[i].startsWith('--')||!process.argv[i+1])throw Error('Use complete named arguments.');args[process.argv[i].slice(2)]=process.argv[i+1];}
for(const key of ['directory','selection','url','chromium','playwright-module'])if(!args[key])throw Error('Missing --'+key);
const root=path.resolve(args.directory);await fs.mkdir(root,{recursive:true,mode:0o700});
const hash=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const encoded=v=>Buffer.from(canonical(v)+'\n'),same=(a,b)=>canonical(a)===canonical(b);
function need(v,m){if(!v)throw Error(m);}
async function publish(name,bytes){const file=path.join(root,name),pending=file+'.pending-'+process.pid;await fs.mkdir(path.dirname(file),{recursive:true});try{const out=await fs.open(pending,'wx',0o600);try{await out.writeFile(bytes);await out.sync();}finally{await out.close();}try{await fs.link(pending,file);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(file)).equals(bytes),'Preserve differing original '+name);}const dir=await fs.open(path.dirname(file),'r');try{await dir.sync();}finally{await dir.close();}}finally{await fs.unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
async function read(name){try{return JSON.parse(await fs.readFile(path.join(root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const selectionRaw=await fs.readFile(args.selection),selection=JSON.parse(selectionRaw);
const input={schema:'commons.audit-review-transition-browser-input.v1',selectionSha256:hash(selectionRaw),workspaceId:selection.workspaceId};
await publish('INPUT.json',encoded(input));
const complete=await read('BROWSER_RESULT.json');
if(complete){need(same(complete.input,input),'The completed browser selected another original case.');for(const row of complete.files){const b=await fs.readFile(path.join(root,row.path));need(b.length===row.bytes&&hash(b)===row.sha256,'The retained browser member differs.');}process.stdout.write(JSON.stringify(complete)+'\n');process.exit(0);}
const req=createRequire(import.meta.url),module=req(args['playwright-module']),chromium=module.chromium||module.default?.chromium;
let opening,context,closing,stopped=false;
const close=()=>closing||(closing=Promise.resolve(opening).then(v=>v?.close()));
const stop=()=>{stopped=true;process.exitCode=130;close().catch(()=>{});};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
opening=chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:args.chromium,viewport:{width:1365,height:960},acceptDownloads:true,args:['--no-sandbox','--disable-dev-shm-usage']});
context=await opening;if(stopped){await close();throw Error('Original browser interrupted.');}
const page=context.pages()[0]||await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)));
let attempt=1;for(;;attempt++){try{await fs.mkdir(path.join(root,'screens-'+attempt));break;}catch(e){if(e.code!=='EEXIST')throw e;}}
const screenDir='screens-'+attempt,files=[];
async function idle(){await page.waitForFunction(()=>document.body.getAttribute('aria-busy')==='false');}
async function shot(name){await publish(screenDir+'/'+name+'.png',await page.screenshot({fullPage:true}));}
async function connect(){await page.goto(args.url);await page.locator('#actor').fill(selection.specification.actor);await page.locator('#workspace-pin').fill(selection.workspaceId);await page.locator('#connect-form button').click();await idle();await page.waitForFunction(id=>document.getElementById('connection-status').textContent.includes(id),selection.workspaceId);await page.locator('[data-section="review-following"]').click();await idle();}
async function download(click,name){const waiting=page.waitForEvent('download');await click();const item=await waiting,temp=path.join(root,'.download-'+process.pid);try{await item.saveAs(temp);need(!await item.failure(),'The original complete download failed.');await publish(name,await fs.readFile(temp));}finally{await fs.unlink(temp).catch(()=>{});}await idle();}
async function restoreRequest(name){const wrapper=path.join(root,name+'-pending.json');const original=await read(name+'-request.json');need(original,'Retain the complete original request.');await publish(name+'-pending.json',encoded({format:'commons.audit-exchange.pending.v1',workspaceId:selection.workspaceId,serverUrl:args.url,status:'outcome unknown',envelope:original}));const detail=page.locator('details').filter({has:page.locator('#recover-file-form')});if(!await detail.evaluate(n=>n.open))await detail.locator('summary').click();await page.locator('#recover-file').setInputFiles(wrapper);await page.locator('#recover-file-form button').click();await idle();await page.waitForFunction(id=>document.getElementById('recovery-description').textContent.includes(id),original.requestId);}
async function transaction(name,action,dispatch,artifact=null,lose=false){
  const prior=await read(name+'-request.json');let captured=prior,response=null;
  await page.route('**/api/action',async route=>{
    const body=route.request().postDataJSON();if(body.action!==action){await route.continue();return;}
    if(captured)need(same(body,captured),'Preserve the original complete queue request.');
    else{captured=body;await publish(name+'-request.json',encoded(body));}
    const answer=await route.fetch(),raw=await answer.body(),value=JSON.parse(raw);
    if(value.ok){await publish(name+'-accepted.json',encoded({request:body,result:value.result}));response=value;}
    if(lose&&!prior&&value.ok){lose=false;await route.abort('failed');}else await route.fulfill({response:answer,body:raw});
  });
  async function recover(){await restoreRequest(name);if(artifact)await download(()=>page.locator('#recover-request').click(),artifact);else{await page.locator('#recover-request').click();await idle();}}
  try{
    if(prior)await recover();
    else if(lose){await dispatch();await idle();need(await read(name+'-accepted.json'),'The original revision-review save was not accepted.');await shot('02-accepted-original-response-lost');await page.reload();await connect();await recover();}
    else if(artifact)await download(dispatch,artifact);
    else{await dispatch();await idle();}
    const accepted=await read(name+'-accepted.json');need(accepted&&response,'The exact original request has no accepted response.');return accepted;
  }finally{await page.unroute('**/api/action');}
}
async function recoverOutstanding(){
  if(await page.locator('#download-request').isDisabled())return;
  const file=screenDir+'/retained-pending.json';await download(()=>page.locator('#download-request').click(),file);const held=await read(file);
  need(held?.workspaceId===selection.workspaceId&&held.envelope,'Preserve the complete original pending request.');
  for(const name of ['apply']){
    const request=await read(name+'-request.json');
    if(request&&same(request,held.envelope)){await transaction(name,request.action,()=>{throw Error('Do not replace an original request.');},'Audit_Revision_Review.zip');return;}
  }throw Error('Preserve the unrelated original pending request; it is not owned by this revision-review course.');
}

async function persisted(){await page.waitForFunction(()=>document.getElementById('revision-review-persistence').textContent.includes('retained'));}
async function openWorking(file){await page.locator('#revision-review-import-file').setInputFiles(path.join(root,file));await page.locator('#revision-review-import button').click();await idle();await persisted();}
try{
 await connect();await recoverOutstanding();
 if(!await read('apply-request.json')){
   const spec=selection.specification;
   await page.locator('#revision-review-new').click();await idle();await persisted();await shot('01-empty-review');
   await page.locator('#revision-review-name').fill(spec.title);
   await page.locator('#revision-review-note').fill(spec.note);
   await page.locator('#revision-review-source').selectOption(spec.sourceId);await persisted();
   // Source selections may exceed one table page. Walk the visible native rows
   // and compare their full title/status/assignee/revision against frozen previews.
   const remaining=new Map(selection.preview.reviews.map(r=>[r.review.id,r.review]));
   while(remaining.size){
     const rows=page.locator('#revision-review-candidates tbody tr'),count=await rows.count();
     for(let i=0;i<count;i++){
       const row=rows.nth(i),id=await row.locator('input[type=checkbox]').getAttribute('data-review-id');
       if(remaining.has(id)){await row.locator('input[type=checkbox]').check();remaining.delete(id);await persisted();}
     }
     if(!remaining.size)break;
     const next=page.locator('#revision-review-candidates').getByRole('button',{name:'Next',exact:true});
     need(!await next.isDisabled(),'A selected original review is missing from the current candidate table.');await next.click();await idle();
   }
   // The selection order is intentionally the frozen original order.
   // Restore a complete working body containing only this explicit selection,
   // before generating the native preview from the real control.
   const seed={format:'commons.audit-review-transition-working.v1',workspaceId:spec.workspaceId,title:spec.title,sourceId:spec.sourceId,reviewIds:spec.reviewIds,
     preview:null,decisions:[],note:spec.note,activeReviewId:null,receipts:[]};
   await publish('Selected_Working.json',encoded(seed));await openWorking('Selected_Working.json');
   await page.locator('#revision-review-preview').click();await idle();await persisted();
   await download(()=>page.locator('#revision-review-download').click(),'Native_Preview_Working.json');
   const actual=await read('Native_Preview_Working.json');
   need(same(actual.preview,selection.preview),'The visible native impact preview differs from the selected original.');
   for(const decision of spec.decisions){
     let found=false;
     while(!found){
       const row=page.locator('#revision-review-decisions button[data-review-id="'+decision.reviewId+'"]');
       if(await row.count()){await row.click();await idle();found=true;break;}
       const next=page.locator('#revision-review-decisions').getByRole('button',{name:'Next',exact:true});
       need(!await next.isDisabled(),'A complete selected decision is absent.');await next.click();await idle();
     }
     await page.locator('#revision-review-mode').selectOption(decision.mode);
     await page.locator('#revision-review-reason').fill(decision.reason);
     if(decision.mode==='update'){
       const v=decision.review;await page.locator('#revision-review-entity').selectOption(v.entityKey);
       await page.locator('#revision-review-field-status').selectOption(v.status);
       for(const field of ['title','note','assignee','dueDate'])await page.locator('#revision-review-field-'+field).fill(v[field]);
       await page.locator('#revision-review-field-evidence').fill(v.evidence.map(r=>r.label+' | '+r.url).join('\n'));
     }
     await page.locator('#revision-review-decision button[type=submit]').click();await idle();await persisted();
     // Return to the first page before choosing the next original ID.
     const previous=page.locator('#revision-review-decisions').getByRole('button',{name:'Previous',exact:true});
     while(!await previous.isDisabled()){await previous.click();await idle();}
   }
   await download(()=>page.locator('#revision-review-download').click(),'Unfinished_Reviewed_Working.json');
   const held=await read('Unfinished_Reviewed_Working.json');need(same(held.decisions,spec.decisions),'Every complete authored decision must survive the actual fields.');
   await page.reload();await connect();await openWorking('Unfinished_Reviewed_Working.json');
   await download(()=>page.locator('#revision-review-download').click(),'Reopened_Reviewed_Working.json');
   need(same(await read('Unfinished_Reviewed_Working.json'),await read('Reopened_Reviewed_Working.json')),'Complete unfinished review did not reopen.');
   const details=page.locator('#revision-review-native details');for(let i=0;i<await details.count();i++){await details.nth(i).locator('summary').click();await page.waitForFunction(i=>document.querySelectorAll('#revision-review-native details')[i].querySelector('pre').textContent.length>0,i);await details.nth(i).locator('summary').click();await page.waitForFunction(i=>document.querySelectorAll('#revision-review-native details')[i].querySelector('pre').textContent==='',i);}
   await shot('02-complete-reviewed-impact');
 }
 const applied=await transaction('apply','review.transition.apply',()=>page.locator('#revision-review-apply').click(),'Audit_Revision_Review.zip',true);
 need(same(applied.request.inputs,{sourceId:selection.specification.sourceId,toRevisionId:selection.specification.toRevisionId,reviewIds:selection.specification.reviewIds,
   previewSha256:selection.preview.previewSha256,decisions:selection.specification.decisions,actor:selection.specification.actor,note:selection.specification.note}),'The dispatched original decision differs from the full selected request.');
 await page.reload();await connect();await shot('03-applied-history-desktop');
 const history=page.locator('#revision-review-history tbody tr').filter({hasText:applied.result.archive.sha256});
 need(await history.count()===1,'The complete saved source archive is absent from installed history.');
 await download(()=>history.getByRole('button',{name:applied.result.archive.name,exact:true}).click(),'Audit_Revision_Review_Reopened.zip');
 need((await fs.readFile(path.join(root,'Audit_Revision_Review.zip'))).equals(await fs.readFile(path.join(root,'Audit_Revision_Review_Reopened.zip'))),'Reopened source archive bytes differ.');
 await page.setViewportSize({width:390,height:844});await shot('04-applied-history-narrow');
 need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The installed review page overflows a narrow viewport.');
 need(errors.length===0,'Browser errors: '+errors.join('; '));
 for(const name of await fs.readdir(path.join(root,screenDir))){const raw=await fs.readFile(path.join(root,screenDir,name));files.push({path:screenDir+'/'+name,bytes:raw.length,sha256:hash(raw)});}
 for(const name of ['Selected_Working.json','Native_Preview_Working.json','Unfinished_Reviewed_Working.json','Reopened_Reviewed_Working.json','apply-request.json','apply-accepted.json','Audit_Revision_Review.zip','Audit_Revision_Review_Reopened.zip']){const raw=await fs.readFile(path.join(root,name));files.push({path:name,bytes:raw.length,sha256:hash(raw)});}
 const result={schema:'commons.audit-review-transition-browser-result.v1',input,applied,files,errors,renderedRecipientReady:false,
  remaining:'Producing operator must personally inspect these desktop/narrow images and open every outgoing attachment, including the complete review OPEN.html and XML/source history.'};
 await publish('BROWSER_RESULT.json',encoded(result));process.stdout.write(JSON.stringify(result)+'\n');
}finally{await close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
