#!/usr/bin/env node
/* One source-native operator continuation over the original permitting SQLite.
 * All financial writes are made through the actual cashiering UI.
 * The saved original native run is retained; this continuation creates a
 * separately labeled exercise in the same application and database.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

const argv=process.argv.slice(2), options={};
for(let i=0;i<argv.length;i++){
 if(!argv[i].startsWith('--'))throw new Error('Use named controller options.');
 const key=argv[i].slice(2); if(i+1>=argv.length)throw new Error('Missing value for '+key);options[key]=argv[++i];
}
const root=path.resolve(options.root||path.dirname(new URL(import.meta.url).pathname));
const source=path.resolve(options.source||path.join(root,'source/revenue/berkeley-clariti-32600118-20261010'));
const nativePath=path.resolve(options['native-result']||path.join(root,'native-run/result.json'));
const output=path.resolve(options.output||path.join(root,'browser-run'));
const python=options.python||process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3';
const port=Number(options.port||8798);
if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('A loopback port from 1 to 65535 is required.');
const origin='http://127.0.0.1:'+port;
const actor='Illustrative operator · Berkeley browser continuation';
const operation=options['operation-id']||'berkeley-daily-cashiering-browser-82e4-20261012';
const playwrightPath=options.playwright||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
const executablePath=options.browser||'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell';
const {chromium}=await import(pathToFileURL(playwrightPath).href);
const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readJSON=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const canonical=value=>JSON.stringify(value);
const check=(condition,message,details)=>{if(!condition){const e=new Error(message);e.details=details;throw e;}};
fs.mkdirSync(output,{recursive:true,mode:0o700});
const checkpointPath=path.join(output,'checkpoint.json');
let cp=fs.existsSync(checkpointPath)?readJSON(checkpointPath):{
 schema:'berkeley.cashiering.browser-continuation.v1',operation,created_at:new Date().toISOString(),
 native_result_path:nativePath,phases:{},actions:{},bindings:{},downloads:{},attempts:[],page_errors:[]
};
check(cp.operation===operation,'The retained controller belongs to a different operation.');
function save(){
 const temp=checkpointPath+'.'+process.pid+'.tmp';
 fs.writeFileSync(temp,JSON.stringify(cp,null,2)+'\n',{mode:0o600});
 fs.renameSync(temp,checkpointPath);
}
function smallResult(value){return value===undefined?null:value;}
const attempt={number:cp.attempts.length+1,pid:process.pid,started_at:new Date().toISOString(),status:'running'};
cp.attempts.push(attempt);save();
const native=readJSON(nativePath);
check(native.status==='PASS','The original native lifecycle must be closed with PASS before the browser starts.',native.status);
check(typeof native.database_path==='string'&&fs.existsSync(native.database_path),'The original closed SQLite path is required.');
const db=path.resolve(native.database_path);
if(cp.database_path)check(cp.database_path===db,'A continuation cannot silently change databases.');
cp.database_path=db;cp.native_run_id=native.run_id;cp.original_case_run_id=native.original_case_run_id;
cp.native_result_sha256=sha(fs.readFileSync(nativePath));
const currentSource={};
for(const relative of ['workspace/app.py','workspace/public/index.html','workspace/public/app.mjs','workspace/public/style.css','cashiering/model.py','cashiering/engine.py','cashiering/reporting.py','cashiering/API.md','cashiering/public/index.html','cashiering/public/app.mjs','cashiering/public/style.css']){
 const file=path.join(source,relative),bytes=fs.readFileSync(file);
 currentSource[relative]={bytes:bytes.length,sha256:sha(bytes)};
}
attempt.source=currentSource;cp.source= currentSource;save();
let browser=null,context=null,page=null,second=null,server=null,activeAction=null,cleaning=null;
const serverLog=fs.createWriteStream(path.join(output,'server-attempt-'+attempt.number+'.log'),{flags:'a',mode:0o600});
const browserErrors=[];
const pageRoles=new WeakMap();
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function startServer({database=db,restoreFile=null}={}){
 check(!server,'This controller already owns an application listener.');
 const child=spawn(python,['-B',path.join(source,'workspace/app.py'),'--db',database,'--port',String(port),...(restoreFile?['--restore',restoreFile]:[])],{cwd:source,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
 server=child;child.stdout.pipe(serverLog,{end:false});child.stderr.pipe(serverLog,{end:false});
 let spawnError;child.once('error',e=>{spawnError=e;});
 for(let i=0;i<100;i++){
  if(spawnError)throw spawnError;
  check(child.exitCode===null&&child.signalCode===null,'The owned application process exited before readiness.');
  try{
   const response=await fetch(origin+'/cashiering/app.mjs',{signal:AbortSignal.timeout(1000)});
   if(response.ok){
    const body=Buffer.from(await response.arrayBuffer());
    check(sha(body)===currentSource['cashiering/public/app.mjs'].sha256,'The listening UI does not match the accepted source.');
    if(child.exitCode===null){cp.server={pid:child.pid,origin,database_path:database,restored_from:restoreFile,started_at:new Date().toISOString()};save();return;}
   }
  }catch(error){if(error.message.includes('accepted source'))throw error;}
  await delay(200);
 }
 throw new Error('The original application listener did not become ready.');
}
async function stopServer(){
 const child=server;if(!child)return;
 if(child.exitCode!==null||child.signalCode!==null){server=null;return;}
 child.kill('SIGINT');
 await Promise.race([new Promise(resolve=>child.once('exit',resolve)),delay(15000)]);
 check(child.exitCode!==null||child.signalCode!==null,'The owned application listener did not close; retain its process identity.');
 server=null;cp.server={...cp.server,closed_at:new Date().toISOString(),exit_code:child.exitCode,signal:child.signalCode};save();
}
async function api(p,url){
 check(url.startsWith('/api/'),'Read helper only accepts an original local API route.');
 return p.evaluate(async endpoint=>{
  const token=document.querySelector('meta[name="workspace-token"]')?.content;
  const r=await fetch(endpoint,{credentials:'same-origin',headers:{'X-Workspace-Token':token||''}});
  const data=await r.json();if(!r.ok)throw new Error(data.message||data.error||('GET '+endpoint+' failed'));
  return data;
 },url);
}
const uri=value=>encodeURIComponent(String(value));
async function financialState(p=page){return api(p,'/api/cashiering/state');}
async function detail(id=cp.bindings.run_id,p=page){return api(p,'/api/cashiering/runs/'+uri(id));}
async function settle(p=page){
 await p.waitForFunction(()=>!document.querySelector('#app[aria-busy="true"],#editor[aria-busy="true"]'),null,{timeout:25000});
}
function action(name,attributes={},p=page,within=''){
 let selector=(within?within+' ':'')+'[data-action='+JSON.stringify(name)+']';
 for(const [key,value] of Object.entries(attributes))selector+='[data-'+key+'='+JSON.stringify(String(value))+']';
 return p.locator(selector);
}
async function clickAction(name,attributes={},p=page,within=''){
 await action(name,attributes,p,within).click();await settle(p);
}
async function tab(name,p=page){await clickAction('tab',{tab:name},p,'#app');}
async function formFill(name,value,p=page){
 const field=p.locator('#dialog-form [name='+JSON.stringify(name)+']');
 const tag=await field.evaluate(el=>el.tagName),type=await field.getAttribute('type');
 if(tag==='SELECT')await field.selectOption(String(value));
 else if(type==='checkbox'||type==='radio')await field.setChecked(Boolean(value));
 else await field.fill(value===null||value===undefined?'':String(value));
}
async function closeDialog(p=page){
 await settle(p);if(await p.locator('#editor').evaluate(el=>el.open)){await p.keyboard.press('Escape');await settle(p);}
}
async function selectRun(id,p=page){
 await closeDialog(p);await p.locator('#active-run').selectOption(id);await settle(p);
 check(await p.locator('#active-run').inputValue()===id,'The requested retained run was not selected.');
}
async function retainBrowserSession(p){
 const retained=await p.evaluate(()=>Object.fromEntries(['berkeley-cashier-actor','berkeley-cashier-pending'].map(key=>[key,sessionStorage.getItem(key)])));
 cp.browser_sessions=cp.browser_sessions||{};
 cp.browser_sessions[pageRoles.get(p)||'primary']=retained;save();
}
function retainedPendingEntry(value){
 if(!value)return null;
 let pending;try{pending=JSON.parse(value);}catch{throw new Error('The retained browser pending metadata is malformed.');}
 const match=Object.entries(cp.actions).find(([,entry])=>entry.request?.request_id===pending.request_id);
 check(match,'The restored tab has an original request outside this controller journal.',pending);
 return {pending,key:match[0],entry:match[1]};
}
async function reconcileRestoredTab(p,role){
 const raw=await p.evaluate(()=>sessionStorage.getItem('berkeley-cashier-pending'));
 const retained=retainedPendingEntry(raw);if(!retained)return;
 if(role==='primary'&&retained.key==='receiving-profile'&&cp.phases['18-current-state-recovery']?.status!=='PASS')return;
 const result=await api(p,'/api/cashiering/requests/'+uri(retained.pending.request_id));
 check(result.found,'The interrupted original request has no committed result; inspect the same request before any explicit continuation.',{key:retained.key,request_id:retained.pending.request_id});
 await clickAction('reconcile-pending',{},p,'#app');
 retained.entry.response=result.response;retained.entry.recovered_through_ui_at=new Date().toISOString();save();
 await retainBrowserSession(p);
}
async function attachPage(p){
 p.on('pageerror',e=>{browserErrors.push({message:e.message,at:new Date().toISOString()});cp.page_errors.push({message:e.message,at:new Date().toISOString(),attempt:attempt.number});save();});
 await p.route('**/api/cashiering/**',async route=>{
  const request=route.request();
  if(request.method()!=='POST')return route.continue();
  const pathname=new URL(request.url()).pathname;
  const active=activeAction;
  check(active&&active.page===p&&active.path===pathname,'An unregistered UI write was attempted.',{path:pathname});
  const payload=request.postDataJSON();
  const entry=cp.actions[active.key];
  entry.requests=entry.requests||[];entry.requests.push({payload,at:new Date().toISOString()});entry.request=payload;entry.path=pathname;save();
  await retainBrowserSession(p);
  if(active.dropResponse){
   const response=await route.fetch();
   const text=await response.text();entry.observed_status=response.status();entry.observed_server_response=JSON.parse(text);entry.dropped_response=true;save();
   return route.abort('failed');
  }
  return route.continue();
 });
}
async function newPage(){
 const role=page===null?'primary':'secondary';
 const p=await context.newPage();pageRoles.set(p,role);await attachPage(p);
 const retained={...(cp.browser_sessions?.[role]||{})};
 const pending=retainedPendingEntry(retained['berkeley-cashier-pending']);
 if(pending?.entry.http_status&&pending.entry.http_status!==200&&pending.entry.rejected_response)retained['berkeley-cashier-pending']=null;
 await p.addInitScript(({origin,state})=>{
  if(location.origin!==origin)return;
  for(const [key,value] of Object.entries(state)){if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,value);}
 },{origin,state:retained});
 await p.goto(origin+'/cashiering/',{waitUntil:'domcontentloaded'});
 await p.locator('#active-run').waitFor();await settle(p);
 await reconcileRestoredTab(p,role);return p;
}
async function recoverAction(key,p=page){
 const entry=cp.actions[key];if(!entry)return null;if(entry.response)return entry.response;if(entry.http_status&&entry.rejected_response)return entry.rejected_response;
 if(!entry.request)return null;
 const result=await api(p,'/api/cashiering/requests/'+uri(entry.request.request_id));
 if(result.found){entry.response=result.response;entry.recovered_at=new Date().toISOString();save();return entry.response;}
 throw new Error('No committed result is recorded for the retained UI action '+key+'. Inspect its original request before explicitly continuing; no automatic replay was attempted.');
}
async function postAction(key,endpoint,perform,{p=page,expectedStatus=200,dropResponse=false}={}){
 const prior=await recoverAction(key,p);if(prior){if(cp.actions[key].response){await closeDialog(p);await clickAction('refresh',{},p,'#app');await retainBrowserSession(p);}return prior;}
 check(!activeAction,'Only one UI write may be active.');
 cp.actions[key]={path:endpoint,started_at:new Date().toISOString(),requests:[]};save();
 activeAction={key,path:endpoint,page:p,dropResponse};
 let wait;
 if(!dropResponse)wait=p.waitForResponse(r=>r.request().method()==='POST'&&new URL(r.url()).pathname===endpoint,{timeout:30000});
 try{
  await perform();
  if(dropResponse){
   await p.locator('.dialog-error').waitFor({state:'visible',timeout:30000});await settle(p);await retainBrowserSession(p);
   const entry=cp.actions[key];check(entry.dropped_response&&entry.observed_status===200,'The deliberately interrupted response did not originate from one committed request.');
   return entry.observed_server_response;
  }
  const response=await wait;const data=await response.json();
  cp.actions[key].http_status=response.status();cp.actions[key].finished_at=new Date().toISOString();
  if(response.status()===200)cp.actions[key].response=data;else cp.actions[key].rejected_response=data;
  save();check(response.status()===expectedStatus,'The UI action returned an unexpected native result.',{key,status:response.status(),data});
  await settle(p);
  if(expectedStatus===200){
   check(data.state&&Number.isSafeInteger(data.revision)&&data.state.revision===data.revision,'Native mutation did not return its exact saved state.');
   await p.waitForFunction(()=>!document.querySelector('#editor').open,null,{timeout:15000});
  }
  await retainBrowserSession(p);return data;
 }finally{activeAction=null;}
}
async function submit(key,endpoint,options={}){
 const p=options.p||page;return postAction(key,endpoint,()=>p.locator('#dialog-form button[type="submit"]').click(),options);
}
async function phase(key,title,work){
 if(cp.phases[key]?.status==='PASS')return cp.phases[key].result;
 cp.active_phase={key,title,started_at:new Date().toISOString()};save();
 const result=await work();
 cp.phases[key]={title,status:'PASS',at:new Date().toISOString(),result:smallResult(result)};
 delete cp.active_phase;save();process.stdout.write(JSON.stringify({phase:key,status:'PASS',title})+'\n');return result;
}
async function download(key,perform,{expectedHash,extension,p=page}={}){
 if(cp.downloads[key]&&fs.existsSync(cp.downloads[key].path)){
  const record=cp.downloads[key];check(sha(fs.readFileSync(record.path))===record.sha256,'A retained download changed.',key);return record;
 }
 const incoming=p.waitForEvent('download',{timeout:30000});await perform();const file=await incoming;
 const filename=file.suggestedFilename();
 check(filename===path.basename(filename)&&filename!=='.'&&filename!=='..','The native download filename is unsafe.');
 if(extension)check(filename.toLowerCase().endsWith(extension.toLowerCase()),'The retained filename/extension was lost.',{filename,extension});
 const directory=path.join(output,'downloads',key);fs.mkdirSync(directory,{recursive:true,mode:0o700});
 const target=path.join(directory,filename);await file.saveAs(target);const failure=await file.failure();check(!failure,'Browser download failed.',failure);
 const bytes=fs.readFileSync(target),record={path:target,filename,bytes:bytes.length,sha256:sha(bytes)};
 if(expectedHash)check(record.sha256===expectedHash,'The downloaded bytes differ from the native retained identity.',{key,expectedHash,actual:record.sha256});
 cp.downloads[key]=record;save();return record;
}
async function uploadOriginal(key,{kind,filename,bytes,captured_at,coverage},p=page){
 await tab('intake',p);await clickAction(kind==='document'?'upload-document':'upload',{},p,'#app');
 await formFill('source-kind',kind,p);
 await p.locator('#source-file').setInputFiles({name:filename,mimeType:filename.endsWith('.csv')?'text/csv':filename.endsWith('.json')?'application/json':'text/plain',buffer:bytes});
 await formFill('captured-at',captured_at,p);
 const c=coverage||{};
 for(const [name,value] of Object.entries({'start-date':c.start_date||'','end-date':c.end_date||'','coverage-sessions':JSON.stringify(c.session_ids||[]),'coverage-tenders':JSON.stringify(c.payment_types||[]),'coverage-currencies':JSON.stringify(c.currencies||[]),'coverage-mode':c.data_mode||'event_stream','coverage-system':c.source_system||'','coverage-family':c.report_family||'','coverage-note':c.note||''})){await formFill(name,value,p);}
 await formFill('coverage-complete',c.complete===true,p);await formFill('actor',actor,p);
 return submit(key,'/api/cashiering/upload',{p});
}
function resultId(response,...keys){for(const key of keys){const value=response?.result?.[key];if(typeof value==='string')return value;if(value?.id)return value.id;}if(response?.result?.id)return response.result.id;throw new Error('The actual result does not contain a declared identity: '+keys.join(', '));}
function groupIdentity(group){return canonical([group.kind,group.transaction_id,group.currency]);}
function exactGroup(groups,old){const rows=groups.filter(g=>groupIdentity(g)===groupIdentity(old));check(rows.length===1,'The supplied group identity is not unambiguous.',old);return rows[0];}
async function reviewer(key,id,name){
 await tab('close');await clickAction('signoff',{},page,'#app');
 for(const [field,value] of Object.entries({'reviewer-id':id,'reviewer-name':name,'reviewer-role':'Illustrative two-person control exercise','reviewer-statement':'I reviewed the retained operator-declared example balances, original source coverage, explicit allocations and exception dispositions for this exact edition. This is a local workflow exercise, not an agency staff attestation.','reviewer-note':'Separate named example review; no agency identity, deposit or payment is asserted.'}))await formFill(field,value);
 return submit(key,'/api/cashiering/signoff');
}
async function cleanup(){
 if(cleaning)return cleaning;
 cleaning=(async()=>{
  const errors=[];
  if(browser){try{await browser.close();}catch(e){errors.push(e.message);}browser=null;context=null;page=null;second=null;}
  try{await stopServer();}catch(e){errors.push(e.message);}
  serverLog.end();
  if(errors.length)throw new Error('Owned cleanup: '+errors.join('; '));
 })();return cleaning;
}



for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{
 cp.interruption={signal,at:new Date().toISOString(),phase:cp.active_phase};attempt.status='INTERRUPTED';save();
 cleanup().then(()=>process.exit(signal==='SIGINT'?130:143),error=>{attempt.cleanup_error=error.message;save();process.exit(1);});
});



function pythonJSON(script,input){
 const result=spawnSync(python,['-B','-c',script],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:16*1024*1024,cwd:source,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
 check(result.status===0,'A bounded artifact inspection failed.',{status:result.status,error:result.stderr});
 return JSON.parse(result.stdout);
}
async function mappingForm(captureId,mapping,note){
 await tab('intake');await clickAction('capture',{id:captureId},page,'#app');await clickAction('mapping',{id:captureId},page,'#editor');
 for(const field of (await financialState()).catalog.fields){
  const saved=mapping.fields?.[field.key];
  const mode=saved&&Object.hasOwn(saved,'column')?'column':saved&&Object.hasOwn(saved,'literal')?'literal':'unmapped';
  await formFill('mapping-mode:'+field.key,mode);
  await formFill('mapping-value:'+field.key,mode==='unmapped'?'':saved[mode]);
 }
 for(const [name,value] of Object.entries({'amount-mode':mapping.amount_mode,'amount-sign':mapping.amount_sign,'date-format':mapping.date_format,'net-mode':mapping.net_mode,'event-signs':JSON.stringify(mapping.event_signs||{}),'event-map':JSON.stringify(mapping.event_map||{}),'status-map':JSON.stringify(mapping.status_map||{}),'mapping-note':note}))await formFill(name,value);
 await formFill('mapping-confirmed',true);await formFill('actor',actor);
}
async function refreshUI(p=page){await closeDialog(p);await clickAction('refresh',{},p,'#app');}
async function inspectCurrentScope(){
 const d=await detail();check(d.run.id===cp.bindings.run_id,'The current view points to another run.');
 check(d.run.settings.balance_payment_types!==undefined,'Declared tender applicability is missing.');
 return d;
}
async function executeWorkflow(){
 await startServer({database:cp.phases['30-restored-reopen']?.status==='PASS'?cp.bindings.receiving_database:db});
 browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
 context=await browser.newContext({viewport:{width:1440,height:1080},acceptDownloads:true});
 page=await newPage();
 await phase('01-original-foundation','Open the accepted original database and both product arms',async()=>{
  const state=await financialState();
  check(state.runs.some(r=>r.id===native.run_id),'The original accepted financial run is missing.');
  const baseline=await detail(native.run_id),originalCase=await api(page,'/api/runs/'+uri(native.original_case_run_id));
  cp.baseline=baseline;cp.original_case_sha256=sha(Buffer.from(canonical(originalCase)));cp.original_case=originalCase;
  cp.bindings.original_run_id=native.run_id;cp.bindings.original_packet_id=native.handoff.packet_id;save();
  await selectRun(native.run_id);
  check(await page.locator('a[href="/"]').first().textContent()==='Permit workspace','The existing permitting entrypoint is missing.');
  return {database:db,financial_run_id:native.run_id,original_case_run_id:native.original_case_run_id,revision:state.revision};
 });
 await phase('02-source-contract','Inspect source authority, incomplete source binaries and exact scope',async()=>{
  await tab('settings');await clickAction('source-catalog',{},page,'#app');
  const catalog=(await financialState()).catalog.source_catalog;
  check(Array.isArray(catalog.requirements)&&catalog.requirements.length===13,'The original financial source catalog is incomplete.');
  const normalize=value=>String(value).replace(/\s+/g,' ').trim();const text=normalize(await page.locator('#main').innerText());
  for(const requirement of catalog.requirements)check(text.includes(normalize(requirement.title))&&text.includes(normalize(requirement.source_meaning)),'An original source requirement is not visible.',requirement.id);
  check(text.includes('source')||text.includes('Source'),'The source state is missing.');
  await tab('overview');await selectRun(native.run_id);
  return {requirements:catalog.requirements.length,source_ids:catalog.sources.map(s=>s.id)};
 });
 await phase('03-original-inspection','Read all four original source roles and retained fields',async()=>{
  const manifest=cp.baseline.manifest;check(['permits','receivables','processor','cashier'].every(kind=>manifest.some(x=>x.kind===kind)),'The accepted baseline does not contain all four source roles.');
  const captures={};
  await tab('intake');
  for(const entry of manifest){
   const capture=await api(page,'/api/cashiering/captures/'+uri(entry.capture_id));captures[entry.kind]=capture;
   await clickAction('capture',{id:capture.id},page,'#app');
   const text=await page.locator('#editor').innerText();
   for(const header of capture.headers)check(text.includes(header),'An original field is inaccessible in the source inspector.',{capture:capture.id,header});
   await clickAction('capture-preview',{id:capture.id,normalized:'1',offset:'0'},page,'#editor');
   check(await page.locator('#editor').innerText().then(t=>t.includes('Interpreted original rows')),'The normalized source projection is missing.');
   await closeDialog();
  }
  cp.bindings.baseline_captures=captures;save();
  return {capture_ids:Object.values(captures).map(c=>c.id),rows:Object.fromEntries(Object.entries(captures).map(([k,v])=>[k,v.rows]))};
 });
 await phase('04-original-download','Download the exact corrected cashier original with its native filename',async()=>{
  const capture=cp.bindings.baseline_captures.cashier;
  await tab('intake');await clickAction('capture',{id:capture.id},page,'#app');
  const file=await download('original-cashier',()=>action('capture-download',{id:capture.id},page,'#editor').click(),{expectedHash:capture.sha256,extension:'.csv'});
  await closeDialog();return file;
 });
 await phase('05-exact-recapture','Retain a new acquisition of identical bytes without double counting',async()=>{
  const capture=cp.bindings.baseline_captures.cashier,before=await financialState();
  const response=await uploadOriginal('exact-cashier-recapture',{kind:'cashier',filename:capture.filename,bytes:fs.readFileSync(cp.downloads['original-cashier'].path),captured_at:new Date().toISOString(),coverage:capture.coverage});
  check(response.result.duplicate===true&&response.result.capture.id===capture.id,'Identical original scope was counted as a second financial capture.');
  check(response.state.captures.length===before.captures.length,'Recapture created an extra source population.');
  return {capture_id:capture.id,duplicate:true,original_sha256:capture.sha256};
 });
 await phase('06-explicit-exercise-source','Retain a labeled mapping exercise without editing the accepted original',async()=>{
  const capture=cp.bindings.baseline_captures.cashier;
  const transformed=pythonJSON(
   "import sys,json,csv,io,base64,hashlib\np=json.load(sys.stdin)\ns=base64.b64decode(p['raw']).decode('utf-8-sig')\nrows=list(csv.reader(io.StringIO(s,newline='')))\nassert rows and 'operator_context' not in rows[0]\nwidth=len(rows[0]); assert all(len(r)==width for r in rows[1:])\nout=io.StringIO(newline='');w=csv.writer(out,lineterminator='\\r\\n');w.writerow(rows[0]+['operator_context'])\nfor r in rows[1:]:w.writerow(r+['Operator-declared UI continuation; original example financial cells unchanged'])\nb=out.getvalue().encode('utf-8')\nprint(json.dumps({'raw':base64.b64encode(b).decode(),'sha256':hashlib.sha256(b).hexdigest(),'rows':len(rows)-1,'original_headers':rows[0]}))",
   {raw:fs.readFileSync(cp.downloads['original-cashier'].path).toString('base64')});
  const filename='illustrative-cashier-ui-source.csv',bytes=Buffer.from(transformed.raw,'base64');
  const inputDir=path.join(output,'inputs');fs.mkdirSync(inputDir,{recursive:true,mode:0o700});fs.writeFileSync(path.join(inputDir,filename),bytes,{mode:0o600});
  const coverage={...capture.coverage,note:(capture.coverage.note||'')+'\nSeparate local UI exercise source. Financial cells are the original declared fixture; the added operator_context column is nonfinancial. No agency transactions are asserted.'};
  const response=await uploadOriginal('exercise-cashier-source',{kind:'cashier',filename,bytes,captured_at:new Date().toISOString(),coverage});
  check(response.result.duplicate===false,'The declared new original source was not retained.');
  const saved=response.result.capture;check(saved.headers.includes('operator_context')&&saved.rows===transformed.rows,'The complete extended original headers/rows were not retained.');
  cp.bindings.exercise_cashier_id=saved.id;cp.bindings.exercise_cashier_sha256=transformed.sha256;save();
  return {capture_id:saved.id,sha256:saved.sha256,original_reference:capture.id,rows:saved.rows};
 });
 await phase('07-stale-editor','Reject a stale mapping save while preserving the complete operator draft',async()=>{
  if(cp.actions['stale-mapping-probe']?.http_status===409)return {http_status:409,retained_request_id:cp.actions['stale-mapping-probe'].request.request_id};
  const capture=cp.bindings.baseline_captures.cashier;
  const note='\nUI continuation: retained source meaning and all original fields. The extra operator_context column is not a financial input.\nOriginal mapping note: '+capture.mapping.note;
  cp.bindings.mapping_draft_note=note;save();
  await mappingForm(cp.bindings.exercise_cashier_id,capture.mapping,note);
  check(await page.locator('[name="mapping-note"]').inputValue()===note,'The initial newline or original mapping text was lost.');
  second=await newPage();
  const bytes=Buffer.from('OPERATOR-DECLARED EXAMPLE SUPPORT\nThis document supports the local two-person close exercise only.\nIt asserts no agency deposit, payment, external transmission, approval or staff identity.\nOriginal source exercise: '+cp.bindings.exercise_cashier_id+'\n','utf8');
  const response=await uploadOriginal('illustrative-deposit-support',{kind:'document',filename:'illustrative-deposit-support.txt',bytes,captured_at:new Date().toISOString(),coverage:{start_date:cp.baseline.run.start_date,end_date:cp.baseline.run.end_date,session_ids:[],payment_types:[],currencies:[],complete:false,note:'Explicit local example supporting text. It is not an actual bank or agency receipt.',data_mode:'event_stream',source_system:'Local operator exercise',report_family:'Illustrative support'}},second);
  cp.bindings.deposit_document_id=response.result.capture.id;save();await second.close();second=null;
  await submit('stale-mapping-probe','/api/cashiering/mapping',{expectedStatus:409});
  check(await page.locator('.dialog-error').innerText().then(t=>t.includes('current')),'The stale revision did not expose a current-state recovery path.');
  check(await page.locator('[name="mapping-note"]').inputValue()===note,'The stale-save response erased the draft mapping note.');
  check(await page.locator('[name="event-map"]').inputValue()===JSON.stringify(capture.mapping.event_map||{}),'The stale-save response erased the explicit original event map.');
  return {http_status:409,request_id:cp.actions['stale-mapping-probe'].request.request_id,supporting_original_id:cp.bindings.deposit_document_id};
 });
 await phase('08-refreshed-mapping','Refresh the exact source edition and save the retained mapping draft',async()=>{
  if(await page.locator('#editor').evaluate(el=>el.open)&&await action('reopen-dialog',{},page,'#editor').count()){
   await clickAction('reopen-dialog',{},page,'#editor');
   check(await page.locator('[name="mapping-note"]').inputValue()===cp.bindings.mapping_draft_note,'Refreshing the stale editor did not retain user-entered text.');
   check(await page.locator('[name="actor"]').inputValue()===actor,'Refreshing the stale editor did not retain the named operator.');
  }else await mappingForm(cp.bindings.exercise_cashier_id,cp.bindings.baseline_captures.cashier.mapping,cp.bindings.mapping_draft_note);
  const response=await submit('exercise-cashier-mapping','/api/cashiering/mapping');
  const capture=await api(page,'/api/cashiering/captures/'+uri(cp.bindings.exercise_cashier_id));
  check(capture.confirmed&&capture.mapping.note===cp.bindings.mapping_draft_note,'The explicit source interpretation did not save as confirmed.');
  const old=await api(page,'/api/cashiering/captures/'+uri(cp.bindings.baseline_captures.cashier.id));
  check(old.mapping_version===cp.bindings.baseline_captures.cashier.mapping_version,'The accepted original mapping was changed by the UI exercise.');
  await clickAction('capture',{id:capture.id},page,'#app');await clickAction('capture-preview',{id:capture.id,normalized:'1',offset:'0'},page,'#editor');
  check(await page.locator('#editor').innerText().then(t=>t.includes('operator_context')),'The full new original field list is not visible.');
  await closeDialog();return {capture_id:capture.id,mapping_version:capture.mapping_version,revision:response.revision};
 });
 await phase('09-prepare-ui-run','Prepare a separate daily run in the original permitting database',async()=>{
  await tab('intake');await clickAction('run-new',{},page,'#app');
  for(const [name,value] of Object.entries({'run-label':'Illustrative operator continuation · '+operation,'run-start':cp.baseline.run.start_date,'run-end':cp.baseline.run.end_date,'run-note':'The same declared native example is operated through the complete browser. This run substitutes only the explicitly mapped cashier exercise source; no agency data or external posting is asserted.','actor':actor}))await formFill(name,value);
  const selected=cp.baseline.manifest.map(row=>row.kind==='cashier'?cp.bindings.exercise_cashier_id:row.capture_id);
  for(const input of await page.locator('#dialog-form input[name="run-captures"]').all())await input.setChecked(selected.includes(await input.getAttribute('value')));
  const response=await submit('prepare-ui-run','/api/cashiering/run');
  const id=response.result.run_id;check(id&&id!==native.run_id,'The separate UI exercise did not receive its own run identity.');
  cp.bindings.run_id=id;save();
  check(response.detail.manifest.length===selected.length&&response.detail.manifest.every(row=>selected.includes(row.capture_id)),'The explicit four-source selection was not retained.');
  await selectRun(id);
  if(canonical(response.detail.run.settings)!==canonical(cp.baseline.run.settings)){
   const declared=cp.baseline.run.settings;await clickAction('run-settings',{},page,'#app');
   for(const [name,value] of Object.entries({'timezone':declared.timezone,'reviewers-required':declared.close_reviewers_required,'required-lanes':JSON.stringify(declared.required_lanes),'currency-scales':JSON.stringify(declared.scales),'balance-tolerance':JSON.stringify(declared.balance_tolerance_minor),'cashier-payment-types':JSON.stringify(declared.balance_payment_types?.cashier??null),'processor-payment-types':JSON.stringify(declared.balance_payment_types?.processor??null),'scope-note':declared.scope_note,'settings-note':'Use the exact native fixture operating scope for this separately labeled UI run. No global setting or accepted baseline is changed.','actor':actor}))await formFill(name,value);
   await submit('declared-ui-run-scope','/api/cashiering/run-settings');
  }
  return {run_id:id,captures:selected,original_run_id:native.run_id};
 });
 await selectRun(cp.bindings.run_id);
 await phase('10-explicit-allocation','Apply the original five deliberate partial and many-to-many allocations',async()=>{
  const baseline=cp.baseline,groups=baseline.groups,templates=baseline.allocations.filter(a=>a.active);
  check(templates.length===5,'The retained declared fixture must supply its exact five allocations.',templates.length);
  await tab('reconciliation');cp.bindings.allocations=cp.bindings.allocations||[];
  for(let i=0;i<templates.length;i++){
   const template=templates[i],key='allocate-'+i;
   if(cp.actions[key]?.response){if(!cp.bindings.allocations.includes(cp.actions[key].response.result.id))cp.bindings.allocations.push(cp.actions[key].response.result.id);continue;}
   const d=await detail(),oldSource=groups.find(g=>g.id===template.source_group_id),oldTarget=groups.find(g=>g.id===template.target_group_id);
   check(oldSource&&oldTarget,'An accepted allocation lost its original group binding.');
   const from=exactGroup(d.groups,oldSource),to=exactGroup(d.groups,oldTarget);
   await clickAction('allocate',{},page,'#app');
   for(const [name,value] of Object.entries({'source-group':from.id,'target-group':to.id,'allocation-amount':template.amount_minor,'actor':actor,'note':'Deliberate UI continuation of the native declared allocation '+template.id+'. The amount and original transaction/currency identities are preserved.'}))await formFill(name,value);
   const response=await submit(key,'/api/cashiering/allocate');cp.bindings.allocations.push(response.result.id);save();
  }
  const d=await detail();
  check(d.allocations.filter(a=>a.active).length===5,'The UI did not retain exactly the five intended active allocations.');
  check(d.groups.filter(g=>['permits','receivables'].includes(g.kind)&&g.net_minor!==null).every(g=>g.remaining_minor==='0'),'An intended financial remainder remains after the declared allocations.',d.groups);
  return {allocation_ids:cp.bindings.allocations,currencies:Object.keys(d.totals)};
 });



 await phase('11-source-correction','Correct one interpreted amount against its exact retained original',async()=>{
  const d=await detail(),row=d.rows.cashier.find(r=>r.currency==='EUR'&&r.net_minor==='310');
  check(row,'The exact declared EUR 3.10 cashier observation is missing.');
  cp.bindings.corrected_record_key=row.record_key;cp.bindings.before_correction=JSON.parse(JSON.stringify(row));save();
  await tab('reconciliation');await page.locator('#transaction-lane').selectOption('cashier');await page.locator('#transaction-query').fill(row.record_key);
  await page.locator('#transaction-filter button[type="submit"]').click();await settle();
  await clickAction('transaction',{'record-key':row.record_key},page,'#app');
  for(const field of ['amount_minor','net_minor']){await formFill('apply:'+field,true);await formFill('change:'+field,'311');}
  await formFill('actor',actor);await formFill('note','Deliberate one-minor-unit interpretation exercise. Original cashier cells remain retained and this correction will be retired in the next explicit step.');
  const response=await submit('interpretation-one-unit','/api/cashiering/correct');cp.bindings.correction_id=response.result.id;save();
  const after=response.detail.rows.cashier.find(r=>r.record_key===row.record_key);
  check(after.net_minor==='311'&&canonical(after.original)===canonical(row.original),'The correction changed the original evidence or lost the exact intended minor amount.');
  check(response.detail.balances.some(b=>b.currency==='EUR'&&b.cashier_difference_minor==='1'),'The actual one-minor-unit balancing difference was not exposed.');
  return {correction_id:response.result.id,record_key:row.record_key,original_net_minor:'310',interpreted_net_minor:'311'};
 });
 await phase('12-correction-retirement','Retire the exercise correction while retaining its before and after history',async()=>{
  await tab('reconciliation');await clickAction('correction-retire',{id:cp.bindings.correction_id},page,'#app');
  await formFill('actor',actor);await formFill('note','Retire the deliberate UI exercise correction. The complete retained corrected original remains the accounting observation.');
  const response=await submit('retire-one-unit','/api/cashiering/correction-retire');
  const row=response.detail.rows.cashier.find(r=>r.record_key===cp.bindings.corrected_record_key);
  check(row.net_minor==='310'&&response.detail.corrections.some(c=>c.id===cp.bindings.correction_id&&c.active===false),'Correction retirement did not preserve the original observation and history.');
  return {correction_id:cp.bindings.correction_id,net_minor:row.net_minor,active:false};
 });
 await phase('13-source-bound-dispositions','Review only the retained declared fixture exceptions',async()=>{
  const allowedCodes=new Set(cp.baseline.findings.filter(f=>f.review?.status==='accepted_exception').map(f=>f.code));
  await tab('findings');
  let d=await detail();const reviewed=[];
  for(const finding of d.findings){
   if(finding.review?.status==='accepted_exception')continue;
   check(finding.waivable===true&&allowedCodes.has(finding.code),'The UI exercise has a new or nonwaivable finding requiring source investigation.',finding);
   const key='finding-'+finding.id;if(cp.actions[key]?.response){reviewed.push(finding.id);continue;}
   await clickAction('finding',{id:finding.id},page,'#app');
   await formFill('review-status','accepted_exception');await formFill('actor',actor);
   const old=cp.baseline.findings.find(f=>f.code===finding.code&&f.review?.status==='accepted_exception');
   await formFill('note','Explicit review of the same operator-declared example condition. '+old.review.note+' This remains an accepted exception, not a change to native arithmetic or a customer approval.');
   await submit(key,'/api/cashiering/review');reviewed.push(finding.id);
  }
  d=await detail();check(d.counts.unaccepted_findings===0,'Unaccepted source-bound findings remain before the two-person close.',d.findings);
  return {reviewed_finding_ids:reviewed,native_unaccepted_findings:d.counts.unaccepted_findings};
 });
 await phase('14-first-review','Retain the first named review of this exact financial edition',async()=>{
  const response=await reviewer('first-staff-review','LOCAL-REVIEWER-01','Illustrative cashier reviewer 01');
  cp.bindings.first_review_id=response.result.id;save();return {review_id:response.result.id,edit_revision:response.result.edit_revision,snapshot_hash:response.result.snapshot_hash};
 });
 await phase('15-second-review','Retain an independent second named review of the same edition',async()=>{
  const response=await reviewer('second-staff-review','LOCAL-REVIEWER-02','Illustrative supervisor reviewer 02');
  const d=response.detail,rows=d.signoffs.filter(s=>s.current);
  check(rows.length===2&&new Set(rows.map(s=>s.reviewer_id.toLowerCase())).size===2,'The second distinct staff review was not retained.');
  check(new Set(rows.map(s=>s.snapshot_hash)).size===1,'The two staff reviews do not bind the same financial snapshot.');
  cp.bindings.second_review_id=response.result.id;save();return {review_id:response.result.id,reviewers:rows.map(s=>s.reviewer_id),snapshot_hash:rows[0].snapshot_hash};
 });
 await phase('16-reviewed-close','Close the daily exercise with its actual two-review record and retained supporting original',async()=>{
  await tab('close');await clickAction('close-run',{},page,'#app');
  await page.locator('#dialog-form input[name="deposit-documents"][value='+JSON.stringify(cp.bindings.deposit_document_id)+']').check();
  await formFill('actor',actor);await formFill('note','Local operator-declared close exercise. Both named example reviews bind the same retained financial edition; no agency deposit or identity is asserted.');
  const response=await submit('daily-close','/api/cashiering/close');cp.bindings.closing_id=response.result.id;save();
  check(response.detail.closing?.current===true&&response.detail.closing.id===response.result.id,'The exact reviewed daily close did not become current.');
  check(response.result.signoffs.length===2,'The retained close lost a reviewer.');
  return {closing_id:response.result.id,signoff_ids:response.result.signoffs.map(s=>s.id),documents:response.result.deposit_document_ids};
 });
 await phase('17-receiving-layout-response','Save an explicit layout and retain a deliberately lost committed response',async()=>{
  if(cp.actions['receiving-profile']?.request){
   const retained=cp.actions['receiving-profile'],response=await recoverAction('receiving-profile');
   check(response?.result?.id&&response.result.columns?.length===6,'The original interrupted layout did not resolve to its exact committed result.');
   cp.bindings.profile_id=response.result.id;cp.bindings.profile_version=response.result.version;save();
   check(await action('reconcile-pending',{},page,'#app').count()===1,'The original pending tab metadata was not restored for the actual UI recovery.');
   return {profile_id:response.result.id,version:response.result.version,request_id:retained.request.request_id,dropped_after_commit:Boolean(retained.dropped_response),resumed_from_original_request:true};
  }
  await tab('interfaces');await clickAction('profile-new',{},page,'#app');
  for(const [name,value] of Object.entries({'profile-name':'Illustrative CSV receiving layout · '+operation,'profile-scope':'balances','profile-lane':'permits','profile-delimiter':',','profile-line-ending':'CRLF','profile-header':true,'profile-note':'Explicit local receiving contract for this operator exercise. It is not a Munis, Clariti or agency production layout. Ordered date, session, tender, currency, major amount and supplied account-code literal are retained.','actor':actor}))await formFill(name,value);
  const columns=[
   {header:'business_date',field:'business_date',format:'text'},
   {header:'session',field:'session_id',format:'text'},
   {header:'tender',field:'payment_type',format:'text'},
   {header:'currency',field:'currency',format:'text'},
   {header:'expected_major',field:'expected_minor',format:'major'},
   {header:'account_code',literal:'00123',format:'text'}
  ];
  for(let i=0;i<columns.length;i++){
   if(i)await clickAction('profile-column-add',{},page,'#editor');
   const c=columns[i];
   await formFill('column-header:'+i,c.header);await formFill('column-mode:'+i,Object.hasOwn(c,'literal')?'literal':'field');
   await formFill('column-value:'+i,c.literal??c.field);await formFill('column-format:'+i,c.format);
  }
  const response=await submit('receiving-profile','/api/cashiering/profile',{dropResponse:true});
  check(response.result.columns.length===6,'The actual committed layout is incomplete.');
  cp.bindings.profile_id=response.result.id;cp.bindings.profile_version=response.result.version;save();
  check(cp.actions['receiving-profile'].requests.length===1,'More than one layout POST was sent before recovery.');
  check(await action('reconcile-pending',{},page,'#app').count()===1,'The uncertain-save recovery affordance is missing.');
  return {profile_id:response.result.id,version:response.result.version,request_id:cp.actions['receiving-profile'].request.request_id,dropped_after_commit:true};
 });
 await phase('18-current-state-recovery','Recover the original committed request after another legitimate writer advances state',async()=>{
  second=await newPage();
  const layoutSource=Buffer.from('LOCAL RECEIVING LAYOUT · OPERATOR EXERCISE\nNot a vendor or agency production format.\nColumns: business_date, session, tender, currency, expected_major, account_code.\nUTF-8 CSV, comma, CRLF, header present. account_code is the exact supplied text 00123.\nMajor amounts use the declared native currency scales. Null source observations remain blank.\nNo external transmission, acceptance, posting, contract or customer approval is asserted by this definition.\n','utf8');
  const response=await uploadOriginal('receiving-layout-source',{kind:'document',filename:'illustrative-receiving-layout.txt',bytes:layoutSource,captured_at:new Date().toISOString(),coverage:{start_date:cp.baseline.run.start_date,end_date:cp.baseline.run.end_date,session_ids:[],payment_types:[],currencies:[],complete:false,note:'Actual authored local parser contract for this clearly labeled example.',data_mode:'event_stream',source_system:'Local receiving parser',report_family:'Explicit supplied layout'}},second);
  cp.bindings.layout_document_id=response.result.capture.id;cp.bindings.state_after_other_writer=response.revision;save();
  await second.close();second=null;
  await closeDialog();
  if(await action('reconcile-pending',{},page,'#app').count())await clickAction('reconcile-pending',{},page,'#app');
  else await refreshUI();
  check(await action('reconcile-pending',{},page,'#app').count()===0,'The original request was not reconciled.');
  const actual=await financialState(),entry=cp.actions['receiving-profile'];
  const recovered=await api(page,'/api/cashiering/requests/'+uri(entry.request.request_id));
  check(recovered.found&&recovered.response.result.id===cp.bindings.profile_id,'Original-request recovery did not return the exact committed layout.');
  check(actual.revision===response.revision&&actual.revision>recovered.response.revision,'The current workspace revision was replaced by the older saved response.');
  const displayed=await page.locator('.topmeta strong').textContent();check(displayed===String(actual.revision),'The browser shows an old workspace revision after recovery.',{displayed,current:actual.revision});
  check(actual.captures.some(c=>c.id===cp.bindings.layout_document_id),'The other writer’s original source was lost from current state.');
  check(actual.profiles.filter(p=>p.id===cp.bindings.profile_id&&p.version===cp.bindings.profile_version).length===1&&entry.requests.length===1,'The uncertain-save recovery duplicated the layout.');
  entry.response=recovered.response;entry.recovered_through_ui_at=new Date().toISOString();save();await retainBrowserSession(page);
  return {request_id:entry.request.request_id,post_count:entry.requests.length,original_result_revision:recovered.response.revision,current_revision:actual.revision,source_id:cp.bindings.layout_document_id};
 });
 await phase('19-prepare-interface','Review the exact layout edition and prepare its immutable file',async()=>{
  await selectRun(cp.bindings.run_id);await tab('interfaces');await clickAction('interface-prepare',{},page,'#app');
  await formFill('export-profile',encodeURIComponent(cp.bindings.profile_id)+'@'+cp.bindings.profile_version);
  check(await page.locator('#selected-profile-review').innerText().then(t=>t.includes('00123')),'The exact account-code literal is not visible for review.');
  await formFill('export-label','Local CSV receiving exercise · current reviewed close');
  await formFill('layout-reviewed',true);await formFill('actor',actor);
  await formFill('note','Prepared against the explicitly reviewed local example layout. No transmission or posting is implied.');
  const response=await submit('prepare-interface','/api/cashiering/interface-prepare');
  cp.bindings.export_id=response.result.id;cp.bindings.export_artifact_id=response.result.artifact_id;cp.bindings.export_sha256=response.result.sha256;save();
  check(response.result.status==='prepared'&&response.result.receipts.length===0,'File preparation created an unsupported receiving or posting observation.');
  check(response.result.profile.version===cp.bindings.profile_version,'Preparation silently changed the reviewed layout edition.');
  return {export_id:response.result.id,artifact_id:response.result.artifact_id,sha256:response.result.sha256,rows:response.result.row_count,status:response.result.status};
 });
 await phase('20-exact-interface-download','Download and actually read the native CSV with its original identity',async()=>{
  await tab('interfaces');await clickAction('interface-export',{id:cp.bindings.export_id},page,'#app');
  const file=await download('prepared-interface',()=>action('artifact-download',{id:cp.bindings.export_artifact_id},page,'#editor').click(),{expectedHash:cp.bindings.export_sha256,extension:'.csv'});
  await closeDialog();
  const observed=pythonJSON(
   "import sys,json,csv,io,base64,hashlib,datetime\np=json.load(sys.stdin); b=base64.b64decode(p['raw']); rows=list(csv.reader(io.StringIO(b.decode('utf-8'),newline='')))\nexpected=['business_date','session','tender','currency','expected_major','account_code']\nassert rows and rows[0]==expected\nassert all(len(r)==6 and r[5]=='00123' for r in rows[1:])\nassert b.count(b'\\n')==b.count(b'\\r\\n')\nprint(json.dumps({'schema':'berkeley.local-receiving-observation.v1','basis':'Actual local CSV parser read of the clearly labeled operator exercise; no agency receipt or production posting','status':'accepted','observed_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'row_count':len(rows)-1,'headers':rows[0],'literal_account_codes':sorted(set(r[5] for r in rows[1:])),'currency_values':sorted(set(r[3] for r in rows[1:])),'rows':rows[1:]}))",
   {raw:fs.readFileSync(file.path).toString('base64')});
  const prepared=(await detail()).interface_exports.find(x=>x.id===cp.bindings.export_id);
  check(observed.row_count===prepared.row_count,'The actual receiving parser did not observe every prepared row.');
  cp.bindings.local_parser_observation=observed;save();return {file,parser:observed};
 });
 await phase('21-retain-receiving-original','Retain the actual local parser observation as an original document',async()=>{
  const observation=cp.bindings.local_parser_observation;
  const response=await uploadOriginal('local-parser-receipt-document',{kind:'document',filename:'actual-local-csv-receiving-observation.json',bytes:Buffer.from(JSON.stringify({...observation,export_id:cp.bindings.export_id,artifact_id:cp.bindings.export_artifact_id,profile_id:cp.bindings.profile_id,profile_version:cp.bindings.profile_version},null,2)+'\n'),captured_at:observation.observed_at,coverage:{start_date:cp.baseline.run.start_date,end_date:cp.baseline.run.end_date,session_ids:[],payment_types:[],currencies:observation.currency_values,complete:false,note:'Actual local parser output for the declared UI exercise only. It is not an agency system acceptance or payment.',data_mode:'event_stream',source_system:'Local CSV receiving parser',report_family:'Exact original parser observation'}});
  cp.bindings.receipt_document_id=response.result.capture.id;save();return {document_id:response.result.capture.id,sha256:response.result.capture.sha256};
 });
 await phase('22-actual-receiving-observation','Link the actual parser receipt to this exact prepared file',async()=>{
  await selectRun(cp.bindings.run_id);await tab('interfaces');await clickAction('interface-export',{id:cp.bindings.export_id},page,'#app');
  await clickAction('interface-receipt',{id:cp.bindings.export_id},page,'#editor');
  for(const [name,value] of Object.entries({'receipt-status':'accepted','receipt-at':cp.bindings.local_parser_observation.observed_at,'receipt-reference':'LOCAL-CSV-RECEIVING-'+cp.bindings.export_id,'receipt-document':cp.bindings.receipt_document_id,'actor':actor,'note':'Actual local CSV parser acceptance of this exact prepared SHA and supplied six-column layout. No agency transmission, receiving, posting or money movement is asserted.'}))await formFill(name,value);
  const response=await submit('link-local-parser-receipt','/api/cashiering/interface-receipt');cp.bindings.receipt_id=response.result.id;save();
  const current=response.detail.interface_exports.find(x=>x.id===cp.bindings.export_id);
  check(current.receipts.length===1&&current.receipts[0].document_id===cp.bindings.receipt_document_id&&current.receipts[0].artifact_id===cp.bindings.export_artifact_id,'The actual receiving observation lost its exact file/document binding.');
  check(!current.receipts.some(r=>r.status==='posted'),'The local receipt was promoted to a production posting.');
  return {receipt_id:response.result.id,status:response.result.status,document_id:response.result.document_id,artifact_id:response.result.artifact_id};
 });



 await phase('23-complete-packet','Prepare the current complete financial packet without replacing prior packets',async()=>{
  await tab('handoff');await clickAction('packet-prepare',{},page,'#app');
  await formFill('packet-label','Complete current UI exercise handoff · '+operation);await formFill('actor',actor);
  await formFill('note','Freeze the full reviewed example, exact originals, named decisions, actual local parser receipt and runnable original plus cashiering source. This is internal product acceptance material, not a customer accounting record.');
  const response=await submit('final-current-packet','/api/cashiering/packet');cp.bindings.packet=response.result;save();
  check(response.result.manifest.source_files_included===true,'The complete runnable implementation was omitted from the packet.');
  check(response.detail.closing?.current===true&&response.detail.closing.id===cp.bindings.closing_id,'Packet preparation changed the reviewed financial close.');
  return {packet_id:response.result.id,artifact_id:response.result.artifact_id,sha256:response.result.sha256,bytes:response.result.bytes};
 });
 await phase('24-packet-bytes','Download and inspect every original packet member against its native manifest',async()=>{
  const packet=cp.bindings.packet;
  await tab('handoff');await clickAction('packet',{id:packet.id},page,'#app');
  const file=await download('current-packet',()=>action('artifact-download',{id:packet.artifact_id},page,'#editor').click(),{expectedHash:packet.sha256,extension:'.zip'});
  await closeDialog();
  const inspected=pythonJSON(
   "import sys,json,zipfile,hashlib,pathlib\np=json.load(sys.stdin)\nwith zipfile.ZipFile(p['path']) as z:\n names=z.namelist(); assert len(names)==len(set(names)); assert all(not n.startswith('/') and '..' not in pathlib.PurePosixPath(n).parts for n in names)\n manifest=json.loads(z.read('manifest.json')); assert len(names)==manifest['member_count_including_manifest']\n for m in manifest['members']:\n  b=z.read(m['path']); assert len(b)==m['bytes'] and hashlib.sha256(b).hexdigest()==m['sha256'],m['path']\n expected=['transactions.csv','groups.csv','allocations.csv','findings.csv','balances.csv','totals.csv','corrections.csv','signoffs.csv','closings.csv','interface-exports.csv']\n assert all(n in names for n in expected)\n for n in ['report.html','run.json','source-manifest.json','originals.json','documents.json','history.json','source/workspace/app.py','source/workspace/public/app.mjs','source/cashiering/engine.py','source/cashiering/public/index.html','source/cashiering/public/app.mjs','source/cashiering/public/style.css']:\n  assert n in names,n\n assert hashlib.sha256(z.read('source/cashiering/public/app.mjs')).hexdigest()==p['app_sha256']\n run=json.loads(z.read('run.json')); assert run['run']['id']==p['run_id']; assert run['closing']['id']==p['closing_id']\n result={'members':len(names),'full_ledger_files':expected,'manifest_members_verified':len(manifest['members']),'source_file_count':manifest['source_file_count'],'originals':len(manifest['originals']),'documents':len(manifest['documents']),'run_id':run['run']['id'],'closing_id':run['closing']['id'],'native_snapshot_hash':run['snapshot_hash'],'names':names}\n print(json.dumps(result))",
   {path:file.path,app_sha256:currentSource['cashiering/public/app.mjs'].sha256,run_id:cp.bindings.run_id,closing_id:cp.bindings.closing_id});
  cp.bindings.packet_inspection=inspected;save();return {download:file,inspection:inspected};
 });
 await phase('25-current-and-original-editions','Inspect current JSON and retained prior financial editions',async()=>{
  await tab('handoff');
  const current=await download('current-run-json',()=>action('run-json',{},page,'#app').click(),{extension:'.json'});
  const currentDetail=readJSON(current.path);check(currentDetail.run.id===cp.bindings.run_id&&currentDetail.closing.id===cp.bindings.closing_id,'Current JSON lost the current close.');
  const editions=await api(page,'/api/cashiering/runs/'+uri(cp.bindings.run_id)+'/editions?offset=0&limit=50');
  const original=editions.rows.find(row=>row.edit_revision<currentDetail.run.edit_revision);check(original,'A retained earlier financial edition is missing.');
  await clickAction('edition',{id:original.id},page,'#app');
  check(await page.locator('#editor').innerText().then(t=>t.includes('retained prior edition')),'The prior edition is not labeled as historical.');
  const historical=await download('original-edition-json',()=>action('edition-download',{id:original.id},page,'#editor').click(),{extension:'.json'});
  const old=readJSON(historical.path);check(old.run.edit_revision===original.edit_revision&&old.snapshot_hash===original.snapshot_hash,'The downloaded historical edition is not the selected exact snapshot.');
  await closeDialog();cp.bindings.inspected_original_edition_id=original.id;save();
  return {current_file:current,historical_file:historical,original_edition_id:original.id};
 });
 await phase('26-prior-accepted-work','Verify the original comparator, accepted native mapping, close and prior packet remain retained',async()=>{
  const originalCase=await api(page,'/api/runs/'+uri(native.original_case_run_id));
  check(sha(Buffer.from(canonical(originalCase)))===cp.original_case_sha256,'The existing permitting comparator changed during the financial UI continuation.');
  const baseline=await detail(native.run_id);
  check(baseline.run.edit_revision===cp.baseline.run.edit_revision&&baseline.closing?.id===cp.baseline.closing?.id,'The original accepted financial edition or close was changed.');
  for(const [kind,old] of Object.entries(cp.bindings.baseline_captures)){
   const sourceCapture=await api(page,'/api/cashiering/captures/'+uri(old.id));
   check(sourceCapture.sha256===old.sha256&&sourceCapture.mapping_version===old.mapping_version,'The accepted original source or mapping changed.',kind);
  }
  await selectRun(native.run_id);await tab('handoff');await clickAction('packet',{id:native.handoff.packet_id},page,'#app');
  const oldPacket=await api(page,'/api/cashiering/packets/'+uri(native.handoff.packet_id));
  const file=await download('accepted-prior-packet',()=>action('artifact-download',{id:oldPacket.artifact_id},page,'#editor').click(),{expectedHash:oldPacket.sha256,extension:'.zip'});
  await closeDialog();await selectRun(cp.bindings.run_id);
  return {original_case_run_id:native.original_case_run_id,original_case_sha256:cp.original_case_sha256,accepted_run_id:native.run_id,accepted_closing_id:baseline.closing?.id,prior_packet:file};
 });
 await phase('27-readable-report','Inspect the actual generated financial report in its sandboxed preview',async()=>{
  await tab('handoff');await clickAction('run-report',{},page,'#app');
  const frame=page.frameLocator('#editor iframe');
  await frame.locator('body').waitFor();
  const text=await frame.locator('body').innerText();
  check(text.includes(cp.bindings.run_id)||text.includes(operation),'The generated report is not for the selected retained exercise.');
  check(text.includes('USD')&&text.includes('EUR'),'The report omitted the separate original currencies.');
  check(await page.locator('#editor iframe').getAttribute('sandbox')==='','The generated report preview has unexpected execution privileges.');
  await page.screenshot({path:path.join(output,'desktop-report.png'),fullPage:false});
  await closeDialog();return {run_id:cp.bindings.run_id,currencies:['USD','EUR'],sandbox:'',screenshot:'desktop-report.png'};
 });
 await phase('28-responsive-keyboard','Use every operator view on a narrow screen with keyboard-accessible dialogs',async()=>{
  const viewports=[];
  await page.setViewportSize({width:390,height:844});
  for(const name of ['overview','intake','reconciliation','findings','close','interfaces','handoff','settings']){
   await tab(name);
   const shape=await page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
   check(shape.document<=shape.viewport&&shape.body<=shape.viewport,'The operator view overflows the narrow viewport.',{tab:name,...shape});
   viewports.push({tab:name,...shape});
  }
  await tab('interfaces');await clickAction('profile-new',{},page,'#app');
  const focused=await page.evaluate(()=>document.querySelector('#editor').contains(document.activeElement));
  check(focused,'The editor did not receive keyboard focus.');
  await page.keyboard.press('Tab');check(await page.evaluate(()=>document.querySelector('#editor').contains(document.activeElement)),'Keyboard focus escaped the modal editor.');
  await page.keyboard.press('Escape');check(!(await page.locator('#editor').evaluate(el=>el.open)),'Escape did not close the unsaved editor.');
  await tab('close');await page.screenshot({path:path.join(output,'mobile-close.png'),fullPage:true});
  await page.setViewportSize({width:1440,height:1080});await tab('overview');await page.screenshot({path:path.join(output,'desktop-position.png'),fullPage:true});
  check(browserErrors.length===0,'Uncaught browser errors occurred.',browserErrors);
  return {viewports,keyboard_focus:true,escape:true,page_errors:browserErrors.length,screenshots:['mobile-close.png','desktop-position.png']};
 });
 await phase('29-current-backup','Download the original complete SQLite workspace backup after all current edits',async()=>{
  await tab('handoff');
  const backup=await download('complete-workspace-backup',()=>action('backup',{},page,'#app').click(),{extension:'.sqlite'});
  const facts=pythonJSON(
   "import sys,json,sqlite3,pathlib\np=json.load(sys.stdin)\nwith sqlite3.connect('file:'+str(pathlib.Path(p['path']).resolve())+'?mode=ro',uri=True) as c:\n assert c.execute('pragma quick_check').fetchone()[0]=='ok'\n tables=[r[0] for r in c.execute(\"select name from sqlite_master where type='table'\")]\n assert 'runs' in tables and 'cash_runs' in tables and 'cash_captures' in tables\n assert c.execute('select count(*) from runs where id=?',(p['case_id'],)).fetchone()[0]==1\n row=c.execute('select body from cash_runs where id=?',(p['run_id'],)).fetchone();assert row\n body=json.loads(row[0]);assert body['current_close_id']==p['closing_id']; assert any(v['id']==p['packet_id'] for v in body['packets'])\n print(json.dumps({'quick_check':'ok','tables':tables,'original_case_present':True,'current_financial_run_present':True,'current_close_id':body['current_close_id'],'packets':len(body['packets'])}))",
   {path:backup.path,case_id:native.original_case_run_id,run_id:cp.bindings.run_id,closing_id:cp.bindings.closing_id,packet_id:cp.bindings.packet.id});
  cp.bindings.final_backup=backup;save();return {backup,readback:facts};
 });
 await phase('30-restored-reopen','Close the original listener and reopen the exact downloaded backup through the original restore entrypoint',async()=>{
  await closeDialog();await settle();
  if(second){await second.close();second=null;}
  await page.close();page=null;await stopServer();
  const target=path.join(output,'receiving-workspace.sqlite');
  if(cp.bindings.receiving_database)check(cp.bindings.receiving_database===target,'A retained receiving path cannot be changed.');
  cp.bindings.receiving_database=target;cp.bindings.receiving_backup_sha256=cp.bindings.final_backup.sha256;save();
  await startServer({database:target,restoreFile:fs.existsSync(target)?null:cp.bindings.final_backup.path});
  page=await newPage();await selectRun(cp.bindings.run_id);
  const restored=await detail(),originalCase=await api(page,'/api/runs/'+uri(native.original_case_run_id));
  check(restored.closing?.current===true&&restored.closing.id===cp.bindings.closing_id,'The restored current close did not survive original backup/reopen.');
  check(restored.packets.some(p=>p.id===cp.bindings.packet.id),'The current immutable packet is missing from the restored workspace.');
  check(sha(Buffer.from(canonical(originalCase)))===cp.original_case_sha256,'The restored original permitting comparator differs.');
  const sourceCapture=await api(page,'/api/cashiering/captures/'+uri(cp.bindings.exercise_cashier_id));
  check(sourceCapture.sha256===cp.bindings.exercise_cashier_sha256&&sourceCapture.confirmed,'The full restored source/mapping identity differs.');
  const outputFile=restored.interface_exports.find(x=>x.id===cp.bindings.export_id);
  check(outputFile?.receipts.some(r=>r.id===cp.bindings.receipt_id&&r.document_id===cp.bindings.receipt_document_id),'The restored exact receiving observation is missing.');
  await tab('handoff');await page.screenshot({path:path.join(output,'restored-workspace.png'),fullPage:true});
  return {receiving_database:target,backup_sha256:cp.bindings.final_backup.sha256,run_id:restored.run.id,closing_id:restored.closing.id,packet_id:cp.bindings.packet.id,original_case_run_id:native.original_case_run_id};
 });
 check(browserErrors.length===0,'Uncaught browser errors occurred in the final retained journey.',browserErrors);
 await cleanup();
 const final={schema:cp.schema,operation,status:'PASS',completed_at:new Date().toISOString(),database_path:db,receiving_database:cp.bindings.receiving_database,native_result_path:nativePath,native_result_sha256:cp.native_result_sha256,
  original_case_run_id:native.original_case_run_id,original_financial_run_id:native.run_id,run_id:cp.bindings.run_id,closing_id:cp.bindings.closing_id,packet:cp.bindings.packet,
  backup:cp.bindings.final_backup,prepared_interface:{id:cp.bindings.export_id,artifact_id:cp.bindings.export_artifact_id,sha256:cp.bindings.export_sha256,receipt_id:cp.bindings.receipt_id,receipt_document_id:cp.bindings.receipt_document_id,basis:'Actual local CSV parser observation of the clearly labeled example, not agency receiving or production posting'},
  source:currentSource,phases:cp.phases,downloads:cp.downloads,request_recovery:{request_id:cp.actions['receiving-profile'].request.request_id,post_count:cp.actions['receiving-profile'].requests.length},page_errors:browserErrors,owned_processes_closed:true};
 attempt.status='PASS';attempt.completed_at=final.completed_at;cp.status='PASS';cp.result_path=path.join(output,'result.json');save();
 fs.writeFileSync(cp.result_path,JSON.stringify(final,null,2)+'\n',{mode:0o600});
 process.stdout.write(JSON.stringify({status:'PASS',phases:Object.keys(cp.phases).length,result_path:cp.result_path,run_id:final.run_id,packet_id:final.packet.id})+'\n');
}
try{await executeWorkflow();}
catch(error){
 attempt.status='STOPPED';attempt.ended_at=new Date().toISOString();attempt.error={message:error.message,details:error.details||null,stack:error.stack};cp.status='STOPPED';save();
 try{await cleanup();}catch(cleanupError){attempt.cleanup_error=cleanupError.message;save();}
 process.stderr.write(JSON.stringify({status:'STOPPED',operation,phase:cp.active_phase,error:attempt.error.message,details:attempt.error.details,checkpoint:checkpointPath})+'\n');
 process.exitCode=1;
}
