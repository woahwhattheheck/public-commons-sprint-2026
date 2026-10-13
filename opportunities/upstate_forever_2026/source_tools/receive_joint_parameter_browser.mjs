#!/usr/bin/env node
/** Open the original completed joint study and its independent received copy. */
import {readFile,mkdir,open,rename,unlink} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join,dirname,basename,isAbsolute} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

const need=(value,message)=>{if(!value)throw Error(message);};
function ordered(v){return Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;}
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const json=async path=>JSON.parse(await readFile(path,'utf8'));
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function identity(path){
 const hash=createHash('sha256');let bytes=0;
 for await(const block of createReadStream(path)){bytes+=block.length;hash.update(block);}
 return {path,bytes,sha256:hash.digest('hex')};
}
async function atomic(path,value){
 const temporary=join(dirname(path),'.'+basename(path)+'.incoming-'+randomUUID());let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();await handle.close();handle=undefined;
  await rename(temporary,path);const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }finally{await handle?.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
const cfg=await json(resolve(process.argv[2]||'joint-browser.json'));
for(const key of ['producer','receiver','studyId','nativeResultFile','outputDirectory','playwrightModule','chromium'])
 need(cfg[key],'Retain the original configuration field '+key);
need(/^[0-9a-f]{64}$/.test(cfg.studyId),'Select the original retained study.');
for(const target of [cfg.producer,cfg.receiver]){
 need(typeof target.workspace==='string'&&target.workspace,'Select both original workspace keys.');
 const url=new URL(target.url);
 need(['http:','https:'].includes(url.protocol)&&['127.0.0.1','localhost','[::1]'].includes(url.hostname),'Use the original loopback operator URL.');
}
need(new URL(cfg.producer.url).origin!==new URL(cfg.receiver.url).origin||cfg.producer.workspace!==cfg.receiver.workspace,
 'Select a distinct independently received workspace.');
const nativePath=resolve(cfg.nativeResultFile),native=await json(nativePath),nativeRoot=dirname(nativePath);
need(native.schema==='upstate.joint-parameter-receiving/v1'&&native.state==='NATIVE_AND_RECEIVING_COMPLETE'&&native.study_id===cfg.studyId,
 'Complete original native execution and independent receiving before this browser course.');
const preview=await json(join(nativeRoot,'design-preview.json')),analysis=await json(join(nativeRoot,'original-analysis.json'));
need(preview.id===cfg.studyId,'The retained native preview identifies another study.');
const output=resolve(cfg.outputDirectory),attemptId=randomUUID(),attempt=join(output,'attempts',attemptId);
await mkdir(attempt,{recursive:true,mode:0o700});
const state={schema:'upstate.joint-parameter-browser-receiving/v1',state:'RUNNING',attemptId,
 startedAt:new Date().toISOString(),studyId:cfg.studyId,experimentId:native.experiment_id,
 nativeResult:await identity(nativePath),driver:await identity(fileURLToPath(import.meta.url)),
 browserClosed:false,scientificWrites:[],visualInspection:'AWAITING_ACTUAL_VIEWER',
 workspaces:{producer:cfg.producer.workspace,receiver:cfg.receiver.workspace},
 origins:{producer:new URL(cfg.producer.url).origin,receiver:new URL(cfg.receiver.url).origin},
 phases:[],screenshots:[],downloads:[],attachmentViews:[],errors:[]};
async function checkpoint(phase){
 state.phase=phase;state.updatedAt=new Date().toISOString();state.phases.push({phase,at:state.updatedAt});
 await atomic(join(attempt,'browser-result.json'),state);
 await atomic(join(output,'browser-current.json'),{attemptId,result:join(attempt,'browser-result.json'),state:state.state,phase});
}
const secrets=[cfg.producer.url,cfg.receiver.url,...[cfg.producer.url,cfg.receiver.url].map(s=>new URLSearchParams(new URL(s).hash.slice(1)).get('token')).filter(Boolean)];
function redact(error){let value=String(error?.stack||error);for(const secret of secrets)value=value.split(secret).join('[private original connection]');return value;}
async function shot(page,label){
 const path=join(attempt,label+'.png');await page.screenshot({path,fullPage:false});
 state.screenshots.push({label,...await identity(path),viewport:page.viewportSize()});
}
async function width(page,label){
 const box=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
 need(box.document<=box.viewport+1&&box.body<=box.viewport+1,label+' has horizontal page overflow: '+JSON.stringify(box));
 return box;
}
async function api(page,path,workspace,params={}){
 return page.evaluate(async({path,workspace,params})=>{
  const token=sessionStorage.getItem('upstate-operator-capability');
  const response=await fetch(path+'?'+new URLSearchParams({workspace,...params}),{headers:{Authorization:'Bearer '+token,'X-Workspace':workspace}});
  const value=await response.json();if(!response.ok)throw Error(value.error?.message||'HTTP '+response.status);return value;
 },{path,workspace,params});
}
async function choose(page,target){
 await page.goto(target.url,{waitUntil:'domcontentloaded'});
 await page.locator('#workspace-select').waitFor({state:'visible'});
 if(await page.locator('#workspace-select').inputValue()!==target.workspace)await page.locator('#workspace-select').selectOption(target.workspace);
 await page.waitForFunction(key=>{
  const control=document.querySelector('#workspace-select'),content=document.querySelector('#content');
  return control?.value===key&&sessionStorage.getItem('upstate-selected-workspace')===key&&
   content&&!content.textContent.includes('Opening selected workspace…');
 },target.workspace);
 await page.locator('[data-view="joint-parameter-studies"]').click();
 await page.locator('[data-joint-editor]').waitFor({state:'visible'});
 await page.locator('[data-joint-command="open"][data-id="'+cfg.studyId+'"]').click();
 await page.locator('[data-joint-active] code').filter({hasText:cfg.studyId}).waitFor();
 const value=await api(page,'/api/joint-parameters/inspect',target.workspace,{study_id:cfg.studyId});
 need(value.id===cfg.studyId&&value.experiment_id===native.experiment_id&&value.state==='complete','Open the same completed native study.');
 need(same(value.definition,preview.definition),'The original operator changed the full frozen definition.');
 return value;
}
async function download(page,trigger,path,expected,owner){
 const event=page.waitForEvent('download');await trigger();const value=await event;
 await value.saveAs(path);const descriptor=await identity(path);
 if(expected)need(descriptor.bytes===expected.bytes&&descriptor.sha256===expected.sha256,'The complete download differs from its actual original descriptor.');
 state.downloads.push({owner,suggestedFilename:value.suggestedFilename(),...descriptor});
 return descriptor;
}
async function exactLink(page,url){
 for(const link of await page.locator('[data-joint-active] a[download]').all())
  if(await link.getAttribute('href')===url+'?download=1')return link;
 throw Error('The original download control is missing.');
}
async function viewAttachment(page,file,label){
 const ext=basename(file.path).toLowerCase().split('.').pop();
 if(ext==='html'){
  await page.goto(pathToFileURL(file.path).href,{waitUntil:'domcontentloaded'});
  await width(page,label);await shot(page,label+'-desktop');
  const section=page.locator('#joint-parameter-analysis');
  if(await section.count()){
   await section.scrollIntoViewIfNeeded();await shot(page,label+'-analysis');
   const groups=section.locator('details');
   for(let i=0;i<await groups.count();i++){
    const item=groups.nth(i);await item.evaluate(node=>node.open=true);await item.scrollIntoViewIfNeeded();
    await shot(page,label+'-group-'+String(i+1).padStart(3,'0'));await item.evaluate(node=>node.open=false);
   }
  }
  await page.setViewportSize({width:390,height:844});await width(page,label+' narrow');await shot(page,label+'-narrow');
  await page.setViewportSize({width:1440,height:1000});
  state.attachmentViews.push({path:file.path,kind:'original-html',desktop:true,narrow:true});
 }else if(['json','csv','txt','md'].includes(ext)){
  const body=await readFile(file.path,'utf8');if(ext==='json')JSON.parse(body);
  const path=join(attempt,label+'-reader.html');
  const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(basename(file.path))+'</title><style>body{margin:24px;font:16px system-ui;overflow-wrap:anywhere}pre{white-space:pre-wrap;font:12px ui-monospace}</style><h1>'+esc(basename(file.path))+'</h1><p>'+file.bytes+' original bytes · '+file.sha256+'</p><pre>'+esc(body)+'</pre>';
  const f=await open(path,'wx',0o600);try{await f.writeFile(html);await f.sync();}finally{await f.close();}
  await page.goto(pathToFileURL(path).href,{waitUntil:'domcontentloaded'});await shot(page,label+'-text');
  state.attachmentViews.push({path:file.path,kind:'full-text-reader',viewer:await identity(path)});
 }else if(['png','jpg','jpeg','svg'].includes(ext)){
  await page.goto(pathToFileURL(file.path).href,{waitUntil:'load'});await shot(page,label+'-image');
  state.attachmentViews.push({path:file.path,kind:'original-image'});
 }else state.attachmentViews.push({path:file.path,kind:'requires-specialist-viewer',extension:ext});
}
let browser;
try{
 await checkpoint('native-result-verified');
 const runtime=await import(isAbsolute(cfg.playwrightModule)?pathToFileURL(cfg.playwrightModule).href:cfg.playwrightModule);
 need(runtime.chromium?.launch,'Use the existing complete Playwright module.');
 state.runtime={chromium:await identity(resolve(cfg.chromium)),playwrightModule:cfg.playwrightModule};
 browser=await runtime.chromium.launch({executablePath:resolve(cfg.chromium),headless:true,args:cfg.chromiumArgs??[],
  env:{...process.env,...(cfg.environment??{})}});
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
 const page=await context.newPage(),receivedPage=await context.newPage(),attachmentPage=await context.newPage();
 for(const item of [page,receivedPage,attachmentPage])item.on('pageerror',error=>state.errors.push(redact(error)));
 const produced=await choose(page,cfg.producer);
 await width(page,'Joint operator desktop');await shot(page,'producer-desktop');await checkpoint('producer-open');

 // Use the real draft, reload, import, preview and downloads. Native writes were
 // completed by the original companion; no new model task is submitted here.
 await page.locator('[data-joint-command="revise"]').click();
 const question=page.locator('[data-joint-editor] textarea[name="reason"]');
 need(await question.inputValue()===produced.definition.specification.reason,'The original revise control lost its scientific question.');
 const draftReason=produced.definition.specification.reason+'\nBrowser draft receiving '+attemptId;
 await question.fill(draftReason);
 await page.waitForFunction(expected=>new Promise((resolve,reject)=>{
  const request=indexedDB.open('upstate-joint-parameter-studies-v1');
  request.onerror=()=>reject(request.error);request.onsuccess=()=>{
   const db=request.result,tx=db.transaction('workspaces','readonly'),read=tx.objectStore('workspaces').get(expected.workspace);
   read.onsuccess=()=>{const matches=read.result?.draft?.reason===expected.reason;db.close();resolve(matches);};read.onerror=()=>reject(read.error);
  };
 }),{workspace:cfg.producer.workspace,reason:draftReason});
 await page.reload({waitUntil:'domcontentloaded'});
 await page.locator('[data-joint-editor] textarea[name="reason"]').waitFor();
 need(await page.locator('[data-joint-editor] textarea[name="reason"]').inputValue()===draftReason,'The saved draft did not survive the actual reload.');
 await page.locator('[data-joint-editor] textarea[name="reason"]').fill(produced.definition.specification.reason);
 const specification=join(attempt,'Joint_Parameter_Specification.json');
 await download(page,()=>page.locator('[data-joint-command="export-draft"]').click(),specification,null,'producer');
 need(same(await json(specification),produced.definition.specification),'The downloaded specification changed original fields.');
 await page.locator('[data-joint-import]').setInputFiles(specification);
 await page.waitForFunction(()=>document.querySelector('[data-joint-command="download-preview"]')&&!document.querySelector('[data-joint-import]').disabled);
 const fullPreview=join(attempt,'Joint_Parameter_Design.json');
 await download(page,()=>page.locator('[data-joint-command="download-preview"]').click(),fullPreview,null,'producer');
 const currentPreview=(await json(fullPreview)).definition;
 need(['schema','method','specification','baseline','experiment_selection','interpretation'].every(key=>same(currentPreview[key],produced.definition[key])),
  'The current candidate changed the original scientific selection.');
 if(same(currentPreview.sampler,produced.definition.sampler)){
  need(same(currentPreview,produced.definition),'The same sampler edition changed the frozen original coordinates.');
  state.previewComparison={state:'EXACT_ORIGINAL_DESIGN',sampler:currentPreview.sampler};
 }else{
  state.previewComparison={state:'NEW_UNSAVED_SAMPLER_EDITION',
   originalSampler:produced.definition.sampler,currentSampler:currentPreview.sampler,
   originalStudy:cfg.studyId,currentCandidate:(await json(fullPreview)).id,
   note:'The original saved design remains authoritative. The current candidate was retained without preparation or native execution.'};
 }
 await shot(page,'producer-frozen-preview');await checkpoint('form-preview-and-draft-recovery');

 const originals=produced._downloads;
 need(Array.isArray(originals)&&originals.some(f=>f.filename==='study-joint-parameter-analysis.json')&&originals.some(f=>f.label==='Study report'),
  'Retain the complete original scientific report and joint-analysis attachments.');
 for(let i=0;i<originals.length;i++){
  const file=originals[i];need(file.filename===basename(file.filename),'Use the complete original filename.');
  const prefix='producer-'+String(i+1).padStart(3,'0'),path=join(attempt,prefix+'-'+file.filename),link=await exactLink(page,file.url);
  const saved=await download(page,()=>link.click(),path,file,'producer');
  if(file.filename==='study-joint-parameter-analysis.json')need(same(await json(path),analysis),'The report download differs from the source-bound native analysis.');
  await viewAttachment(attachmentPage,saved,prefix);await checkpoint('download-'+String(i+1));
 }
 await page.setViewportSize({width:390,height:844});await page.locator('[data-joint-active]').scrollIntoViewIfNeeded();
 await width(page,'Joint operator narrow');await shot(page,'producer-narrow');
 await page.locator('[data-joint-command="open"][data-id="'+cfg.studyId+'"]').click();await shot(page,'producer-narrow-reopen');

 const independent=await choose(receivedPage,cfg.receiver);
 need(same(independent.definition,produced.definition)&&same(independent.samples,produced.samples)&&independent.experiment_id===produced.experiment_id,
  'The received operator changed the original design or sample/profile mapping.');
 for(let i=0;i<originals.length;i++){
  const file=originals[i],matches=independent._downloads.filter(f=>f.filename===file.filename&&f.bytes===file.bytes&&f.sha256===file.sha256);
  need(matches.length>0,'The independent operator lacks the full original download '+file.filename);
  const link=await exactLink(receivedPage,matches[0].url);
  await download(receivedPage,()=>link.click(),join(attempt,'receiver-'+String(i+1).padStart(3,'0')+'-'+file.filename),file,'receiver');
 }
 await width(receivedPage,'Independent operator desktop');await shot(receivedPage,'receiver-desktop');
 await receivedPage.setViewportSize({width:390,height:844});await width(receivedPage,'Independent operator narrow');await shot(receivedPage,'receiver-narrow');
 await checkpoint('independent-ui-received');
 need(state.errors.length===0,'The actual application reported browser errors.');
 state.state='COMPLETE';state.completedAt=new Date().toISOString();
}catch(error){state.state='INCOMPLETE';state.error=redact(error);}
finally{
 try{await browser?.close();state.browserClosed=true;}catch(error){state.browserClosed=false;state.state='INCOMPLETE';state.closeError=redact(error);}
 await checkpoint('browser-closed');
 const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Joint study actual receiving</title><style>body{font:16px system-ui;margin:24px;max-width:1500px;overflow-wrap:anywhere}img{max-width:100%;height:auto;border:1px solid #ccd}figure{margin:24px 0}</style><h1>Joint study actual receiving</h1><p>'+esc(state.state)+' · actual viewer inspection remains pending.</p>'+
  state.screenshots.map(f=>'<figure><figcaption>'+esc(f.label)+'</figcaption><a href="'+esc(basename(f.path))+'"><img loading="lazy" src="'+esc(basename(f.path))+'" alt="'+esc(f.label)+'"></a></figure>').join('')+
  '<h2>Complete original attachments</h2><ul>'+state.downloads.map(f=>'<li><a href="'+esc(basename(f.path))+'">'+esc(f.owner+' '+f.suggestedFilename)+'</a> · '+f.bytes+' bytes · '+f.sha256+'</li>').join('')+'</ul>';
 const f=await open(join(attempt,'index.html'),'wx',0o600);try{await f.writeFile(html);await f.sync();}finally{await f.close();}
}
console.log(JSON.stringify({state:state.state,browserClosed:state.browserClosed,result:join(attempt,'browser-result.json'),gallery:join(attempt,'index.html')}));
if(state.state!=='COMPLETE'||!state.browserClosed)process.exitCode=1;
