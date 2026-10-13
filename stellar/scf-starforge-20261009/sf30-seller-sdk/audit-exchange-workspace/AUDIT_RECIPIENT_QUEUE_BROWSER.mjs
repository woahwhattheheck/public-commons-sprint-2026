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
const input={schema:'commons.audit-recipient-queue-browser-input.v1',selectionSha256:hash(selectionRaw),workspaceId:selection.workspaceId};
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
async function connect(){await page.goto(args.url);await page.locator('#actor').fill(selection.operator);await page.locator('#workspace-pin').fill(selection.workspaceId);await page.locator('#connect-form button').click();await idle();await page.waitForFunction(id=>document.getElementById('connection-status').textContent.includes(id),selection.workspaceId);await page.locator('[data-section="exports"]').click();await idle();}
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
    else if(lose){await dispatch();await idle();need(await read(name+'-accepted.json'),'The original queue save was not accepted.');await shot('02-accepted-original-response-lost');await page.reload();await connect();await recover();}
    else if(artifact)await download(dispatch,artifact);
    else{await dispatch();await idle();}
    const accepted=await read(name+'-accepted.json');need(accepted&&response,'The exact original request has no accepted response.');return accepted;
  }finally{await page.unroute('**/api/action');}
}
async function recoverOutstanding(){
  if(await page.locator('#download-request').isDisabled())return;
  const file=screenDir+'/retained-pending.json';await download(()=>page.locator('#download-request').click(),file);const held=await read(file);
  need(held?.workspaceId===selection.workspaceId&&held.envelope,'Preserve the complete original pending request.');
  for(const name of ['first','following','export']){
    const request=await read(name+'-request.json');
    if(request&&same(request,held.envelope)){await transaction(name,request.action,()=>{throw Error('Do not replace an original request.');},name==='export'?'Audit_Recipient_Queue_Complete.zip':null);return;}
  }throw Error('Preserve the unrelated original pending request; it is not owned by this queue course.');
}
async function openSaved(id){await page.locator('#recipient-queue-saved').selectOption(id);await page.locator('#recipient-queue-open').click();await idle();await page.waitForFunction(()=>document.getElementById('recipient-queue-persistence').textContent.includes('retained'));}
try{
 await connect();await recoverOutstanding();
 if(!await read('first-request.json')){
   await page.locator('#recipient-queue-new').click();await idle();await shot('01-empty-queue');
   await page.locator('#recipient-queue-title').fill(selection.title);
   await page.locator('#recipient-queue-note').fill(selection.note);
   for(const row of selection.returns){await page.locator('#recipient-queue-add-select').selectOption(row.id);await page.locator('#recipient-queue-add').click();await idle();}
   await page.locator('#recipient-queue-rows textarea').first().fill('Unfinished original staff note — retained before native save.');
   await page.waitForFunction(()=>document.getElementById('recipient-queue-persistence').textContent.includes('retained'));
   await download(()=>page.locator('#recipient-queue-download-working').click(),'Queue_Unfinished_Original.json');
   await page.reload();await connect();await page.locator('#recipient-queue-import').setInputFiles(path.join(root,'Queue_Unfinished_Original.json'));await idle();
   need(await page.locator('#recipient-queue-title').inputValue()===selection.title,'The complete queue title did not reopen.');
   need(await page.locator('#recipient-queue-rows textarea').first().inputValue()==='Unfinished original staff note — retained before native save.','The unfinished row note did not reopen.');
 }
 const first=await transaction('first','recipient.queue.save',()=>page.locator('#recipient-queue-save').click(),null,true);
 await openSaved(first.result.archive.id);
 if(!await read('following-request.json')){
   await page.locator('#recipient-queue-note').fill(selection.note+' Following edition retains the complete earlier selection.');
   await page.locator('#recipient-queue-rows select').first().selectOption('deferred');
   await page.locator('#recipient-queue-rows textarea').first().fill('Explicitly deferred for the next staff review; original return is retained.');
   if(selection.returns.length>1){await page.locator('#recipient-queue-rows').locator('tr').first().getByRole('button',{name:'Down',exact:true}).click();}
 }
 const following=await transaction('following','recipient.queue.save',()=>page.locator('#recipient-queue-save').click());
 await openSaved(following.result.archive.id);await shot('03-saved-following-queue');
 await download(()=>page.locator('#recipient-queue-download-history').click(),'Queue_Complete_History.json');
 await download(()=>page.locator('#recipient-queue-download-working').click(),'Queue_Following_Working.json');
 const exported=await transaction('export','recipient.queue.export',()=>page.locator('#recipient-queue-export').click(),'Audit_Recipient_Queue_Complete.zip');
 await page.reload();await connect();await openSaved(following.result.archive.id);
 need(await page.locator('#recipient-queue-rows tr').count()===selection.returns.length,'A complete selected return disappeared on reopen.');
 await page.locator('#recipient-queue-rows').locator('tr').first().getByRole('button',{name:'Inspect progress',exact:true}).click();await idle();
 await shot('04-reopened-desktop');await page.setViewportSize({width:390,height:844});await shot('05-reopened-narrow');
 need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The queue page overflows a narrow viewport.');
 need(errors.length===0,'Browser errors: '+errors.join('; '));
 for(const name of await fs.readdir(path.join(root,screenDir))){const raw=await fs.readFile(path.join(root,screenDir,name));files.push({path:screenDir+'/'+name,bytes:raw.length,sha256:hash(raw)});}
 for(const name of ['first-request.json','first-accepted.json','following-request.json','following-accepted.json','export-request.json','export-accepted.json','Queue_Unfinished_Original.json','Queue_Complete_History.json','Queue_Following_Working.json','Audit_Recipient_Queue_Complete.zip']){const raw=await fs.readFile(path.join(root,name));files.push({path:name,bytes:raw.length,sha256:hash(raw)});}
 const result={schema:'commons.audit-recipient-queue-browser-result.v1',input,first,following,exported,files,errors,renderedRecipientReady:false,remaining:'Producing operator must personally inspect these desktop/narrow images and open every outgoing attachment including the complete queue OPEN.html.'};
 await publish('BROWSER_RESULT.json',encoded(result));process.stdout.write(JSON.stringify(result)+'\n');
}finally{await close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
