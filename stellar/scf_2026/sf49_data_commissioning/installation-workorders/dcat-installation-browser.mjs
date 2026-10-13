// SPDX-License-Identifier: MIT
/**
 * Actual browser continuation of the original DCAT Installation customer course.
 * Consumes an existing preparation/listener; never writes the Operations case.
 */
import {open,mkdir,lstat,realpath,link,unlink,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join,basename,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const MAX_FILE=128*1024*1024;
const digest=raw=>createHash('sha256').update(raw).digest('hex');
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const ordered=value=>Array.isArray(value)?value.map(ordered):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):value;
const same=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const decode=raw=>new TextDecoder('utf-8',{fatal:true}).decode(raw);
const html=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function directory(path){
 need(typeof path==='string'&&resolve(path)===path,'BROWSER_OUTPUT_ABSOLUTE_REQUIRED');
 await mkdir(path,{recursive:true,mode:0o700});
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&!(info.mode&0o077)&&await realpath(path)===path&&(process.getuid===undefined||info.uid===process.getuid()),'BROWSER_OUTPUT_PRIVATE_REQUIRED');
 return path;
}
async function identity(path,maximum=MAX_FILE){
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await handle.stat();
  need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size<=maximum,'BROWSER_ARTIFACT_PRIVATE_FILE_REQUIRED');
  const hash=createHash('sha256');let bytes=0;
  for await(const raw of handle.createReadStream({autoClose:false})){bytes+=raw.length;need(bytes<=maximum,'BROWSER_ARTIFACT_LIMIT');hash.update(raw);}
  const after=await handle.stat();
  need(bytes===before.size&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'BROWSER_ARTIFACT_CHANGED');
  return{bytes,sha256:hash.digest('hex')};
 }finally{await handle.close();}
}
async function write(path,raw){
 const handle=await open(path,'wx',0o600);
 try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
 return{path,...await identity(path,Math.max(MAX_FILE,raw.length))};
}
async function privateRead(path,maximum=MAX_FILE){
 const expected=await identity(path,maximum),raw=await readFile(path);
 need(raw.length===expected.bytes&&digest(raw)===expected.sha256,'BROWSER_ARTIFACT_READ_CHANGED');return raw;
}

