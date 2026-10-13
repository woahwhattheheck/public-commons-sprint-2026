#!/usr/bin/env node
/** Operate the actual supplied offline recipient product. Does not call native mutations. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const argv=process.argv.slice(2),args={};
for(let i=0;i<argv.length;i+=2){if(!argv[i].startsWith('--')||!argv[i+1])throw Error('Use complete named arguments.');args[argv[i].slice(2)]=argv[i+1];}
for(const name of ['directory','delivery','plan','chromium','playwright-module'])if(!args[name])throw Error('Missing --'+name);
const root=path.resolve(args.directory),delivery=path.resolve(args.delivery);
await fs.mkdir(root,{recursive:true,mode:0o700});
const digest=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const json=v=>Buffer.from(canonical(v)+'\n');
const equal=(a,b)=>canonical(a)===canonical(b);
const need=(v,m)=>{if(!v)throw Error(m);};
async function publish(name,body){const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});const pending=file+'.pending-'+process.pid;
 try{const h=await fs.open(pending,'wx',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}try{await fs.link(pending,file);}catch(e){if(e.code!=='EEXIST')throw e;need((await fs.readFile(file)).equals(body),'Retained browser output differs: '+name);}const d=await fs.open(path.dirname(file),'r');try{await d.sync();}finally{await d.close();}}finally{await fs.unlink(pending).catch(e=>{if(e.code!=='ENOENT')throw e;});}}
async function read(name){try{return JSON.parse(await fs.readFile(path.join(root,name),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
const planRaw=await fs.readFile(args.plan),plan=JSON.parse(planRaw),inputRaw=await fs.readFile(path.join(delivery,'RECIPIENT_INPUT.json')),input=JSON.parse(inputRaw);
need(plan.schema==='commons.audit-recipient-receiving-plan.v1'&&Array.isArray(plan.reviews)&&plan.reviews.length>0&&plan.reviews.length<=1000,'Supply complete intentional recipient review fields.');
const identity={schema:'commons.audit-recipient-browser-input.v1',source:input.source,inputSha256:digest(inputRaw),planSha256:digest(planRaw),delivery};
await publish('INPUT.json',json(identity));
const completed=await read('BROWSER_RESULT.json');
if(completed){need(equal(completed.input,identity),'This saved browser result belongs to another input.');for(const f of completed.files){const b=await fs.readFile(path.join(root,f.path));need(b.length===f.bytes&&digest(b)===f.sha256,'A complete saved browser output changed.');}process.stdout.write(JSON.stringify({stage:'recipient-browser-reused',result:completed})+'\n');process.exit(0);}
const req=createRequire(import.meta.url);const module=req(args['playwright-module']),chromium=module.chromium||module.default?.chromium;need(chromium,'The selected original Playwright module has no Chromium.');
let context=null,opening=null,closing=null,interrupted=false;
function closeContext(){return closing||(closing=Promise.resolve(opening).then(value=>value?.close()));}
function stop(){if(interrupted)return;interrupted=true;process.exitCode=130;closeContext().catch(()=>{});}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
opening=chromium.launchPersistentContext(path.join(root,'profile'),{headless:true,executablePath:args.chromium,viewport:{width:1365,height:960},acceptDownloads:true,args:['--no-sandbox','--disable-dev-shm-usage']});
context=await opening;
if(interrupted){await closeContext();throw Error('The original browser was interrupted during launch.');}
const attempts=path.join(root,'attempts');await fs.mkdir(attempts,{recursive:true});let number=1;while(true){try{await fs.mkdir(path.join(attempts,String(number).padStart(4,'0')));break;}catch(e){if(e.code!=='EEXIST')throw e;number++;}}
const attempt='attempts/'+String(number).padStart(4,'0');
const errors=[],files=[],page=context.pages()[0]||await context.newPage();
page.on('pageerror',e=>errors.push(String(e)));
const fileUrl=pathToFileURL(path.join(delivery,'Audit_Recipient_Review.html')).href;
async function ready(){await page.waitForFunction(()=>document.getElementById('message')?.textContent.startsWith('Complete original audit opened.')&&!document.getElementById('new-review').disabled);}
async function click(id){await page.locator('#'+id).click();await page.waitForFunction(()=>!document.getElementById('new-review').disabled);const text=await page.locator('#message').innerText();need(!await page.locator('#message').evaluate(n=>n.classList.contains('error')),'Product rejected the action: '+text);}
async function section(id){await page.locator('[data-tab="'+id+'"]').click();await page.waitForFunction(()=>!document.getElementById('new-review').disabled);}
async function downloaded(button,name){const pending=page.waitForEvent('download');await click(button);const download=await pending;const temp=path.join(root,'.download-'+process.pid+'-'+Date.now());try{await download.saveAs(temp);need(!await download.failure(),'The browser download failed.');const b=await fs.readFile(temp);if(name)await publish(name,b);return b;}finally{await fs.unlink(temp).catch(()=>{});}}
async function working(name){await section('return');const raw=await downloaded('download-working',name);return JSON.parse(raw);}
async function shot(name){const b=await page.screenshot({fullPage:true});await publish(attempt+'/screens/'+name+'.png',b);}
async function restore(name){await section('return');await page.locator('#working-file').setInputFiles(path.join(root,name));await page.waitForFunction(()=>!document.getElementById('new-review').disabled);need(!await page.locator('#message').evaluate(n=>n.classList.contains('error')),'The retained working copy did not reopen.');}
try{
 await page.goto(fileUrl);await ready();await shot('01-open-desktop');
 const retained=await read('MANUSCRIPT.json');
 let work=await working(retained?null:attempt+'/working-initial.json');
 const saved=await read('WORKING_COMPLETE.json');
 if(retained)need((saved||work).manuscript.manuscriptId===retained.manuscriptId,'The browser profile contains another original manuscript.');
 else{need(work.working.length===0&&work.manuscript.editions.length===0,'A fresh receiving operation must retain an existing recipient manuscript separately.');await publish('MANUSCRIPT.json',json({manuscriptId:work.manuscript.manuscriptId}));}
 // A durable completed working copy takes precedence after profile loss or interruption.
 if(saved){await restore('WORKING_COMPLETE.json');work=await working();}
 else{
   await section('reviews');
   for(let i=0;i<plan.reviews.length;i++){
     const wanted=plan.reviews[i];need(wanted&&typeof wanted==='object','Keep each complete proposal.');
     let current=(await working()).working;
     need(current.length<=plan.reviews.length,'Preserve unexpected recipient rows before continuing.');
     await section('reviews');
     if(current.length<=i){
       if(wanted.id){await page.locator('#original-review').selectOption(wanted.id);await click('copy-review');}
       else await click('new-review');
       current=(await working()).working;
       await section('reviews');
     }
     const row=current[i];need(row&&row.id===(wanted.id||''),'The retained working proposal has another original native identity.');
     await page.locator('#review-list button').nth(i).click();
     await page.waitForFunction(()=>!document.getElementById('new-review').disabled);
     if(!wanted.id)await page.locator('#source-id').selectOption(wanted.sourceId);
     await page.waitForFunction(()=>!document.getElementById('new-review').disabled);
     await page.locator('#revision-id').selectOption(wanted.revisionId);
     await page.waitForFunction(()=>!document.getElementById('new-review').disabled);
     for(const [id,key]of [['entity-key','entityKey'],['title','title'],['actor','actor'],['assignee','assignee'],['due-date','dueDate'],['note','note']])await page.locator('#'+id).fill(wanted[key]||'');
     await page.locator('#status').selectOption(wanted.status);
     while(await page.locator('#evidence .evidence-row').count())await page.locator('#evidence .evidence-row button').first().click();
     for(const item of wanted.evidence){await click('add-evidence');const row=page.locator('#evidence .evidence-row').last();await row.locator('input').nth(0).fill(item.label);await row.locator('input').nth(1).fill(item.url);}
     await working(attempt+'/working-proposal-'+String(i+1).padStart(4,'0')+'.json');
   }
   work=await working();need(work.working.length===plan.reviews.length,'The complete working proposal count differs.');
   for(let i=0;i<plan.reviews.length;i++){const wanted=plan.reviews[i],actual=work.working[i];for(const key of ['id','sourceId','revisionId','entityKey','title','status','actor','assignee','dueDate','note','evidence'])need(equal(actual[key],wanted[key]??''),'The visible proposal differs at '+key);}
   // Reload the actual recipient page and reopen its saved complete working copy.
   await page.reload();await ready();const reopened=await working(attempt+'/working-reopened.json');
   need(equal(reopened,work),'The actual recipient reload changed unfinished or complete fields.');
   await section('reviews');
   const latest=work.manuscript.editions.at(-1);
   if(!latest||!equal(latest.reviews,work.working))await click('save-edition');
   work=await working('WORKING_COMPLETE.json');
 }
 await section('source');await shot('02-source-desktop');
 const xml=page.locator('details').filter({has:page.locator('#original-xml')});
 await xml.locator('summary').click();await page.waitForFunction(()=>document.getElementById('original-xml').textContent.length>0);need((await page.locator('#original-xml').textContent()).length>0,'The complete original XML did not open.');await shot('03-original-xml');
 await xml.locator('summary').click();await page.waitForFunction(()=>!document.getElementById('original-xml').textContent);
 await page.locator('#field-find').fill('recipient-no-match-'+work.manuscript.manuscriptId);await shot('04-empty-source-search');await page.locator('#field-find').fill('');
 await section('history');await page.locator('#edition-history details summary').last().click();await shot('05-authored-history');await page.locator('#edition-history details summary').last().click();
 await section('return');
 await downloaded('download-manuscript','AUDIT_RECIPIENT_MANUSCRIPT.json');
 // Deliberately present the wrong complete file; the product must reject it without a return.
 await page.locator('#original-file').setInputFiles(path.join(root,'AUDIT_RECIPIENT_MANUSCRIPT.json'));
 await page.locator('#download-return').click();await page.waitForFunction(()=>!document.getElementById('new-review').disabled);
 need(await page.locator('#message').evaluate(n=>n.classList.contains('error')),'A different selected original file was not rejected.');
 await shot('06-wrong-original-error');
 await page.locator('#original-file').setInputFiles(path.join(delivery,'original-review.zip'));
 // Headless receiving uses the same fallback-download path available to ordinary browsers.
 await page.evaluate(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});});
 await downloaded('download-return','Audit_Recipient_Return.zip');await shot('07-complete-return');
 await page.setViewportSize({width:390,height:844});await section('reviews');await shot('08-reviews-phone');
 need(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'The recipient screen overflows the narrow viewport.');
 await section('source');await shot('09-source-phone');await section('return');await shot('10-return-phone');
 // Actual downloaded working copy reopens through the product's public import control.
 await restore('WORKING_COMPLETE.json');need(equal(await working(),work),'The downloaded whole working copy changed when imported.');
 await page.setViewportSize({width:1365,height:960});await section('reviews');await shot('11-reopened-desktop');
 need(errors.length===0,'The actual browser reported errors: '+errors.join('; '));
 for(const directory of [attempt+'/screens'])for(const name of (await fs.readdir(path.join(root,directory))).sort()){const b=await fs.readFile(path.join(root,directory,name));files.push({path:directory+'/'+name,bytes:b.length,sha256:digest(b)});}
 for(const name of ['WORKING_COMPLETE.json','AUDIT_RECIPIENT_MANUSCRIPT.json','Audit_Recipient_Return.zip']){const b=await fs.readFile(path.join(root,name));files.push({path:name,bytes:b.length,sha256:digest(b)});}
 const result={schema:'commons.audit-recipient-browser-result.v1',input:identity,manuscriptId:work.manuscript.manuscriptId,editionSha256:work.manuscript.editions.at(-1).sha256,reviews:work.working.length,files,errors,visualReview:'Screenshots captured; producing operator must open and inspect them before recipient-ready.'};
 await publish('BROWSER_RESULT.json',json(result));process.stdout.write(JSON.stringify({stage:'recipient-browser-complete',result})+'\n');
}finally{await closeContext();process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
