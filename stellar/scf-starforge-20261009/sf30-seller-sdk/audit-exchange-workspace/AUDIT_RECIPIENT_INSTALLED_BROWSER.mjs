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
const input={schema:'commons.audit-recipient-installed-browser-input.v1',selectionSha256:hash(selectionRaw),workspaceId:selection.workspaceId};
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
async function transaction(name,action,dispatch,artifact,lose=false){
  const original=await read(name+'-request.json');
  let captured=original,response=null;
  await page.route('**/api/action',async route=>{
    const body=route.request().postDataJSON();
    if(body.action!==action){await route.continue();return;}
    if(captured)need(same(body,captured),'An original '+action+' request was replaced.');
    else{captured=body;await publish(name+'-request.json',encoded(body));}
    const answer=await route.fetch(),raw=await answer.body(),value=JSON.parse(raw);
    if(value.ok){await publish(name+'-accepted.json',encoded({request:body,result:value.result}));response=value;}
    if(lose&&!original&&value.ok){lose=false;await route.abort('failed');}else await route.fulfill({response:answer,body:raw});
  });
  try{
    if(original){await restoreRequest(name);await download(()=>page.locator('#recover-request').click(),artifact||'Audit_Recipient_Staged.zip');}
    else if(lose){
      await dispatch();await idle();need(await read(name+'-accepted.json'),'The response-loss course did not reach an accepted original request.');
      await shot('04-accepted-response-unavailable');await page.reload();await page.locator('#connect-form button').click();await idle();await page.locator('[data-section="exports"]').click();await idle();
      await restoreRequest(name);await download(()=>page.locator('#recover-request').click(),artifact);
    }else if(artifact)await download(dispatch,artifact);
    else{await dispatch();await idle();}
    const accepted=await read(name+'-accepted.json');need(accepted&&response,'The original action has no accepted reply.');return accepted;
  }finally{await page.unroute('**/api/action');}
}
async function recoverOutstanding(){
  if(await page.locator('#download-request').isDisabled())return;
  const pendingPath=screenDir+'/original-pending-request.json';
  await download(()=>page.locator('#download-request').click(),pendingPath);
  const held=await read(pendingPath);
  need(held?.format==='commons.audit-exchange.pending.v1'&&held.workspaceId===selection.workspaceId&&held.envelope,
    'Preserve the original pending request; it belongs to another workspace or has incomplete custody.');
  const names={'recipient.prepare':'prepare','recipient.stage':'stage','recipient.apply':'apply'},name=names[held.envelope.action];
  need(name,'Preserve the unrelated original pending request before continuing this recipient course.');
  const issued=await read(name+'-request.json');
  need(issued&&same(issued,held.envelope),
    'Preserve both originals: the browser pending body does not match this course\'s retained request.');
  need(held.envelope.inputs?.actor===selection.operator,'The pending request belongs to a different original operator.');
  const artifacts={prepare:'Audit_Recipient_Complete.zip',stage:'Audit_Recipient_Staged.zip',apply:'Audit_Recipient_Accepted.zip'};
  await transaction(name,held.envelope.action,()=>{throw Error('An original pending request cannot be replaced.');},artifacts[name]);
  need(await page.locator('#download-request').isDisabled(),'The original pending request was not reconciled.');
}
try{
 await connect();await recoverOutstanding();await shot('01-installed-exports');
 // Actual current data exposes both the populated source selection and the empty return selection.
 await page.locator('#recipient-return').selectOption('');await shot('02-unselected-return');
 await page.locator('#recipient-author-export').selectOption(selection.originalExportId);
 await page.locator('#recipient-prepare-note').fill('Complete original recipient editor through the installed author workspace.');
 const prepared=await transaction('prepare','recipient.prepare',()=>page.locator('#recipient-prepare').click(),'Audit_Recipient_Complete.zip');
 // Select the complete original return produced by the completed recipient course.
 await page.locator('#recipient-return-file').setInputFiles(selection.returnPath);
 await page.locator('#recipient-stage-note').fill('Retain the whole original recipient return and exact source.');
 const staged=await transaction('stage','recipient.stage',()=>page.locator('#recipient-stage').click(),null);
 await page.locator('#recipient-return').selectOption(staged.result.archive.id);
 const retainedApply=await read('apply-request.json');
 if(!retainedApply){
   await page.locator('#recipient-preview').click();await idle();
   await page.waitForFunction(()=>!document.getElementById('recipient-apply').disabled);
   await download(()=>page.locator('#recipient-download-preview').click(),'Audit_Recipient_Preview.json');
 }
 const preview=JSON.parse(await fs.readFile(path.join(root,'Audit_Recipient_Preview.json'),'utf8'));
 if(retainedApply)need(same(preview,retainedApply.inputs.preview),'Retain the exact original apply preview.');
 need(preview.workspaceId===selection.workspaceId&&preview.returnSha256===selection.returnSha256,'The visible preview selected another full return.');
 // Exercise the real stale-selection control without dispatching a new native intent.
 await page.locator('#actor').fill(selection.operator+' changed');
 need(await page.locator('#recipient-apply').isDisabled(),'A changed operator left the old preview applicable.');
 await shot('03-stale-operator-preview');await page.locator('#actor').fill(selection.operator);
 await page.locator('#recipient-apply-note').fill('Accept the exact preview; preserve original accepted review request identities.');
 const applied=await transaction('apply','recipient.apply',()=>page.locator('#recipient-apply').click(),'Audit_Recipient_Accepted.zip',true);
 await shot('05-original-request-recovered');
 await download(()=>page.locator('#recipient-download-return').click(),'Audit_Recipient_Return.zip');
 const returned=await fs.readFile(path.join(root,'Audit_Recipient_Return.zip'));need(returned.length===selection.returnBytes&&hash(returned)===selection.returnSha256,'The installed complete return changed original bytes.');
 await page.reload();await page.locator('#connect-form button').click();await idle();await page.locator('[data-section="exports"]').click();await idle();
 await page.locator('#recipient-return').selectOption(staged.result.archive.id);await page.locator('#recipient-preview').click();await idle();await shot('06-reopened-installed-desktop');
 await page.setViewportSize({width:390,height:844});await shot('07-reopened-installed-phone');
 need(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'The installed recipient page overflows a narrow viewport.');
 need(errors.length===0,'Browser errors: '+errors.join('; '));
 for(const name of await fs.readdir(path.join(root,screenDir))){const b=await fs.readFile(path.join(root,screenDir,name));files.push({path:screenDir+'/'+name,bytes:b.length,sha256:hash(b)});}
 for(const name of ['prepare-request.json','prepare-accepted.json','stage-request.json','stage-accepted.json','apply-request.json','apply-accepted.json','Audit_Recipient_Complete.zip','Audit_Recipient_Preview.json','Audit_Recipient_Return.zip','Audit_Recipient_Accepted.zip']){const b=await fs.readFile(path.join(root,name));files.push({path:name,bytes:b.length,sha256:hash(b)});}
 const result={schema:'commons.audit-recipient-installed-browser-result.v1',input,prepared,staged,applied,files,errors,renderedRecipientReady:false,remaining:'Producing operator must personally inspect these actual desktop/narrow images and open every outgoing attachment.'};
 await publish('BROWSER_RESULT.json',encoded(result));process.stdout.write(JSON.stringify(result)+'\n');
}finally{await close();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
