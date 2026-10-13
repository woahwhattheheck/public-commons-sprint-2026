/** Run against the exact installed operator and an actual caller-selected original file.
 * This observes raw file custody; it never invokes a provider receiver on a runtime archive.
 * The producing owner must view retained desktop/mobile screenshots and open original outputs.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';

const input=JSON.parse(await fsp.readFile(process.argv[2],'utf8'));
const require=createRequire(path.join(input.nodeModules,'__provider_input_browser__.cjs'));
const {chromium}=require('playwright');
const source=input.selectedFile;
const reopen=process.argv.includes('--reopen')||input.mode==='reopen';
function need(value,message){if(!value)throw Error(message);}
async function fileIdentity(filename){
 const hash=crypto.createHash('sha256');let bytes=0;
 for await(const part of fs.createReadStream(filename)){bytes+=part.length;hash.update(part);}
 return{bytes,sha256:hash.digest('hex')};
}
need(source&&path.isAbsolute(source.path)&&Number.isSafeInteger(source.bytes)&&/^[a-f0-9]{64}$/.test(source.sha256),'Supply the actual original source file descriptor.');
const actual=await fileIdentity(source.path);need(actual.bytes===source.bytes&&actual.sha256===source.sha256,'Original selected file identity differs.');
need(source.bytes>8388608||reopen,'The interrupted multipart course requires an actual source larger than one chunk.');
const products=path.resolve(input.products);await fsp.mkdir(products,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:input.chromium,args:['--no-sandbox','--disable-dev-shm-usage']});
let context,page,inputId=input.inputId||null;
const events=[],errors=[],httpErrors=[],saved=[],screenshots=[];
const output={schema:'stellar-forge.provider-input-browser-receiving.v1',scope:'Actual original file transport; no provider acquisition, business receiver or target import',mode:reopen?'reopen':'receive',workspaceId:input.workspaceId,inputId,source:{name:source.name,bytes:source.bytes,sha256:source.sha256,kind:source.kind,title:source.title},origin:new URL(input.url).origin,downloadMode:'standard browser Blob download',phases:events,status:'RUNNING'};
function stage(name,detail={}){events.push({phase:name,at:new Date().toISOString(),...detail});console.log(JSON.stringify({stage:name,...detail}));}
async function api(endpoint){
 return page.evaluate(async endpoint=>{
  const token=sessionStorage.getItem('source-workflow-connection:'+location.origin)||'';
  const response=await fetch(endpoint,{headers:{'X-Workflow-Capability':token}});
  let value;try{value=await response.json();}catch{throw Error('Unreadable retained input response');}
  if(!response.ok)throw Error('Original input status HTTP '+response.status+': '+(value.message||value.error));
  return value;
 },endpoint);
}
async function startPage(width=1440){
 context=await browser.newContext({viewport:{width,height:1000},acceptDownloads:true});
 // Headless receiving operates the standard download fallback. The native file-save
 // picker remains a separate real-user option in the shipped, unchanged application.
 await context.addInitScript(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});});
 page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400)httpErrors.push({status:r.status(),path:new URL(r.url()).pathname});});
 await page.goto(input.url,{waitUntil:'domcontentloaded'});
 await page.getByRole('button',{name:'Provider sources',exact:true}).click();
 await page.locator('.pi-host > summary').waitFor({state:'visible'});
 await page.locator('.pi-host > summary').click();
 await page.getByRole('heading',{name:'Original input files',exact:true}).waitFor();
 await page.waitForFunction(()=>document.querySelector('.provider-inputs .pi-list')?.textContent.includes('retained input transfers'));
}
async function screenshot(name){
 const filename=path.join(products,name);await page.screenshot({path:filename,fullPage:true});screenshots.push(filename);
}
async function selectedStatus(){
 const row=await api('/api/providers/inputs/'+encodeURIComponent(inputId));
 need(row.workspaceId===input.workspaceId&&row.inputId===inputId,'Original input/workspace identity changed.');
 need(row.fileName===source.name&&row.bytes===source.bytes&&row.expectedSha256===source.sha256&&row.kind===source.kind,'Original retained file selection changed.');
 return row;
}
async function openRetained(){
 await page.getByLabel('Find retained input files',{exact:true}).fill(inputId);
 const row=page.locator('.provider-inputs .pi-list tbody tr').filter({hasText:inputId});
 await row.getByRole('button',{name:'Open',exact:true}).click();
 await page.waitForFunction(id=>document.querySelector('.provider-inputs .pi-detail')?.textContent.includes(id),inputId);
}
async function fullDownload(suffix){
 const awaiting=page.waitForEvent('download',{timeout:240000});
 await page.getByRole('button',{name:'Download complete original file',exact:true}).click();
 const download=await awaiting,filename=path.join(products,'Provider_Input_Original'+suffix+path.extname(source.name));
 await download.saveAs(filename);need(!await download.failure(),'The original browser download failed.');
 const result=await fileIdentity(filename);need(result.bytes===source.bytes&&result.sha256===source.sha256,'Browser download differs from original file.');
 saved.push(filename);return {path:filename,name:download.suggestedFilename(),...result};
}
try{
 await startPage();
 if(!reopen){
  const initial=await api('/api/providers/inputs');need(initial.workspaceId===input.workspaceId,'Wrong original receiving workspace.');
  await screenshot('provider-inputs-empty-desktop.png');
  await page.getByRole('button',{name:'New file',exact:true}).click();
  await page.getByLabel('Select original input file',{exact:true}).setInputFiles(source.path);
  await page.getByLabel('Input purpose',{exact:true}).selectOption(source.kind);
  await page.getByLabel('Input title',{exact:true}).fill(source.title);
  const differentSha=(source.sha256[0]==='0'?'1':'0')+source.sha256.slice(1);
  await page.getByLabel('Supplied original SHA-256',{exact:true}).fill(differentSha);
  await page.getByRole('button',{name:'Retain original file',exact:true}).click();
  await page.locator('.provider-inputs .pw-notice').filter({hasText:'The selected file differs from the supplied original SHA-256.'}).waitFor({timeout:240000});
  await page.waitForFunction(()=>!document.querySelector('.provider-inputs button[type=submit]')?.disabled);
  const afterMismatch=await api('/api/providers/inputs');
  need(JSON.stringify((afterMismatch.inputs||[]).map(x=>x.inputId).sort())===JSON.stringify((initial.inputs||[]).map(x=>x.inputId).sort()),'A mismatched local file expectation created a server input.');
  const mismatchDraft=await page.evaluate(workspaceId=>{
   const state=JSON.parse(localStorage.getItem('source-provider-inputs:'+location.origin+':'+workspaceId)||'null');
   return state?.drafts?.[state.selected]||null;
  },input.workspaceId);
  need(mismatchDraft&&!mismatchDraft.intent,'The mismatched supplied SHA froze an original server intent.');
  output.validationObservation={kind:'supplied-SHA mismatch on the same original file',inputId:mismatchDraft.inputId,serverInputCreated:false};
  await screenshot('provider-inputs-identity-error-desktop.png');
  stage('original_file_identity_error_observed',{inputId:mismatchDraft.inputId,serverInputCreated:false});
  await page.getByLabel('Supplied original SHA-256',{exact:true}).fill(source.sha256);
  let releaseGate;const gate=new Promise(resolve=>{releaseGate=resolve;});
  let gateActive=true;
  await page.route('**/api/providers/inputs/*/chunks',async route=>{
   const offset=Number(route.request().headers()['x-input-offset']);
   if(gateActive&&offset>=8388608){await gate;await route.abort().catch(()=>{});}
   else await route.continue();
  });
  const first=page.waitForResponse(r=>r.url().includes('/api/providers/inputs/')&&r.url().endsWith('/chunks')&&r.request().headers()['x-input-offset']==='0'&&r.status()===200,{timeout:240000});
  await page.getByRole('button',{name:'Retain original file',exact:true}).click();
  const reply=await(await first).json();inputId=reply.inputId;output.inputId=inputId;
  need(inputId===mismatchDraft.inputId&&/^received-[a-f0-9]{32}$/.test(inputId)&&reply.receivedBytes===8388608,'Original first chunk was not acknowledged.');
  await page.getByRole('button',{name:'Pause transfer',exact:true}).click();gateActive=false;releaseGate();
  await page.unroute('**/api/providers/inputs/*/chunks');
  await page.waitForFunction(()=>!document.querySelector('.provider-inputs button[type=submit]')?.disabled);
  const prefix=await selectedStatus();need(prefix.status==='UPLOADING'&&prefix.receivedBytes===8388608&&prefix.chunks.length===1,'Pause did not preserve the original accepted prefix.');
  const draft=await page.evaluate(({workspaceId,inputId})=>{
   const value=JSON.parse(localStorage.getItem('source-provider-inputs:'+location.origin+':'+workspaceId)||'null');
   return value?.drafts?.[inputId]||null;
  },{workspaceId:input.workspaceId,inputId});
  need(draft?.intent?.sha256===source.sha256&&draft.intent.inputId===inputId,'The exact original full-file intent was not retained.');
  stage('original_prefix_retained',{inputId,bytes:prefix.receivedBytes,chunkSha256:prefix.chunks[0].sha256});
  await screenshot('provider-inputs-paused-desktop.png');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByRole('button',{name:'Provider sources',exact:true}).click();
  await page.locator('.pi-host > summary').click();
  await page.getByLabel('Select original input file',{exact:true}).waitFor();
  await page.getByLabel('Select original input file',{exact:true}).setInputFiles(source.path);
  const complete=page.waitForResponse(r=>r.url().endsWith('/'+inputId+'/complete')&&r.status()===200,{timeout:240000});
  await page.getByRole('button',{name:'Continue original transfer',exact:true}).click();
  const final=await(await complete).json();need(final.status==='COMPLETE'&&final.inputId===inputId&&final.sha256===source.sha256&&final.bytes===source.bytes,'Complete source differs.');
  await page.getByRole('button',{name:'Download complete original file',exact:true}).waitFor({state:'visible'});
  await page.waitForFunction(()=>[...document.querySelectorAll('.provider-inputs button')].some(x=>x.textContent==='Download complete original file'&&!x.disabled));
  // Completion keeps its submit button disabled; the original download becomes enabled.
  await page.getByRole('button',{name:'Download complete original file',exact:true}).waitFor();
  stage('reselected_original_completed',{inputId,bytes:final.bytes,sha256:final.sha256,chunks:final.chunkCount});
 }else{
  need(/^received-[a-f0-9]{32}$/.test(inputId),'Reopen requires the original retained input ID.');
  await openRetained();
  stage('original_input_reopened_after_server_restart',{inputId});
 }
 output.finalStatus=await selectedStatus();
 need(output.finalStatus.status==='COMPLETE'&&output.finalStatus.sha256===source.sha256,'Original complete state missing.');
 const catalog=await api('/api/providers/catalog'),entry=(catalog.inputs||[]).find(x=>x.id===inputId);
 need(entry&&entry.sha256===source.sha256&&entry.bytes===source.bytes,'Original input is absent from the provider catalog.');
 output.catalogInput=entry;
 await screenshot(reopen?'provider-inputs-reopened-desktop.png':'provider-inputs-complete-desktop.png');
 if(!reopen){
  output.download=await fullDownload('');
  stage('original_download_matches',{inputId,bytes:output.download.bytes,sha256:output.download.sha256});
  const receiptWait=page.waitForEvent('download');
  await page.getByRole('button',{name:'Download input receipt',exact:true}).click();
  const receiptDownload=await receiptWait,receiptPath=path.join(products,'Provider_Input_Receipt.json');await receiptDownload.saveAs(receiptPath);
  const receipt=JSON.parse(await fsp.readFile(receiptPath,'utf8'));need(receipt.inputId===inputId&&receipt.sha256===source.sha256,'Downloaded original receipt differs.');saved.push(receiptPath);
  if(!(catalog.connections||[]).length){
   await page.getByRole('button',{name:'Use this file in an operation',exact:true}).click();
   await page.getByText('The complete file is retained. Choose its original installed connection and operation, then use this file.',{exact:true}).waitFor();
   stage('retained_input_requires_original_configured_connection',{inputId});
  }
 }
 await page.setViewportSize({width:390,height:844});
 await screenshot(reopen?'provider-inputs-reopened-mobile.png':'provider-inputs-complete-mobile.png');
 const geometry=await page.evaluate(()=>({viewport:innerWidth,scroll:document.documentElement.scrollWidth}));
 need(geometry.scroll<=geometry.viewport+2,'The actual narrow input desk overflows the page.');
 output.mobileGeometry=geometry;
 await context.close();
 await startPage();
 await openRetained();
 const fresh=await selectedStatus();need(fresh.sha256===source.sha256&&fresh.status==='COMPLETE','Independent browser did not reopen original complete input.');
 stage('independent_browser_reopened',{inputId});
 await screenshot(reopen?'provider-inputs-reopened-independent.png':'provider-inputs-independent-desktop.png');
 output.finalStatus=fresh;output.status='COMPLETE';
 need(errors.length===0,'The actual browser reported a page error: '+errors.join('; '));
 need(httpErrors.length===0,'The actual browser reported failed HTTP responses: '+JSON.stringify(httpErrors));
}catch(error){
 output.status='FAILED';output.error={message:error.message,stack:error.stack};
 if(page){try{await screenshot('provider-inputs-failure.png');}catch{}}
 process.exitCode=1;
}finally{
 output.inputId=inputId;output.pageErrors=errors;output.httpErrors=httpErrors;output.screenshots=screenshots;output.files=saved;
 await fsp.writeFile(path.join(products,reopen?'Provider_Input_Browser_Reopened.json':'Provider_Input_Browser.json'),JSON.stringify(output,null,2)+'\n');
 if(page){try{await fsp.writeFile(path.join(products,reopen?'Provider_Input_Reopened.html':'Provider_Input_Rendered.html'),await page.content());}catch{}}
 await browser.close();
 console.log(JSON.stringify({stage:'PROVIDER_INPUT_BROWSER_COMPLETE',status:output.status,inputId,products,error:output.error?.message}));
}
