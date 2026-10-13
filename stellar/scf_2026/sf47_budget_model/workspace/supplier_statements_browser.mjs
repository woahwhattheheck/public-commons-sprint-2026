#!/usr/bin/env node
import {readFile,mkdir,writeFile,open,link,unlink,lstat} from 'node:fs/promises';
import {fstatSync,lstatSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import http from 'node:http';
const args=process.argv.slice(2),at=args.indexOf('--selection');
if(at<0||!args[at+1])throw Error('Select the complete original browser operation.');
const selection=JSON.parse(await readFile(args[at+1],'utf8')),out=resolve(selection.output),digest=raw=>createHash('sha256').update(raw).digest('hex');
const lockText=process.env.SCF_SUPPLIER_RECEIVING_LOCK_FD??'',lock=Number(lockText),lockPath=resolve(dirname(args[at+1]),'supplier-statement-operation.lock');
if(!/^[0-9]+$/.test(lockText)||!Number.isSafeInteger(lock)||lock<0||process.env.SCF_SUPPLIER_RECEIVING_LOCK_PATH!==lockPath)throw Error('Run through the original selected native receiving lease.');
const heldLock=fstatSync(lock),selectedLock=lstatSync(lockPath);
if(!heldLock.isFile()||!selectedLock.isFile()||selectedLock.isSymbolicLink()||heldLock.dev!==selectedLock.dev||heldLock.ino!==selectedLock.ino||heldLock.nlink<1)throw Error('The inherited operation lock differs from the selected original file.');
await mkdir(out,{recursive:true,mode:0o700});
async function original(path,raw){raw=Buffer.isBuffer(raw)?raw:Buffer.from(raw);await mkdir(dirname(path),{recursive:true,mode:0o700});try{if(!(await readFile(path)).equals(raw))throw Error('Original browser output differs: '+path);return;}catch(e){if(e.code!=='ENOENT')throw e;}
 const temp=path+'.'+randomUUID();const fd=await open(temp,'wx',0o600);try{await fd.writeFile(raw);await fd.sync();}finally{await fd.close();}
 try{try{await link(temp,path);}catch(e){if(e.code!=='EEXIST')throw e;if(!(await readFile(path)).equals(raw))throw Error('Concurrent output differs.');}}finally{await unlink(temp);}
}
try{const result=JSON.parse(await readFile(join(out,'RESULT.json'),'utf8'));for(const row of result.files){const raw=await readFile(join(out,row.path));if(raw.length!==row.bytes||digest(raw)!==row.sha256)throw Error('The completed browser output differs.');}process.stdout.write(JSON.stringify(result)+'\n');process.exit(0);}catch(e){if(e.code!=='ENOENT')throw e;}
const req=createRequire(import.meta.url),loaded=req(selection.playwright),chromium=loaded.chromium??loaded.default?.chromium;
if(!chromium)throw Error('The actual selected Playwright module does not export Chromium.');
const events=[],files=[],faults=[];let context=null,stopping=false,server=null;
async function close(){if(stopping)return;stopping=true;await context?.close().catch(()=>{});await new Promise(resolve=>server?server.close(resolve):resolve());}
for(const sig of ['SIGTERM','SIGINT'])process.on(sig,()=>{close().finally(()=>process.exit(sig==='SIGTERM'?143:130));});
async function keep(name,raw){await original(join(out,name),raw);files.push({path:name,bytes:raw.length,sha256:digest(raw)});}
async function shot(page,name){try{const raw=await readFile(join(out,name));files.push({path:name,bytes:raw.length,sha256:digest(raw)});return;}catch(e){if(e.code!=='ENOENT')throw e;}const raw=await page.screenshot({fullPage:true});await keep(name,raw);}
async function download(page,click,name){const pending=page.waitForEvent('download',{timeout:30000});await click();const item=await pending,problem=await item.failure();if(problem)throw Error(problem);const raw=await readFile(await item.path());await keep(name,raw);return raw;}
try{
 context=await chromium.launchPersistentContext(join(out,'profile'),{executablePath:selection.chromium,headless:true,viewport:{width:1440,height:1000},acceptDownloads:true,args:['--no-sandbox']});
 const page=context.pages()[0]??await context.newPage();page.on('pageerror',e=>faults.push(e.message));
 const access=(await readFile(selection.browserUrlFile,'utf8')).trim();if(!access.startsWith(selection.url))throw Error('Use the original selected service browser URL.');
 await page.goto(access,{waitUntil:'domcontentloaded'});
 const operationNav=page.getByRole('button',{name:'Delivery operations',exact:true});
 if(await operationNav.count())await operationNav.click();
 else {const alternate=page.getByRole('tab',{name:'Delivery operations',exact:true});if(await alternate.count())await alternate.click();}
 const cases=page.getByLabel('Retained case',{exact:true});await cases.waitFor({state:'visible',timeout:30000});await cases.selectOption(selection.caseId);
 async function openSupplierDesk(){
  const navigation=page.locator('[data-ops-navigation]');
  if(await navigation.count()){
   const toggle=navigation.locator('[data-nav-toggle]');
   if(await toggle.isVisible()&&await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
   const sections=navigation.locator('[data-nav-section="supplier-statements"]');await sections.first().waitFor({state:'attached'});
   const group=navigation.locator('details[data-nav-group]').filter({has:page.locator('[data-nav-section="supplier-statements"]')}).first();
   if(await group.count()&&!(await group.evaluate(el=>el.open)))await group.locator('summary').click();
   for(const section of await sections.all()){if(await section.isVisible()){await section.click();return;}}
   throw Error('The selected original supplier section is not visible.');
  }
  await page.locator('[data-ops-tab="supplier-statements"]').click();
 }
 await openSupplierDesk();
 const desk=page.getByRole('region',{name:'Supplier statement reconciliation'});const root=page.locator('.supplier-statements');await root.waitFor({state:'visible',timeout:30000});
 await root.locator('[data-ss-action="open"][data-value="'+selection.reviewId+'"]').click();
 await root.locator('[data-ss-saved]').waitFor({state:'visible'});await page.waitForFunction(sha=>document.querySelector('.supplier-statements')?.textContent.includes(sha),selection.reviewSha256);
 await shot(page,'supplier-statement-desktop.png');
 let complete;try{complete=await readFile(join(out,'downloaded-supplier-statement.zip'));await keep('downloaded-supplier-statement.zip',complete);}catch(e){if(e.code!=='ENOENT')throw e;complete=await download(page,()=>root.getByRole('button',{name:'Download complete statement handover',exact:true}).click(),'downloaded-supplier-statement.zip');}
 // Repeated complete exports contain the same immutable review and originals.
 // ZIP metadata can be regenerated by the original case exporter; native reader
 // verifies member semantics when receiving, rather than pretending byte equality.
 if(complete.length===0)throw Error('The complete handover download is empty.');
 let working,held;try{working=await readFile(join(out,'working-desk.json'));held=JSON.parse(working);await keep('working-desk.json',working);await root.locator('[data-ss-import]').setInputFiles(join(out,'working-desk.json'));}catch(e){if(e.code!=='ENOENT')throw e;
 await root.getByRole('button',{name:'New statement',exact:true}).click();await root.getByLabel('Statement name',{exact:true}).waitFor({state:'visible'});await shot(page,'supplier-statement-empty-draft.png');
 await root.locator('[data-ss-action="open"][data-value="'+selection.reviewId+'"]').click();await root.locator('[data-ss-saved]').waitFor({state:'visible'});
 await root.getByRole('button',{name:'Prepare following edition',exact:true}).click();
 const title=root.getByLabel('Statement name',{exact:true});await title.waitFor({state:'visible'});
 const originalTitle=await title.inputValue();await title.fill(originalTitle+' — unfinished receiving note');
 working=await download(page,()=>root.getByRole('button',{name:'Download working desk',exact:true}).click(),'working-desk.json');held=JSON.parse(working);
 }
 const workingTitle=held.document.name;if(!workingTitle.endsWith(' — unfinished receiving note')||held.caseId!==selection.caseId)throw Error('Unfinished typed work is absent from the working export.');
 await page.waitForFunction(()=>document.querySelector('.supplier-statements')?.dataset.ssStorage==='saved');
 await page.reload({waitUntil:'domcontentloaded'});
 if(await operationNav.count())await operationNav.click();
 await cases.waitFor({state:'visible'});await cases.selectOption(selection.caseId);
 await openSupplierDesk();
 await root.getByLabel('Statement name',{exact:true}).waitFor({state:'visible'});
 if(await root.getByLabel('Statement name',{exact:true}).inputValue()!==workingTitle)throw Error('The original unfinished working desk did not reopen.');
 await root.locator('[data-ss-import]').setInputFiles(join(out,'working-desk.json'));
 await page.waitForFunction(name=>document.querySelector('[data-ss-field="name"]')?.value===name,workingTitle);
 let release,observed;const delayed=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>observed=resolve);
 await page.route('**/supplier-statements/source',async route=>{observed();await delayed;await route.continue();},{times:1});
 await root.getByRole('button',{name:'Inspect original source',exact:true}).click();await seen;await shot(page,'supplier-statement-source-loading.png');release();await page.unroute('**/supplier-statements/source');
 await page.waitForFunction(()=>document.querySelector('[data-ss-status]')?.textContent.includes('Original source rows'));
 await shot(page,'supplier-statement-source.png');
 // Exercise an actual failed read followed by its normal retry.
 let interrupted=false;
 await page.route('**/supplier-statements/source',async route=>{if(!interrupted){interrupted=true;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:{message:'The selected statement read was interrupted.',code:'RECEIVING_SOURCE_READ'}})});}else await route.continue();});
 await root.getByRole('button',{name:'Inspect original source',exact:true}).click();
 await root.locator('.ss-message.error').waitFor({state:'visible'});await shot(page,'supplier-statement-read-error.png');
 await page.unroute('**/supplier-statements/source');await root.getByRole('button',{name:'Inspect original source',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('[data-ss-status]')?.textContent.includes('Original source rows'));
 await page.setViewportSize({width:390,height:844});await shot(page,'supplier-statement-narrow.png');
 await root.locator('[data-ss-action="open"][data-value="'+selection.reviewId+'"]').click();
 await root.locator('[data-ss-saved]').waitFor({state:'visible'});
 const outgoing=resolve(out,'..','outgoing'),types={'.html':'text/html; charset=utf-8','.json':'application/json; charset=utf-8','.csv':'text/plain; charset=utf-8'};
 server=http.createServer(async(request,response)=>{try{const name=decodeURIComponent(new URL(request.url,'http://localhost').pathname.slice(1));if(!['supplier-statement.html','supplier-statement.json','statement-rows.csv','ledger-rows.csv','review-items.csv','selection.json','original-source','README.txt'].includes(name)){response.writeHead(404);response.end();return;}const raw=await readFile(join(outgoing,name));response.writeHead(200,{'Content-Type':types['.'+name.split('.').pop()]??'text/plain; charset=utf-8','Cache-Control':'no-store'});response.end(raw);}catch{response.writeHead(500);response.end();}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve)});const base='http://127.0.0.1:'+server.address().port,attachment=await context.newPage();
 await attachment.setViewportSize({width:1280,height:960});await attachment.goto(base+'/supplier-statement.html',{waitUntil:'load'});await shot(attachment,'handover-report-desktop.png');
 await attachment.setViewportSize({width:390,height:844});await shot(attachment,'handover-report-narrow.png');
 for(const name of ['supplier-statement.json','statement-rows.csv','ledger-rows.csv','review-items.csv','selection.json','original-source','README.txt']){
  const response=await attachment.goto(base+'/'+name,{waitUntil:'load'});if(!response?.ok())throw Error('The original outgoing attachment did not open: '+name);
  const raw=await response.body(),expected=await readFile(join(outgoing,name));if(!raw.equals(expected))throw Error('The opened original attachment differs: '+name);
  if(name==='original-source'&&digest(raw)!==selection.expectedSourceSha256)throw Error('The original supplier bytes changed.');
  events.push({attachment:name,bytes:raw.length,sha256:digest(raw),opened:true});
 }
 if(faults.length)throw Error('Actual product script failed: '+faults.join('; '));
 const result={schema:'stellar-forge.sf47-supplier-statements-browser-result.v1',caseId:selection.caseId,reviewId:selection.reviewId,reviewSha256:selection.reviewSha256,events,files,
   inspection:'Producing peer must open the actual retained desktop/narrow PNGs, inspect all outgoing attachments and repair any visible defect before presenting the product.'};
 await keep('RESULT.json',Buffer.from(JSON.stringify(result,null,2)+'\n'));process.stdout.write(JSON.stringify(result)+'\n');
}finally{await close();}