async function optionalJSON(path){
 try{return JSON.parse(decode(await privateRead(path)));}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function checkpoint(path,value){
 const raw=encode(value),temporary=path+'.pending-'+randomUUID();let handle;
 try{
  handle=await open(temporary,'wx',0o600);await handle.writeFile(raw);await handle.sync();await handle.close();handle=null;
  try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;need((await privateRead(path)).equals(raw),'BROWSER_ORIGINAL_REQUEST_CHECKPOINT_CONFLICT');}
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }finally{
  if(handle)await handle.close();
  try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return{path,...await identity(path)};
}
const contentInventory=files=>files.map(file=>[file.kind,file.bytes,file.sha256].join(':')).sort();

/**
 * playwright: original installed Playwright module (or its default export).
 * listener: original live server's {url,origin}; url contains its private token.
 * expectedPreparation: unchanged complete service.get(preparationRequestId).
 * browserContext: optional borrowed context; only newly created pages are closed.
 * prepareAgain: explicit true exercises the UI preparation after restoring the
 * exact attached scope; this writes a new preparation only, never a case.
 */
export async function runDcatInstallationBrowser({
 playwright,chromiumPath,listener,outputDirectory,preparationRequestId,
 expectedPreparation,signal,browserContext=null,prepareAgain=true,onProgress
}={}){
 need(UUID.test(preparationRequestId??''),'BROWSER_PREPARATION_UUID_REQUIRED');
 need(expectedPreparation?.requestId===preparationRequestId&&expectedPreparation.type==='prepare'&&expectedPreparation.status==='COMPLETE'&&Array.isArray(expectedPreparation.files),'BROWSER_COMPLETE_PREPARATION_REQUIRED');
 const selectedUrl=new URL(listener?.url),origin=new URL(listener?.origin);
 need(selectedUrl.origin===origin.origin&&origin.href===origin.origin+'/'&&origin.protocol==='http:'&&['127.0.0.1','[::1]'].includes(origin.hostname)&&selectedUrl.pathname==='/','BROWSER_ORIGINAL_LOOPBACK_REQUIRED');
 const secret=new URLSearchParams(selectedUrl.hash.slice(1)).get('token');
 need(typeof secret==='string'&&secret.length>=32,'BROWSER_PRIVATE_LISTENER_REQUIRED');
 const scrub=value=>String(value??'').split(secret).join('[redacted]').replace(/#token=[^\s"'<>]+/g,'#token=[redacted]').replace(/Bearer\s+[A-Za-z0-9_-]+/g,'Bearer [redacted]');
 const output=await directory(outputDirectory),attemptId=randomUUID();
 const attempt=await directory(join(output,'attempt-'+attemptId));
 const checkpointPath=join(output,'browser-preparation-request.json');
 let preparationIntent=await optionalJSON(checkpointPath);
 const baselineSha256=digest(encode(expectedPreparation));
 if(preparationIntent)need(preparationIntent.schema==='stellar-forge.dcat-installation-browser-request.v1'&&preparationIntent.baselinePreparationRequestId===preparationRequestId&&preparationIntent.baselinePreparationSha256===baselineSha256&&UUID.test(preparationIntent.request?.requestId??''),'BROWSER_ORIGINAL_PREPARATION_CHECKPOINT_MISMATCH');
 const downloadsDirectory=await directory(join(attempt,'downloads'));
 const screenshotDirectory=await directory(join(attempt,'screenshots'));
 const viewingDirectory=await directory(join(attempt,'viewers'));
 const report={
  schema:'stellar-forge.dcat-installation-browser-customer.v1',
  attemptId,startedAt:new Date().toISOString(),preparationRequestId,
  expectedPreparationSha256:digest(encode(expectedPreparation)),origin:origin.origin,
  complete:false,viewedByOperator:false,
  downloads:[],screenshots:[],views:[],observations:[],errors:[],pageErrors:[],
  requests:[],shutdown:{borrowedContext:!!browserContext,pages:[],contextClosed:false,browserClosed:false}
 };
 let browser=null,context=browserContext,launchPromise=null,contextPromise=null;
 let closePromise=null,interrupted=false,sequence=0,screenSequence=0;
 const pages=new Set(),acquiringPages=new Set();
 const observe=async(name,details={})=>{
  report.observations.push({name,at:new Date().toISOString(),...details});
  if(onProgress)await onProgress({schema:report.schema,attemptId,name,downloads:report.downloads.length,screenshots:report.screenshots.length});
 };
 const check=()=>need(!interrupted&&!signal?.aborted,'BROWSER_CUSTOMER_INTERRUPTED');
 function watch(page,label){
  pages.add(page);
  page.on('request',request=>{
   try{
    const url=new URL(request.url());
    if(url.origin!==origin.origin||!['PUT','POST'].includes(request.method())||!['/api/import','/api/inspect','/api/template','/api/prepare'].includes(url.pathname))return;
    const body=request.method()==='PUT'?Object.fromEntries(url.searchParams):request.postDataJSON();
    if(UUID.test(body?.requestId??''))report.requests.push({method:request.method(),action:url.pathname.slice(5),requestId:body.requestId,request:body});
   }catch(error){report.errors.push({code:'BROWSER_REQUEST_RECEIPT_CAPTURE',message:scrub(error.message)});}
  });
  page.on('pageerror',error=>report.pageErrors.push({page:label,message:scrub(error.message)}));
  return page;
 }
 async function newPage(label){
  check();const pending=Promise.resolve().then(()=>context.newPage());acquiringPages.add(pending);
  try{const page=watch(await pending,label);check();return page;}finally{acquiringPages.delete(pending);}
 }
 function closeOwned(){
  return closePromise??=(async()=>{
   if(launchPromise)try{browser=await launchPromise;}catch{}
   if(contextPromise)try{context=await contextPromise;}catch{}
   await Promise.allSettled([...acquiringPages]);
   for(const page of pages){
    try{if(!page.isClosed())await page.close({runBeforeUnload:false});report.shutdown.pages.push({closed:page.isClosed()});}
    catch(error){report.shutdown.pages.push({closed:page.isClosed(),error:scrub(error.message)});}
   }
   if(!browserContext&&context)try{await context.close();report.shutdown.contextClosed=true;}catch(error){report.shutdown.contextError=scrub(error.message);}
   if(!browserContext&&browser)try{await browser.close();report.shutdown.browserClosed=true;}catch(error){report.shutdown.browserError=scrub(error.message);}
  })();
 }
 const abort=()=>{interrupted=true;void closeOwned();};
 signal?.addEventListener('abort',abort,{once:true});
 // Signals are observed without exiting the owner programme. That programme still
 // owns the listener and its normal drain. Remove these handlers on completion.
 const termination=()=>abort();
 process.on('SIGINT',termination);process.on('SIGTERM',termination);
 async function settle(page){
  check();
  await page.waitForFunction(()=>{const e=document.getElementById('controls');return e&&!e.hidden&&!e.inert;},null,{timeout:300000});
  check();
 }
 async function click(page,locator){
  check();await locator.click();await settle(page);check();
 }
 async function shot(page,name){
  check();await page.waitForTimeout(120);
  const raw=await page.screenshot({fullPage:false,animations:'disabled'});
  const path=join(screenshotDirectory,String(++screenSequence).padStart(3,'0')+'-'+name+'.png');
  const value=await write(path,raw);report.screenshots.push({name,...value,viewport:page.viewportSize(),viewedByOperator:false});return value;
 }
 async function capture(page,locator,{role,name,expected=null,source=null}){
  check();const pending=page.waitForEvent('download',{timeout:300000});
  const [download]=await Promise.all([pending,locator.click()]);
  const suggested=download.suggestedFilename();
  const fileName=String(++sequence).padStart(6,'0')+'-'+(expected?.sha256?.slice(0,16)??'draft')+'-'+String(name??suggested).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,160);
  const path=join(downloadsDirectory,fileName),temporary=path+'.receiving';
  let handle;
  try{
   // Browser output is consumed as a stream into our own private file; an
   // incomplete browser download never becomes a published complete artifact.
   const stream=await download.createReadStream();
   need(stream,'BROWSER_DOWNLOAD_STREAM_REQUIRED');
   handle=await open(temporary,'wx',0o600);let bytes=0;const hash=createHash('sha256');
   for await(const raw of stream){check();bytes+=raw.length;need(bytes<=Math.max(MAX_FILE,expected?.bytes??0),'BROWSER_DOWNLOAD_LIMIT');hash.update(raw);await handle.writeFile(raw);}
   need(await download.failure()===null,'BROWSER_DOWNLOAD_INCOMPLETE');
   const sha256=hash.digest('hex');
   if(expected)need(bytes===expected.bytes&&sha256===expected.sha256,'BROWSER_DOWNLOAD_IDENTITY_MISMATCH');
   await handle.sync();await handle.close();handle=null;
   await link(temporary,path);await unlink(temporary);
   const actual=await identity(path,Math.max(MAX_FILE,expected?.bytes??0));
   need(actual.bytes===bytes&&actual.sha256===sha256,'BROWSER_DOWNLOAD_RETAINED_IDENTITY');
   const row={role,name:name??suggested,suggestedFilename:suggested,path,...actual,...(source?{source}:{}),complete:true};
   report.downloads.push(row);await settle(page);return row;
  }finally{
   if(handle)await handle.close();
   try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}
   await download.delete().catch(()=>{});
  }
 }
 async function readJSON(row){return JSON.parse(decode(await privateRead(row.path,Math.max(MAX_FILE,row.bytes))));}
 async function getRecord(page,id){
  const response=await page.request.get(origin.origin+'/api/requests/'+id,{headers:{Authorization:'Bearer '+secret},timeout:300000});
  need(response.ok(),'BROWSER_RETAINED_REQUEST_UNAVAILABLE');
  return response.json();
 }
 async function recoverPreparation(page,actual){
  const body=preparationIntent.request;
  need(body.inspectionId===actual.inspectionId&&body.caseId===actual.request.caseId&&body.seedId===actual.request.seedId&&body.selectionSourceId===actual.request.selectionSourceId,'BROWSER_PREPARATION_CHECKPOINT_INPUT_MISMATCH');
  const response=await page.request.get(origin.origin+'/api/requests/'+body.requestId,{headers:{Authorization:'Bearer '+secret},timeout:300000});
  need(response.ok()||response.status()===404,'BROWSER_PREPARATION_RECOVERY_UNAVAILABLE');
  let retained=response.ok()?await response.json():null;
  if(retained?.status!=='COMPLETE'){
   if(retained)need(retained.status==='PENDING'&&retained.type==='prepare'&&Object.entries(body).every(([key,value])=>same(retained.request[key],value)),'BROWSER_PREPARATION_PENDING_INPUT_MISMATCH');
   report.requests.push({method:'POST',action:'prepare',requestId:body.requestId,request:body,recovery:true});
   const retried=await page.request.post(origin.origin+'/api/prepare',{headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},data:body,timeout:300000});
   need(retried.ok(),'BROWSER_ORIGINAL_PREPARATION_RETRY_FAILED');
   retained=await getRecord(page,body.requestId);
  }
  need(retained?.type==='prepare'&&retained.status==='COMPLETE'&&Object.entries(body).every(([key,value])=>same(retained.request[key],value)),'BROWSER_RECOVERED_REQUEST_INPUT_MISMATCH');
  return retained;
 }
 async function reopen(page,id){
  await click(page,page.locator('#refresh'));
  let count=0;
  while(await page.locator('#history > .file-row').filter({hasText:id}).count()===0){
   need(await page.locator('#more-history').isVisible(),'BROWSER_RETAINED_HISTORY_ID_MISSING');
   const before=await page.locator('#history > .file-row').count();
   await click(page,page.locator('#more-history'));
   const after=await page.locator('#history > .file-row').count();
   need(after>before&&++count<=100000,'BROWSER_HISTORY_PAGINATION_STALLED');
  }
  const row=page.locator('#history > .file-row').filter({hasText:id});
  need(await row.count()===1,'BROWSER_HISTORY_ID_AMBIGUOUS');
  await click(page,row.getByRole('button',{name:'Reopen',exact:true}));
  need((await page.locator('#result > h3').textContent()).includes(id),'BROWSER_HISTORY_REOPEN_MISMATCH');
  need(await page.locator('#pending-section').isHidden(),'BROWSER_UNEXPECTED_PENDING_REQUEST');
 }
 async function openEditor(page){
  await page.goto(selectedUrl.href,{waitUntil:'domcontentloaded',timeout:300000});
  await settle(page);
  need(new URL(page.url()).hash==='','BROWSER_PRIVATE_FRAGMENT_NOT_CLEARED');
 }
 async function viewAttachment(row){
  check();
  if(/\.ckanw$/i.test(row.name)){
   report.views.push({path:row.path,sha256:row.sha256,kind:'original-workspace-archive',browserRendered:false,receiving:'The owning native course opens and independently receives this complete binary archive.'});return;
  }
  const raw=await privateRead(row.path,Math.max(MAX_FILE,row.bytes));let content;
  try{content=decode(raw);}catch{
   report.views.push({path:row.path,sha256:row.sha256,kind:'binary-original',browserRendered:false});return;
  }
  const page=await newPage('attachment-'+row.name);
  try{
   await page.setViewportSize({width:1440,height:1000});
   // The source report is original standalone HTML. Other complete text is
   // rendered losslessly in a plain-text recipient viewer, with no truncation.
   let viewPath=row.path,kind='original-html';
   if(!/\.html?$/i.test(row.name)){
    kind='complete-text-viewer';
    viewPath=join(viewingDirectory,String(report.views.length).padStart(5,'0')+'.html');
    const viewer=await write(viewPath,Buffer.from('<!doctype html><meta charset="utf-8"><title>'+html(row.name)+'</title><style>body{font:16px system-ui;padding:1rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>'+html(row.name)+'</h1><p>'+row.bytes+' bytes · SHA-256 '+row.sha256+'</p><pre id="text"></pre><script>document.getElementById("text").textContent=new TextDecoder("utf-8",{fatal:true}).decode(Uint8Array.from(atob('+JSON.stringify(raw.toString('base64'))+'),c=>c.charCodeAt(0)));</script>'));
    report.downloads.push({role:'complete-text-viewer',name:row.name+'.viewer.html',...viewer,source:{sha256:row.sha256,bytes:row.bytes,path:row.path},complete:true});
   }
   await page.route('**/*',route=>['file:','data:','about:'].includes(new URL(route.request().url()).protocol)?route.continue():route.abort());
   await page.goto(pathToFileURL(viewPath).href,{waitUntil:'load',timeout:300000});
   if(kind==='complete-text-viewer')need(await page.locator('pre').textContent()===content,'BROWSER_ATTACHMENT_RENDER_TRUNCATED');
   else need(await page.locator('h1').textContent()==='Complete catalogue source','BROWSER_SOURCE_HTML_RENDER_MISMATCH');
   const top=await shot(page,'attachment-'+String(report.views.length).padStart(3,'0')+'-top');
   await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight));
   const bottom=await shot(page,'attachment-'+String(report.views.length).padStart(3,'0')+'-bottom');
   report.views.push({path:row.path,sha256:row.sha256,kind,browserRendered:true,completeText:kind==='complete-text-viewer',viewerPath:viewPath,screenshots:[top.path,bottom.path],viewedByOperator:false});
  }finally{await page.close({runBeforeUnload:false});}
 }
 try{
  check();
  report.source={path:fileURLToPath(import.meta.url),sha256:digest(await readFile(fileURLToPath(import.meta.url)))};
  if(!context){
   const chromium=(playwright?.chromium??playwright?.default?.chromium);
   need(chromium&&typeof chromium.launch==='function','BROWSER_ORIGINAL_PLAYWRIGHT_REQUIRED');
   if(chromiumPath!==undefined)need(typeof chromiumPath==='string'&&resolve(chromiumPath)===chromiumPath,'BROWSER_CHROMIUM_ABSOLUTE_REQUIRED');
   launchPromise=chromium.launch({headless:true,...(chromiumPath?{executablePath:chromiumPath}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
   browser=await launchPromise;check();
   contextPromise=browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1000}});
   context=await contextPromise;check();
  }
  const page=await newPage('installation-editor');
  await page.setViewportSize({width:1440,height:1000});
  await openEditor(page);
  const actual=await getRecord(page,preparationRequestId);
  need(same(actual,expectedPreparation),'BROWSER_PREPARATION_SOURCE_CHANGED');
  let recoveredPreparation=null;
  if(preparationIntent){
   recoveredPreparation=await recoverPreparation(page,actual);
   if(await page.locator('#pending-section').isVisible()){
    need((await page.locator('#pending-description').textContent()).includes(preparationIntent.request.requestId),'BROWSER_UNRELATED_DRAFT_REQUEST_PENDING');
    await click(page,page.locator('#resume'));
    need(await page.locator('#pending-section').isHidden(),'BROWSER_ORIGINAL_UI_REQUEST_NOT_RECONCILED');
   }
  }
  await reopen(page,preparationRequestId);
  await observe('original-preparation-reopened',{requestId:preparationRequestId,files:actual.files.length});
  const downloadedById=new Map();
  const rows=page.locator('#result > .file-row');
  need(await rows.count()===actual.files.length,'BROWSER_PREPARED_FILE_COUNT_MISMATCH');
  for(let index=0;index<actual.files.length;index++){
   const file=actual.files[index];
   need(HASH.test(file.fileId??'')&&HASH.test(file.sha256??'')&&Number.isSafeInteger(file.bytes)&&file.bytes>=0,'BROWSER_FILE_DESCRIPTOR_INVALID');
   need((await rows.nth(index).textContent()).includes(file.name)&&(await rows.nth(index).textContent()).includes(file.sha256),'BROWSER_PREPARED_FILE_ROW_MISMATCH');
   downloadedById.set(file.fileId,await capture(page,rows.nth(index).getByRole('button',{name:'Download complete file',exact:true}),{role:'prepared-attachment',name:file.name,expected:file,source:{requestId:preparationRequestId,fileId:file.fileId}}));
  }
  const selectionFile=downloadedById.get(actual.request.selectionId),bindingsFile=downloadedById.get(actual.request.bindingsId);
  need(selectionFile&&bindingsFile,'BROWSER_PREPARATION_INPUTS_MISSING');
  const selection=await readJSON(selectionFile),bindings=await readJSON(bindingsFile);
  const sourceFile=actual.files.find(file=>file.name==='Dcat_Complete_Source_Report.json');
  need(sourceFile,'BROWSER_COMPLETE_SOURCE_REPORT_MISSING');
  const source=await readJSON(downloadedById.get(sourceFile.fileId));
  need(Array.isArray(source.records)&&Array.isArray(source.manifest?.files),'BROWSER_SOURCE_INVENTORY_MISSING');
  const baselineDraft=await capture(page,page.locator('#save-draft'),{role:'baseline-editor-draft',name:'Catalogue_Installation_Editor.json'});
  const baseline=await readJSON(baselineDraft);
  for(const [kind,key]of [['case','caseId'],['seed','seedId'],['bindings','bindingsId'],['selection','selectionId']]){
   need(baseline.inputs[kind]?.fileId===actual.request[key],'BROWSER_HISTORY_INPUT_REBIND_MISMATCH');
  }
  need(baseline.inputs.archive?.fileId===actual.archiveId&&baseline.inspectionId===actual.inspectionId&&baseline.selectionSourceId===actual.request.selectionSourceId,'BROWSER_HISTORY_SOURCE_REBIND_MISMATCH');
  need(same(baseline.selection,selection)&&same(baseline.bindings,bindings)&&baseline.source?.sourceSha256===source.sourceSha256,'BROWSER_HISTORY_EDITOR_CONTENT_MISMATCH');
  await page.locator('#result').scrollIntoViewIfNeeded();await shot(page,'desktop-prepared-work');
  await page.locator('#scope-section').scrollIntoViewIfNeeded();await shot(page,'desktop-source-scope');

  const families=[...new Set(source.records.map(row=>row.family))].sort();
  for(const family of families){
   await page.locator('#family').selectOption(family);
   const count=source.records.filter(row=>row.family===family).length;
   need((await page.locator('#scope-count').textContent()).includes('of '+count+' matching records'),'BROWSER_FAMILY_FILTER_COUNT');
  }
  await page.locator('#family').selectOption('');
  if(source.records.length){
   await page.locator('#query').fill(String(source.records[0].key));
   need(await page.locator('#scope > .record').count()>0,'BROWSER_SOURCE_TEXT_SEARCH_MISSING');
   await page.locator('#query').fill('');
   await page.locator('#scope > .record').first().locator('summary').click();
   const shown=await page.locator('#scope > .record').first().locator('pre').first().textContent();
   need(same(JSON.parse(shown),source.records[0].metadata),'BROWSER_ORIGINAL_RECORD_TEXT_MISMATCH');
  }
  let sourcePages=1;
  while(await page.locator('#next').isEnabled()){
   await page.locator('#next').click();sourcePages++;
   need(sourcePages<=Math.max(1,Math.ceil(source.records.length/50)),'BROWSER_SOURCE_PAGING_STALLED');
  }
  need(sourcePages===Math.max(1,Math.ceil(source.records.length/50)),'BROWSER_SOURCE_PAGING_INCOMPLETE');
  if(sourcePages>1){await page.locator('#previous').click();need((await page.locator('#scope-count').textContent()).includes('Showing '+((sourcePages-2)*50+1)+'–'),'BROWSER_SOURCE_PREVIOUS_MISMATCH');}
  await page.locator('#query').fill('');await page.locator('#family').selectOption('');
  await observe('scope-controls-used',{families,sourcePages,records:source.records.length});

  const allFiles=source.manifest.files;
  const originalFilesDetails=page.locator('#scope-section > details');
  if(!(await originalFilesDetails.evaluate(element=>element.hasAttribute('open'))))await originalFilesDetails.locator('summary').click();
  if(allFiles.length){
   await page.locator('#file-query').fill(allFiles[0].path);
   need(await page.locator('#archive-files > .file-row').count()>0,'BROWSER_ORIGINAL_FILE_SEARCH_MISSING');
  }
  await page.locator('#file-query').fill('');
  let memberIndex=0,filePages=0;
  while(true){
   const memberRows=page.locator('#archive-files > .file-row');
   const count=await memberRows.count();
   need(count===Math.min(100,allFiles.length-memberIndex),'BROWSER_ORIGINAL_FILE_PAGE_MISMATCH');
   for(let index=0;index<count;index++){
    const file=allFiles[memberIndex++];
    need((await memberRows.nth(index).textContent()).includes(file.path)&&(await memberRows.nth(index).textContent()).includes(file.sha256),'BROWSER_ORIGINAL_FILE_ROW_MISMATCH');
    await capture(page,memberRows.nth(index).getByRole('button',{name:'Download original file',exact:true}),{role:'original-source-member',name:basename(file.path),expected:file,source:{inspectionId:actual.inspectionId,path:file.path}});
   }
   filePages++;
   if(await page.locator('#file-next').isDisabled())break;
   await page.locator('#file-next').click();
  }
  need(memberIndex===allFiles.length,'BROWSER_ORIGINAL_FILES_INCOMPLETE');
  if(filePages>1){await page.locator('#file-previous').click();need((await page.locator('#file-count').textContent()).includes('page '+(filePages-1)+' of '+filePages),'BROWSER_FILE_PREVIOUS_MISMATCH');}
  await page.locator('#file-query').fill('');
  await observe('all-original-source-members-downloaded',{files:memberIndex,filePages});

  const selectedDownload=await capture(page,page.locator('#download-selection'),{role:'editor-selection',name:'Selected_Dcat_Scope.json'});
  const bindingsDownload=await capture(page,page.locator('#download-bindings'),{role:'editor-bindings',name:'bindings.json'});
  const sourceDownload=await capture(page,page.locator('#download-source'),{role:'editor-source-report',name:'Dcat_Complete_Source_Report.json',expected:sourceFile});
  need(same(await readJSON(selectedDownload),selection)&&same(await readJSON(bindingsDownload),bindings),'BROWSER_EDITOR_DOWNLOAD_CONTENT_MISMATCH');
  // Edit only the draft, preserve it, reopen it, then restore its original
  // complete inputs. This does not accept a new case or an Installation.
  if(source.records.length){
   const originalChoice=selection.records.find(row=>row.key===source.records[0].key);
   need(originalChoice,'BROWSER_SOURCE_SELECTION_MISSING');
   await page.locator('#family').selectOption('');await page.locator('#query').fill(source.records[0].key);
   await page.locator('#bulk-decision').selectOption(originalChoice.included?'false':'true');
   await page.locator('#bulk-purpose').fill('Browser customer draft '+attemptId+'; original saved selection remains authoritative.');
   await click(page,page.locator('#bulk-apply'));
  }
  const payment=page.locator('#bindings > .binding-group').filter({has:page.getByRole('heading',{name:'Payment',exact:true})});
  const facilitator=payment.locator('label').filter({hasText:/^Facilitators/}).locator('textarea');
  need(await facilitator.count()===1,'BROWSER_FACILITATOR_CONTROL_MISSING');
  await facilitator.fill('[');
  need(await facilitator.evaluate(element=>!element.checkValidity()),'BROWSER_UNFINISHED_BINDING_NOT_RETAINED');
  const editedDraft=await capture(page,page.locator('#save-draft'),{role:'edited-editor-draft',name:'Catalogue_Installation_Editor.json'});
  const edited=await readJSON(editedDraft);
  need(edited.bindingText?.['payment.facilitators']==='['&&edited.bindingErrors?.['payment.facilitators'],'BROWSER_UNFINISHED_DRAFT_CUSTODY_MISSING');
  await openEditor(page);
  need(await facilitator.inputValue()==='['&&await facilitator.evaluate(element=>!element.checkValidity()),'BROWSER_RELOAD_DROPPED_UNFINISHED_BINDING');
  await page.locator('#open-draft').setInputFiles(baselineDraft.path);await settle(page);
  need((await page.locator('#status').textContent())==='Complete editor draft reopened.','BROWSER_BASELINE_DRAFT_REOPEN_FAILED');
  await page.locator('#query').fill('');await page.locator('#family').selectOption('');
  const restored=await capture(page,page.locator('#save-draft'),{role:'restored-editor-draft',name:'Catalogue_Installation_Editor.json'});
  const restoredValue=await readJSON(restored);
  need(same(restoredValue.inputs,baseline.inputs)&&same(restoredValue.selection,baseline.selection)&&same(restoredValue.bindings,baseline.bindings)&&Object.keys(restoredValue.bindingErrors??{}).length===0,'BROWSER_BASELINE_DRAFT_RESTORE_MISMATCH');
  await observe('draft-edit-reload-and-original-restore',{baseline:baselineDraft.sha256,edited:editedDraft.sha256,restored:restored.sha256});

  if(prepareAgain){
   let retained;
   if(preparationIntent){
    retained=recoveredPreparation??await recoverPreparation(page,actual);
    await reopen(page,preparationIntent.request.requestId);
    await observe('same-original-ui-preparation-recovered',{requestId:preparationIntent.request.requestId});
   }else{
    // Never change the case's exact attached scope to make UI preparation pass.
    if(selectedDownload.bytes!==selectionFile.bytes||selectedDownload.sha256!==selectionFile.sha256){
     await observe('ui-scope-serialization-differs',{attached:{bytes:selectionFile.bytes,sha256:selectionFile.sha256},ui:{bytes:selectedDownload.bytes,sha256:selectedDownload.sha256},dispatched:false});
     throw Object.assign(new Error('BROWSER_UI_SCOPE_BYTES_REQUIRE_ORIGINAL_ATTACHMENT'),{code:'BROWSER_UI_SCOPE_BYTES_REQUIRE_ORIGINAL_ATTACHMENT'});
    }
    let dispatchError=null;
    await page.route(origin.origin+'/api/prepare',async route=>{
     try{
      const request=route.request();
      need(request.method()==='POST','BROWSER_PREPARATION_METHOD_MISMATCH');
      const body=request.postDataJSON();
      need(UUID.test(body?.requestId??'')&&body.requestId!==preparationRequestId&&body.inspectionId===actual.inspectionId&&body.caseId===actual.request.caseId&&body.seedId===actual.request.seedId&&body.selectionSourceId===actual.request.selectionSourceId,'BROWSER_UI_PREPARATION_INPUT_MISMATCH');
      need(!preparationIntent,'BROWSER_SECOND_PREPARATION_ALREADY_ADMITTED');
      const value={schema:'stellar-forge.dcat-installation-browser-request.v1',baselinePreparationRequestId:preparationRequestId,baselinePreparationSha256:baselineSha256,request:body};
      report.preparationRequestReceipt=await checkpoint(checkpointPath,value);
      preparationIntent=value;
      await route.continue();
     }catch(error){
      dispatchError=error;
      await route.abort('failed').catch(()=>{});
     }
    });
    const responsePromise=page.waitForResponse(response=>response.url()===origin.origin+'/api/prepare'&&response.request().method()==='POST',{timeout:300000});
    const failedPromise=page.waitForEvent('requestfailed',{predicate:request=>request.url()===origin.origin+'/api/prepare'&&request.method()==='POST',timeout:300000}).then(()=>{throw dispatchError??new Error('BROWSER_PREPARATION_DISPATCH_FAILED');});
    const [response]=await Promise.all([Promise.race([responsePromise,failedPromise]),click(page,page.locator('#prepare'))]);
    need(response.ok(),'BROWSER_UI_PREPARATION_FAILED');
    const result=await response.json();
    need(preparationIntent&&result.requestId===preparationIntent.request.requestId&&result.type==='prepare','BROWSER_UI_PREPARATION_RECEIPT_INVALID');
    retained=await getRecord(page,result.requestId);
   }
   report.preparationRequestReceipt??={path:checkpointPath,...await identity(checkpointPath)};
   report.browserPreparation=retained;
   need(retained?.status==='COMPLETE'&&same(retained.installation,actual.installation)&&same(retained.scope,actual.scope)&&same(retained.source,actual.source)&&retained.inspectionId===actual.inspectionId&&retained.archiveId===actual.archiveId&&retained.request.caseId===actual.request.caseId&&retained.request.seedId===actual.request.seedId&&retained.request.selectionSourceId===actual.request.selectionSourceId&&same(contentInventory(retained.files),contentInventory(actual.files)),'BROWSER_UI_PREPARATION_CONTENT_MISMATCH');
   // Names/fileIds may differ for unchanged bindings/selection supplied through
   // CLI versus UI. The complete bytes and their role remain identical.
   await observe('same-input-ui-preparation-retained',{requestId:retained.requestId,files:retained.files.map(file=>({fileId:file.fileId,name:file.name,kind:file.kind,bytes:file.bytes,sha256:file.sha256}))});
  }else await observe('original-case-and-preparation-preserved',{prepareControl:'The caller did not request a second preparation; original retained request is reopened below.'});

  await reopen(page,preparationRequestId);
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>window.scrollTo(0,0));await shot(page,'narrow-inputs');
  await page.locator('#scope-section').scrollIntoViewIfNeeded();await shot(page,'narrow-source-selection');
  await page.locator('#bindings-section').scrollIntoViewIfNeeded();await shot(page,'narrow-bindings');
  await page.locator('#result').scrollIntoViewIfNeeded();await shot(page,'narrow-prepared-files');
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('#bindings-section').scrollIntoViewIfNeeded();await shot(page,'desktop-bindings');
  await page.locator('#history').scrollIntoViewIfNeeded();await shot(page,'desktop-retained-history');
  // A new page obtains the original private session link and reconstructs the
  // retained inputs from the same immutable request, not from an in-memory DOM.
  await page.close({runBeforeUnload:false});
  const cold=await newPage('cold-history');
  await cold.setViewportSize({width:1440,height:1000});await openEditor(cold);await reopen(cold,preparationRequestId);
  const coldDraft=await capture(cold,cold.locator('#save-draft'),{role:'cold-editor-draft',name:'Catalogue_Installation_Editor.json'});
  const coldValue=await readJSON(coldDraft);
  need(same(coldValue.inputs,baseline.inputs)&&same(coldValue.selection,selection)&&same(coldValue.bindings,bindings)&&coldValue.selectionSourceId===actual.request.selectionSourceId,'BROWSER_COLD_HISTORY_REBIND_MISMATCH');
  need(same(await getRecord(cold,preparationRequestId),expectedPreparation),'BROWSER_ORIGINAL_PREPARATION_MUTATED');
  await shot(cold,'desktop-cold-history');
  await observe('cold-history-reopened',{requestId:preparationRequestId,draftSha256:coldDraft.sha256});
  for(const row of [...downloadedById.values()])await viewAttachment(row);
  need(report.pageErrors.length===0&&report.errors.length===0,'BROWSER_PAGE_SCRIPT_ERRORS');
  check();report.complete=true;
 }catch(error){
  report.complete=false;report.errors.push({code:scrub(error.code??'BROWSER_CUSTOMER_FAILED'),message:scrub(error.message)});
 }finally{
  await closeOwned();
  signal?.removeEventListener('abort',abort);process.off('SIGINT',termination);process.off('SIGTERM',termination);
  if(interrupted||signal?.aborted){report.complete=false;report.interrupted=true;}
  if(report.shutdown.pages.some(row=>!row.closed)||(!browserContext&&context&&!report.shutdown.contextClosed)||(!browserContext&&browser&&!report.shutdown.browserClosed))report.complete=false;
  report.finishedAt=new Date().toISOString();
 }
 if(preparationIntent&&!report.preparationRequestReceipt)report.preparationRequestReceipt={path:checkpointPath,...await identity(checkpointPath)};
 const receipt=await write(join(attempt,'browser-result.json'),encode(report));
 return{...report,receipt};
}
