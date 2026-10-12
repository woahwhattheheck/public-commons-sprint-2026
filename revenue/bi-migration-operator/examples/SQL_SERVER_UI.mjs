// Continue the completed original SQL/BI operation through the actual local UI.
// Existing Python, Playwright and Chromium only; no SQL Server connection or install.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';

const ROOT=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const args=Object.fromEntries(process.argv.slice(2).map(arg=>{const p=arg.indexOf('=');return[arg.slice(2,p),arg.slice(p+1)];}));
if(!args.operation)throw Error('Use --operation=/private/original-native-operation');
const operation=path.resolve(args.operation),uiRoot=path.join(operation,'ui');
await fs.mkdir(uiRoot,{recursive:true,mode:0o700});
const original=JSON.parse(await fs.readFile(path.join(operation,'JOURNEY.json'),'utf8'));
if(original.status!=='complete'||original.phase!==9)throw Error('Continue the already completed original native journey.');
const statePath=path.join(uiRoot,'UI-STATE.json'),resultPath=path.join(uiRoot,'UI-RESULT.json');
const readJson=async p=>JSON.parse(await fs.readFile(p,'utf8'));
const exists=async p=>fs.stat(p).then(()=>true,()=>false);
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const write=async(p,v)=>{const tmp=p+'.partial';await fs.writeFile(tmp,JSON.stringify(v,null,2)+'\n',{mode:0o600});await fs.rename(tmp,p);};
let state=await exists(statePath)?await readJson(statePath):{schema:'commons-bi-sql-ui-journey/1',
  operation_id:original.operation_id+'-ui',phase:0,started_at:new Date().toISOString(),events:[],downloads:[],views:[]};
if(state.status==='complete'){console.log(JSON.stringify(await readJson(resultPath)));process.exit(0);}
await write(statePath,state);
const event=async(type,detail={})=>{state.events.push({at:new Date().toISOString(),type,...detail});await write(statePath,state);};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const deadline=async(fn,label,ms=30000)=>{const until=Date.now()+ms;let error;while(Date.now()<until){try{const v=await fn();if(v)return v;}catch(e){error=e;}await pause(100);}throw Error(label+(error?': '+error.message:''));};
const playwright=await import(pathToFileURL(args.playwright||process.env.BI_PLAYWRIGHT_MODULE||'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.js').href);
const chromium=args.chromium||process.env.BI_CHROMIUM||'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell';
const python=args.python||process.env.BI_PYTHON||'python';
let browser=null,context=null,page=null,server=null;
const errors=[];
async function closeHost(){
  if(context){await context.close();context=null;page=null;}
  if(server){
    const current=server;server=null;
    if(current.exitCode===null&&current.signalCode===null)current.kill('SIGTERM');
    await Promise.race([new Promise(resolve=>current.once('exit',resolve)),pause(5000)]);
    if(current.exitCode===null&&current.signalCode===null){current.kill('SIGKILL');await new Promise(resolve=>current.once('exit',resolve));}
  }
}
async function startHost(workspace,tag){
  await closeHost();
  let buffer='',ready=null,stderr='';
  server=spawn(python,['-B',path.join(ROOT,'BI_OPERATOR.py'),'--workspace',workspace,'serve','--port','0'],
    {cwd:ROOT,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},stdio:['ignore','pipe','pipe']});
  server.stdout.on('data',chunk=>{buffer+=chunk.toString();const lines=buffer.split('\n');buffer=lines.pop();
    for(const line of lines){try{const row=JSON.parse(line);if(row.url)ready=row;}catch{/* Server banner is not application evidence. */}}});
  server.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  server.on('error',error=>{stderr+=error.message;});
  await deadline(()=>{if(server.exitCode!==null)throw Error('Original host ended: '+stderr.slice(-1000));return ready;},'Original local host did not become ready');
  await write(path.join(uiRoot,tag+'-private-host.json'),{...ready,pid:server.pid});
  context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});
  page=await context.newPage();
  page.on('pageerror',e=>errors.push({tag,type:'pageerror',message:e.message}));
  page.on('console',m=>{if(m.type()==='error')errors.push({tag,type:'console',message:m.text()});});
  await page.goto(ready.url,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>document.querySelector('#connection')?.textContent==='Workspace connected',{timeout:30000});
  const identity=await page.evaluate(()=>workspace.workspace_id);
  if(identity!==ready.workspace_id)throw Error('The actual browser opened a different workspace.');
  await event('host_opened',{tag,workspace_id:identity});
}
async function section(name){
  if(await page.locator('#page-title').textContent()!=='SQL Server'){
    await page.locator('nav button[data-tab="sql"]').click();
    await page.locator('[data-action="sql-section"][data-section="'+name+'"]').waitFor();
  }
  await page.locator('[data-action="sql-section"][data-section="'+name+'"]').click();
  const expected={connections:'#sql-profile-select',queries:'#sql-query-select',jobs:'#sql-job-select',mapping:'#sql-mapping-plan',receiving:'#sql-receive-file'};
  await page.locator(expected[name]).waitFor();
}
async function selected(id,value){
  await page.locator('#'+id).selectOption(value);
  await page.waitForFunction(({id,value})=>document.getElementById(id)?.value===value,{id,value});
  await pause(120);
}
async function action(selector,actionName){
  const received=page.waitForResponse(r=>r.url().endsWith('/api/action/'+actionName)&&r.request().method()==='POST',{timeout:90000});
  await page.locator(selector).click();
  const response=await received;const value=await response.json();
  if(!response.ok())throw Error(actionName+': '+(value.error||response.status()));
  await page.waitForFunction(()=>document.body.dataset.busy!=='true');
  return value.record;
}
async function download(selector,filename){
  const button=page.locator(selector),expected=await button.getAttribute('data-sha');
  const destination=path.join(uiRoot,filename);
  if(await exists(destination)){
    const value=await fs.readFile(destination);
    if(hash(value)!==expected)throw Error('The retained original download differs: '+filename);
    return{path:destination,bytes:value.length,sha256:expected};
  }
  const pending=page.waitForEvent('download',{timeout:90000});
  await button.click();const artifact=await pending;await artifact.saveAs(destination);
  const value=await fs.readFile(destination);
  if(hash(value)!==expected)throw Error('The downloaded artifact differs from its actual original object.');
  const result={path:destination,bytes:value.length,sha256:expected};
  state.downloads.push({file:filename,bytes:result.bytes,sha256:expected});await write(statePath,state);return result;
}
async function view(name,tag){
  await section(name);
  await page.waitForFunction(()=>document.body.dataset.busy!=='true');
  const size=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
    content:document.querySelector('#content')?.innerText.length||0}));
  if(size.scroll>size.width+1)throw Error('Horizontal page overflow in '+tag+'/'+name+': '+JSON.stringify(size));
  if(size.content<80)throw Error('The selected SQL view is empty.');
  const existing=state.views.find(v=>v.tag===tag&&v.section===name);
  if(!existing)state.views.push({tag,section:name,...size});
  await write(statePath,state);
}
try{
  browser=await playwright.chromium.launch({executablePath:chromium,headless:true,
    args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--no-zygote','--single-process']});
  if(state.phase<1){
    await startHost(path.join(operation,'workspace'),'source');
    await section('connections');await selected('sql-profile-select',original.profile.id);
    await page.locator('#sql-profile-notes').waitFor();
    const marker='Browser operating review '+state.operation_id;
    if(!(await page.locator('#sql-profile-notes').inputValue()).includes(marker)){
      await page.locator('#sql-profile-notes').fill((await page.locator('#sql-profile-notes').inputValue())+'\n'+marker);
      const profile=await action('[data-action="sql-save-profile"]','sql.profile.save');
      if(profile.id!==original.profile.id)throw Error('The connection edit lost its original identity.');
      state.profile_revision=profile.revision;await event('connection_revision_saved',{id:profile.id,revision:profile.revision});
    }
    await section('queries');await selected('sql-query-select',original.query.id);
    await page.locator('#sql-review-note').waitFor();
    if(!(await page.locator('#sql-review-note').inputValue()).includes(marker)){
      await page.locator('#sql-review-note').fill((await page.locator('#sql-review-note').inputValue())+'\n'+marker);
      const reviewed=await action('[data-action="sql-review-query"]','sql.query.review');
      state.query_revision=reviewed.revision;await event('original_preflight_reviewed',{id:reviewed.id,revision:reviewed.revision});
    }
    await section('jobs');await selected('sql-job-select',original.capture_job.id);
    await page.waitForFunction(id=>workspace.sql_job.find(j=>j.id===id)?.payload.complete,original.capture_job.id);
    const job=await page.evaluate(id=>workspace.sql_job.find(j=>j.id===id),original.capture_job.id);
    if(job.payload.progress.rows!==5037||job.payload.progress.pages!==8)throw Error('The actual completed capture count differs.');
    await download('button[data-action="download"][data-sha="'+job.payload.package.digest+'"]','original-native-job.zip');
    await download('button[data-action="download"][data-sha="'+job.payload.result_bundle.digest+'"]','original-native-result.zip');
    await page.screenshot({path:path.join(uiRoot,'01-sql-capture-desktop.png'),fullPage:true});
    await page.locator('[data-action="sql-open-data"]').click();
    await page.locator('#data-search').waitFor();
    const firstKey=await page.locator('td[data-column="source_record_id"]').first().getAttribute('data-value');
    await page.locator('#data-search').fill(firstKey);await page.locator('[data-action="search-data"]').click();
    await page.waitForFunction(()=>document.querySelector('#content')?.innerText.includes('1 matching rows'));
    await event('original_complete_dataset_opened',{dataset_id:original.dataset_id,rows:5037,search_rows:1});
    await section('mapping');
    await selected('sql-mapping-plan',original.mapped_plan.id);
    await selected('sql-mapping-table','OffenseCells');
    const prior=await page.evaluate(id=>workspace.sql_mapping.find(m=>m.id===id),original.mapping.id);
    for(const field of prior.payload.fields)
      await page.locator('.sql-binding-field[data-target="'+field.target.replaceAll('"','\\"')+'"]').selectOption(field.source);
    const mappingMarker='Complete original field mapping '+state.operation_id;
    let mapped=await page.evaluate(mark=>workspace.sql_mapping.find(m=>m.payload.review_note===mark),mappingMarker);
    if(!mapped){
      await page.locator('#sql-mapping-note').fill(mappingMarker);
      mapped=await action('[data-action="sql-save-mapping"]','sql.mapping.save');
      state.mapping_id=mapped.id;await write(statePath,state);
    }
    let applied=await page.evaluate(id=>workspace.plan.find(p=>(p.payload.sql_mappings||[]).some(r=>r.id===id)),mapped.id);
    if(!applied){
      applied=await action('[data-action="sql-apply-mapping"][data-id="'+mapped.id+'"]','sql.mapping.apply');
      await page.locator('#plan-select').waitFor();
    }
    state.mapped_plan_revision=applied.revision;await event('model_mapping_applied',{mapping_id:mapped.id,plan_id:applied.id,revision:applied.revision});
    await section('receiving');
    const label='Complete SQL UI receiving '+state.operation_id;
    let delivery=await page.evaluate(label=>workspace.sql_delivery.find(r=>r.payload.label===label),label);
    if(!delivery){
      await page.locator('#sql-handoff-label').fill(label);
      await page.locator('#sql-handoff-notes').fill('Original published-source operation, retained native captures and exact current model/source history.');
      delivery=await action('[data-action="sql-build-handoff"]','sql.handoff');
    }
    state.delivery={id:delivery.id,digest:delivery.payload.package.digest};
    const transfer=await download('button[data-action="download"][data-sha="'+delivery.payload.package.digest+'"]','current-workstream.zip');
    state.transfer=transfer;
    for(const sectionName of ['connections','queries','jobs','mapping','receiving'])await view(sectionName,'desktop');
    await page.setViewportSize({width:390,height:844});
    for(const sectionName of ['connections','queries','jobs','mapping','receiving'])await view(sectionName,'mobile');
    await page.screenshot({path:path.join(uiRoot,'02-sql-receiving-mobile.png'),fullPage:true});
    state.phase=1;await event('source_operator_complete',{native_launched:0});
  }
  if(state.phase<2){
    await startHost(path.join(operation,'receiver'),'receiver');
    await section('receiving');
    const existing=await page.evaluate(digest=>workspace.sql_receipt.find(r=>r.payload.bundle_sha256===digest),state.transfer.sha256);
    let receipt=existing;
    if(!receipt||receipt.payload.status!=='accepted'){
      await page.locator('#sql-receive-file').setInputFiles(state.transfer.path);
      receipt=await action('[data-action="sql-preview-receipt"]','sql.receive.preview');
      if(receipt.payload.status!=='accepted'){
        await page.locator('#sql-receive-reason').fill('Retain both full operator branches after independent reviewed profile/model changes.');
        receipt=await action('[data-action="sql-adopt-receipt"]','sql.receive.apply');
      }
    }
    if(receipt.payload.status!=='accepted')throw Error('The original receiving operation was not accepted.');
    state.receipt_id=receipt.id;state.received_heads=receipt.payload.adopted_heads.length;
    await page.screenshot({path:path.join(uiRoot,'03-sql-receiving-desktop.png'),fullPage:true});
    state.phase=2;await event('complete_receiving_adopted',{id:receipt.id,choice:receipt.payload.choice,heads:state.received_heads,native_launched:0});
  }
  if(state.phase<3){
    await startHost(path.join(operation,'receiver'),'receiver-reopened');
    await section('receiving');await selected('sql-receipt-select',state.receipt_id);
    await page.waitForFunction(id=>workspace.sql_receipt.find(r=>r.id===id)?.payload.status==='accepted',state.receipt_id);
    if((await page.evaluate(()=>workspace.sql_runtime.active_local_children))!==0)throw Error('Receiving started an unexpected native child.');
    await startHost(path.join(operation,'restored'),'cold-restored');
    await section('jobs');await selected('sql-job-select',original.capture_job.id);
    await page.waitForFunction(id=>workspace.sql_job.find(r=>r.id===id)?.payload.complete,original.capture_job.id);
    const actual=await page.evaluate(id=>workspace.sql_job.find(r=>r.id===id).payload,original.capture_job.id);
    if(actual.progress.rows!==5037||actual.document.job_id!==original.native_result.job_id)throw Error('Cold restored native identity differs.');
    state.phase=3;await event('original_receiving_and_encrypted_restore_reopened',{rows:5037,job_id:actual.document.job_id,native_launched:0});
  }
  if(errors.length)throw Error('The actual browser reported '+errors.length+' errors; retain UI-ERRORS.json.');
  state.status='complete';state.completed_at=new Date().toISOString();await write(statePath,state);
  const result={schema:'commons-bi-sql-ui-result/1',operation_id:state.operation_id,status:'PASS',completed_at:state.completed_at,
    views:state.views,downloads:state.downloads,profile_revision:state.profile_revision,query_revision:state.query_revision,
    mapped_plan_revision:state.mapped_plan_revision,receipt_id:state.receipt_id,received_heads:state.received_heads,
    original_capture_rows:5037,original_committed_pages:8,source_and_receiver_reopened:true,cold_restored_workspace_opened:true,
    browser_errors:0,native_jobs_started:0,sql_server_connections:0};
  await write(resultPath,result);console.log(JSON.stringify(result));
}catch(error){
  await event('continuation_stopped',{error:String(error.message).replace(/#token=[^\s"]+/g,'#token=(private)')});
  await write(path.join(uiRoot,'UI-ERRORS.json'),errors);
  console.error(JSON.stringify({operation_id:state.operation_id,phase:state.phase,error:String(error.message).replace(/#token=[^\s"]+/g,'#token=(private)')}));
  process.exitCode=1;
}finally{
  await closeHost();
  if(browser)await browser.close();
  await write(path.join(uiRoot,'CLOSED.json'),{operation_id:state.operation_id,at:new Date().toISOString(),browser_closed:true,host_closed:true});
}
