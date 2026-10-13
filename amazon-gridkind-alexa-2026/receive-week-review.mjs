#!/usr/bin/env node
// Original GridKind operating course. Run once under an exclusive host flock.
const fs=await import('node:fs/promises');
const sync=await import('node:fs');
const path=await import('node:path');
const crypto=await import('node:crypto');
const {pathToFileURL}=await import('node:url');
const {once}=await import('node:events');
const args={};
for(let i=2;i<process.argv.length;i+=2){
  if(!process.argv[i]?.startsWith('--')||!process.argv[i+1])throw Error('Every option requires a value.');
  args[process.argv[i].slice(2)]=process.argv[i+1];
}
for(const key of ['application','directory','source-packet','source-sha256','playwright','chromium'])if(!args[key])throw Error('Missing --'+key);
if(Number(process.versions.node.split('.')[0])<24)throw Error('Use the original Node24 runtime with built-in SQLite.');
const APP=path.resolve(args.application),WORK=path.resolve(args.directory),REPO=path.dirname(APP);
if(path.basename(APP)!=='amazon-gridkind-alexa-2026')throw Error('Select the original amazon-gridkind-alexa-2026 application directory.');
const within=(root,p)=>p===root||p.startsWith(root+path.sep);
if(within(APP,WORK)||within(WORK,APP))throw Error('Receiving output and application must be separate directories.');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const gitsha=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
function check(ok,message){if(!ok)throw Error(message);}
async function regular(p){const s=await fs.lstat(p);check(s.isFile()&&!s.isSymbolicLink(),'Expected original regular file: '+p);return s;}
async function privateDir(p){await fs.mkdir(p,{recursive:true,mode:0o700});const s=await fs.lstat(p);check(s.isDirectory()&&!s.isSymbolicLink(),'Expected owned directory: '+p);await fs.chmod(p,0o700);}
async function syncDir(p){const fd=await fs.open(p,'r');try{await fd.sync();}finally{await fd.close();}}
async function publish(p,body){
  const bytes=Buffer.isBuffer(body)?body:Buffer.from(body,'utf8');await privateDir(path.dirname(p));
  try{await regular(p);check((await fs.readFile(p)).equals(bytes),'Existing different receiving output retained: '+p);return;}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const temp=p+'.partial-'+crypto.randomUUID();const fd=await fs.open(temp,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  try{await fs.link(temp,p);await syncDir(path.dirname(p));}
  catch(e){if(e.code!=='EEXIST')throw e;await regular(p);check((await fs.readFile(p)).equals(bytes),'Concurrent different output retained: '+p);}
  finally{await fs.unlink(temp).catch(()=>{});}
}
async function json(p,value){await publish(p,JSON.stringify(value,null,2)+'\n');}
async function maybe(p){try{await regular(p);return JSON.parse(await fs.readFile(p,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
await privateDir(WORK);
const raw=await fs.readFile(path.resolve(args['source-packet']));
check(sha(raw)===args['source-sha256'],'Complete source packet SHA256 differs.');
const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
check(Array.isArray(packet.files)&&packet.files.length>=32,'Complete original source closure is required.');
const sources=[],seen=new Set();
for(const f of packet.files){
  check(typeof f.path==='string'&&!f.path.startsWith('/')&&!f.path.includes('\\')&&!f.path.split('/').some(x=>!x||x==='.'||x==='..')&&!seen.has(f.path),'Unsafe/duplicate source path');
  seen.add(f.path);
  const bytes=Buffer.from(f.content,'utf8');
  check(bytes.length===f.bytes&&sha(bytes)===f.sha256,'Declared source member differs: '+f.path);
  if(f.git_blob||f.git_blob_sha)check(gitsha(bytes)===(f.git_blob||f.git_blob_sha),'Original Git member differs: '+f.path);
  check(f.path==='AGENTS.md'||f.path.startsWith('amazon-gridkind-alexa-2026/'),'Unexpected source outside original application');
  const target=path.resolve(REPO,f.path);await regular(target);
  check((await fs.readFile(target)).equals(bytes),'Installed original source differs: '+f.path);
  sources.push({path:f.path,bytes:f.bytes,sha256:f.sha256,git_blob:gitsha(bytes)});
}
for(const name of ['server.mjs','workspace.mjs','weekly.mjs','week-review.mjs','README.md','WEEK_REVIEW.md','receive-week-review.mjs'])check(seen.has('amazon-gridkind-alexa-2026/'+name),'Missing complete source: '+name);
const operation='GRIDKIND-HOUSEHOLD-WEEK-COLLABORATION-BBBD-20261013';
const binding={schema:'gridkind.review-receiving/v1',operation,source_sha256:sha(raw),source_files:sources,application:APP,directory:WORK,node:process.execPath,node_version:process.version,playwright:path.resolve(args.playwright),chromium:path.resolve(args.chromium)};
await json(path.join(WORK,'binding.json'),binding);
await publish(path.join(WORK,'delivery','original-source-packet.json'),raw);
const completed=await maybe(path.join(WORK,'complete.json'));
if(completed){
  check(completed.source_sha256===sha(raw),'Completed source differs.');
  for(const item of completed.outputs){const p=path.resolve(WORK,item.path);check(within(WORK,p),'Unsafe retained result');await regular(p);const bytes=await fs.readFile(p);check(bytes.length===item.bytes&&sha(bytes)===item.sha256,'Completed output differs: '+item.path);}
  console.log(JSON.stringify({event:'original-complete-reopened',result:path.join(WORK,'complete.json'),...completed}));process.exit(0);
}
const ATTEMPT=crypto.randomUUID();
const ATTEMPT_DIR=path.join(WORK,'attempts',ATTEMPT);await privateDir(ATTEMPT_DIR);
console.log(JSON.stringify({event:'receiving-admitted',operation,attempt:ATTEMPT,pid:process.pid,source_sha256:sha(raw),directory:WORK}));
const baselineName='GridKind review operating course · original';
const currentName='GridKind review operating course · owner update';
const requestMessage='Original '+operation+' operating example. Please review days 1–3; no real tariffs, invitation or device command.';
let browser=null,launch=null,stopping=false,shutdownPromise=null,servers=[],contexts=[],errors=[],shots=[],httpRequests=[];
function stop(){
  stopping=true;
  if(!shutdownPromise)shutdownPromise=(async()=>{
    if(launch&&!browser){try{browser=await launch;}catch{}}
    if(browser){await browser.close();browser=null;}
    for(const server of servers.splice(0).reverse())await new Promise((resolve,reject)=>{
      try{server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());server.closeAllConnections?.();}catch(error){reject(error);}
    });
  })();
  return shutdownPromise;
}
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{stop().finally(()=>process.exit(signal==='SIGINT'?130:143));});
async function start(app,workspace,port=0){
  const module=await import(pathToFileURL(path.join(app,'server.mjs')).href);
  const server=module.start({host:'127.0.0.1',port,workspace});servers.push(server);
  if(!server.listening)await once(server,'listening');
  return 'http://127.0.0.1:'+server.address().port;
}
async function contextFor(origin,file){
  const saved=await maybe(file);const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(context);
  if(saved?.cookies){await context.addCookies(saved.cookies.map(c=>({...c,domain:'127.0.0.1'})));}
  const response=await context.request.get(origin+'/api/state');check(response.ok(),'Open original browser household');const state=await response.json();
  const cookies=await context.cookies(origin);
  if(!saved)await json(file,{cookies});
  return {context,state};
}
async function get(context,origin,route){const r=await context.request.get(origin+route);const b=await r.json();check(r.ok(),b.error||route);return b;}
async function post(context,origin,route,body,expected=200){
  const r=await context.request.post(origin+route,{data:body,headers:{origin}});const b=await r.json();check(r.status()===expected,(b.error||route)+' HTTP '+r.status());return b;
}
const ctx=s=>({generation:s.workspace.generation,householdId:s.workspace.selectedId,revision:s.workspace.revision});
async function records(context,origin,home){
  const out=[];let offset=0;
  for(;;){const p=await get(context,origin,'/api/workspace/history?householdId='+encodeURIComponent(home)+'&offset='+offset);for(const s of p.records)out.push(await get(context,origin,'/api/workspace/record?householdId='+encodeURIComponent(home)+'&id='+s.id));if(!p.hasMore)return out;offset+=p.records.length;check(p.records.length>0,'History paging did not advance');}
}
async function shot(page,name,width=1440){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);
  const rel='delivery/screens/'+ATTEMPT+'/'+name+'-'+width+'.png';const p=path.join(WORK,rel);
  await privateDir(path.dirname(p));const b=await page.screenshot({fullPage:true});await publish(p,b);
  shots.push({path:rel,viewport:{width,height:1000},viewed:false});
}
async function download(page,selector,name){
  const pending=page.waitForEvent('download',{timeout:30000});await page.locator(selector).click();const d=await pending;
  const tmp=path.join(WORK,'download-'+crypto.randomUUID()+'.partial');await d.saveAs(tmp);
  try{const bytes=await fs.readFile(tmp);const target=path.join(WORK,'delivery',name);await publish(target,bytes);return {path:target,bytes,original_name:d.suggestedFilename()};}
  finally{await fs.unlink(tmp).catch(()=>{});}
}
function track(page){
  page.on('pageerror',error=>errors.push({page:page.url(),message:error.message}));
  page.on('request',request=>{if(request.method()==='POST'&&request.url().includes('/api/week-review')){
    try{const body=request.postDataJSON();httpRequests.push({url:request.url(),body});
      const filename=path.join(ATTEMPT_DIR,'request-'+httpRequests.length+'.json');
      const fd=sync.openSync(filename,'wx',0o600);try{sync.writeFileSync(fd,JSON.stringify({url:request.url(),body}));sync.fsyncSync(fd);}finally{sync.closeSync(fd);}
    }catch(error){errors.push({phase:'retain-real-request',message:error.message});}
  }});
}
async function clickPost(page,selector,action){
  const waiting=page.waitForResponse(r=>{try{return new URL(r.url()).pathname==='/api/week-review'&&r.request().method()==='POST'&&r.request().postDataJSON().action===action;}catch{return false;}},{timeout:30000});
  await page.locator(selector).click();const response=await waiting;const body=await response.json();check(response.ok(),body.error||action);return body;
}
async function findWeek(context,origin,name,input){
  const state=await get(context,origin,'/api/state'),all=await records(context,origin,state.workspace.selectedId);
  const matches=all.filter(r=>r.kind==='week'&&r.detail?.report?.input?.name===name&&JSON.stringify(r.detail.report.input)===JSON.stringify(input));
  if(matches.length){check(matches.length===1,'Multiple original course weeks: '+name);check(JSON.stringify(matches[0].detail.report.input)===JSON.stringify(input),'Saved original course input differs');return matches[0];}
  return (await post(context,origin,'/api/week',{action:'plan',input,context:ctx(state)})).record;
}
async function uiState(page,origin,recordId){
  await page.goto(origin+'/week?record='+encodeURIComponent(recordId));
  await page.locator('#review-recipient').waitFor({state:'visible'});
  await page.locator('#request-week-review:not([disabled])').waitFor();
}
async function openRequest(page,requestId){
  await page.locator('#review-request-select:not([disabled])').waitFor();
  await page.locator('#review-request-select').selectOption(requestId);
  await page.waitForFunction(id=>{
    const a=document.querySelector('#review-export-json');
    return a&&!a.classList.contains('only-hidden')&&new URL(a.href).searchParams.get('recordId')===id;
  },requestId);
  await page.locator('#review-return-file:not([disabled])').waitFor();
}
async function reopenReviewFile(page,file){
  await page.locator('#review-open-draft:not([disabled])').waitFor();
  await page.locator('#review-open-draft').setInputFiles(file);
  await page.waitForFunction(name=>document.querySelector('#review-draft-status')?.textContent.startsWith('Opened '+name+' '),path.basename(file));
}
async function dailyCourse(context,origin,page,week,minSequence=0){
  const prior=await records(context,origin,(await get(context,origin,'/api/state')).workspace.selectedId);
  const adopted=prior.filter(r=>r.sequence>minSequence&&r.kind==='restore'&&r.detail?.fromRecordId===week.id&&r.detail?.dayIndex===0).sort((a,b)=>a.sequence-b.sequence)[0];
  const input=week.detail.report.input.days[0].scenario;
  const executions=adopted?prior.filter(r=>r.kind==='execution'&&r.sequence>adopted.sequence&&r.state?.receipt?.simulated===true&&JSON.stringify(r.scenario)===JSON.stringify(input)):[];
  if(executions.length){
    check(executions.length===1,'Multiple original daily outcomes require reconciliation');
    await page.goto(origin+'/');return executions[0].state.receipt;
  }
  if(!adopted){const current=await get(context,origin,'/api/state');await post(context,origin,'/api/week',{action:'adopt-day',recordId:week.id,dayIndex:0,context:ctx(current)});}
  await page.goto(origin+'/');await page.locator('#plan').click();await page.locator('#approve:not([disabled])').waitFor();
  await page.locator('#approve').click();await page.locator('#execute:not([disabled])').waitFor();
  const executing=page.waitForResponse(r=>{try{return new URL(r.url()).pathname==='/api/action'&&r.request().method()==='POST'&&r.request().postDataJSON().action==='execute';}catch{return false;}});
  await page.locator('#execute').click();const execution=await executing;check(execution.ok(),'Original daily execute response failed.');
  const result=await execution.json();check(result.receipt?.simulated===true,'Original execution response omitted its receipt.');
  await page.waitForFunction(id=>{try{return JSON.parse(document.querySelector('#receipt').textContent).id===id;}catch{return false;}},result.receipt.id);
  const daily=await get(context,origin,'/api/state');check(daily.receipt?.id===result.receipt.id,'The original daily simulation did not reopen.');return daily.receipt;
}
try{
  const installed=await import(pathToFileURL(path.resolve(args.playwright)).href);
  const chromium=installed.chromium||installed.default?.chromium;check(chromium,'The supplied installed module does not expose Chromium.');
  launch=chromium.launch({headless:true,executablePath:path.resolve(args.chromium),args:['--no-sandbox','--disable-dev-shm-usage']});
  browser=await launch;if(stopping){await stop();throw Error('Interrupted before browser operation');}
  const origin=await start(APP,path.join(WORK,'households-original'));
  const owned=await contextFor(origin,path.join(WORK,'browser-owner.private.json')),owner=owned.context;
  const page=await owner.newPage();track(page);
  await page.goto(origin+'/week');await page.locator('#week-name').waitFor();
  await shot(page,'week-opening');
  const savedOriginal=await maybe(path.join(WORK,'original-week.json'));
  const base=savedOriginal?.detail.report.input??{name:baselineName,startDate:'2026-10-19',days:Array.from({length:7},(_,i)=>({enabled:i!==6,scenario:structuredClone(owned.state.scenario)}))};
  const original=await findWeek(owner,origin,baselineName,base);await json(path.join(WORK,'original-week.json'),original);
  await uiState(page,origin,original.id);await shot(page,'proposal-desktop');await shot(page,'proposal-phone',390);await page.setViewportSize({width:1440,height:1000});
  const existing=(await records(owner,origin,owned.state.workspace.selectedId)).filter(r=>r.kind==='week-request'&&r.parentId===original.id&&r.detail?.message===requestMessage&&r.detail?.recipient==='Independent household reviewer · operating example');
  let requestRecord;
  if(existing.length){
    check(existing.length===1,'More than one original course request; retain and reconcile explicitly');requestRecord=existing[0];
    await page.locator('#review-request-select').selectOption(requestRecord.id);
  }else{
    await page.locator('#review-recipient').fill('Independent household reviewer · operating example');
    await page.locator('#review-message').fill(requestMessage);
    const created=await clickPost(page,'#request-week-review','request');requestRecord=created.record;
  }
  await json(path.join(WORK,'request-record.json'),requestRecord);
  await openRequest(page,requestRecord.id);
  const requestDownload=await download(page,'#review-export-json','week-request.json');
  const htmlDownload=await download(page,'#review-export-html','week-reviewer.html');
  const requestBundle=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(requestDownload.bytes));
  check(requestBundle.schema==='gridkind-week-review-package/v1'&&JSON.stringify(requestBundle.request)===JSON.stringify(requestRecord),'Downloaded request is not the exact original saved proposal.');
  await json(path.join(WORK,'request-download.json'),{record_id:requestRecord.id,bytes:requestDownload.bytes.length,sha256:sha(requestDownload.bytes),html_bytes:htmlDownload.bytes.length,html_sha256:sha(htmlDownload.bytes)});
  const offline=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});contexts.push(offline);
  await offline.route(/^https?:\/\//,route=>route.abort()); // The exported local reviewer must work without a network.
  const review=await offline.newPage();track(review);await review.goto(pathToFileURL(htmlDownload.path).href);
  await review.locator('#reviewer-name').waitFor();await shot(review,'offline-original');await shot(review,'offline-original-phone',390);await review.setViewportSize({width:1440,height:1000});
  const previousReturn=await maybe(path.join(WORK,'delivery','week-return.json'));
  const savedDraft=await maybe(path.join(WORK,'delivery','reviewer-draft.json'));
  let returned,returnedPath=path.join(WORK,'delivery','week-return.json');
  if(previousReturn){
    returned=previousReturn;
    check(savedDraft,'Original completed review has no saved draft.');
    await reopenReviewFile(review,path.join(WORK,'delivery','reviewer-draft.json'));
    await reopenReviewFile(review,returnedPath);
  }else{
    if(savedDraft)await reopenReviewFile(review,path.join(WORK,'delivery','reviewer-draft.json'));
    else{
      await review.locator('#reviewer-name:not([disabled])').fill('Receiving reviewer · stated local attribution');
      await review.locator('#reviewer-notes').fill('Operating example: revise two hourly assumptions, retain the owner’s other independent change, and review the whole returned week before any daily approval.');
      await review.locator('#review-week-name').fill('GridKind review operating course · reviewer proposal');
      await review.locator('[data-review-day="0"]').click();await review.locator('#hourly-rate-21').fill('0.44');await review.locator('#review-day-note').fill('Proposed day-one 21:00 hourly price, explicitly hypothetical.');
      await review.locator('[data-review-day="2"]').click();await review.locator('#hourly-rate-23').fill('0.47');await review.locator('#review-day-note').fill('An independent day-three 23:00 hourly-price edit.');
      await review.locator('#review-recalculate').click();
      await download(review,'#review-save-draft','reviewer-draft.json');
      await reopenReviewFile(review,path.join(WORK,'delivery','reviewer-draft.json'));
    }
    await review.locator('#review-recalculate').click();
    const r=await download(review,'#review-download-response','week-return.json');returned=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.bytes));
    await reopenReviewFile(review,returnedPath);
  }
  check(returned.schema==='gridkind-week-review-response/v1'&&returned.input.days.length===7,'Offline reviewer returned the wrong format.');
  check(returned.input.days[0].scenario.prices[21]===0.44&&returned.input.days[2].scenario.prices[23]===0.47,'Actual reviewer edits were not retained.');
  await shot(review,'offline-return');await shot(review,'offline-return-phone',390);
  const ownerInput=structuredClone(base);ownerInput.name=currentName;ownerInput.days[0].scenario.prices[21]=0.33;ownerInput.days[1].scenario.prices[22]=0.35;
  const current=await findWeek(owner,origin,currentName,ownerInput);await json(path.join(WORK,'current-owner-week.json'),current);
  await uiState(page,origin,current.id);await openRequest(page,requestRecord.id);await page.locator('#review-target').selectOption(current.id);
  // Consume the actual downloaded return, then visibly handle a malformed local file and recover.
  const bad=path.join(WORK,'malformed-local-return.json');await publish(bad,'{"schema":');
  await page.locator('#review-return-file').setInputFiles(bad);await page.waitForFunction(()=>!!document.querySelector('#error')?.textContent);await shot(page,'owner-invalid-file');
  await page.locator('#review-return-file').setInputFiles(returnedPath);
  await page.locator('#preview-week-return:not([disabled])').waitFor();
  const before=await get(owner,origin,'/api/state');
  const preview=await clickPost(page,'#preview-week-return','preview-return');
  check((await get(owner,origin,'/api/state')).workspace.revision===before.workspace.revision,'Return preview mutated the workspace.');
  await page.locator('[data-review-choice="name"]').selectOption('current');
  await page.locator('[data-review-choice="day-0"]').selectOption('returned');
  await shot(page,'owner-conflict-choices');await shot(page,'owner-conflict-choices-phone',390);await page.setViewportSize({width:1440,height:1000});
  const applied=await clickPost(page,'#apply-week-return','apply-return');
  const last=httpRequests.filter(r=>r.body.action==='apply-return').at(-1);check(last,'Actual applied browser request was not retained.');
  await json(path.join(ATTEMPT_DIR,'applied-request.private.json'),last.body);
  await json(path.join(WORK,'applied-result.json'),{returnRecord:applied.returnRecord,record:applied.record,householdId:applied.householdId});
  const outcome=applied.record?.detail?.report?.input;
  check(outcome?.name===currentName&&outcome.days[0].scenario.prices[21]===0.44&&outcome.days[1].scenario.prices[22]===0.35&&outcome.days[2].scenario.prices[23]===0.47,'Owner choices or independent edits were not preserved.');
  // Reopen the same SQLite household after an actual server restart, keeping the
  // original browser cookie and exact committed payload (including old generation).
  const originalServer=servers.shift();await new Promise((resolve,reject)=>{originalServer.close(e=>e?reject(e):resolve());originalServer.closeAllConnections?.();});
  check(await start(APP,path.join(WORK,'households-original'),Number(new URL(origin).port))===origin,'Original server did not reopen on its retained loopback origin.');
  const restarted=await get(owner,origin,'/api/state');
  check(restarted.workspace.selectedId===applied.householdId&&restarted.workspace.generation!==last.body.context.generation,'Original household/cold generation did not reopen.');
  const replay=await post(owner,origin,'/api/week-review',last.body);
  check(replay.replayed===true&&replay.record.id===applied.record.id&&replay.returnRecord.id===applied.returnRecord.id,'Exact committed return did not reopen its original pair.');
  const history=await records(owner,origin,owned.state.workspace.selectedId);
  check(history.filter(r=>r.id===original.id&&r.sha256===original.sha256).length===1,'Original proposal record changed.');
  await json(path.join(ATTEMPT_DIR,'retained-history.json'),history);
  await uiState(page,origin,applied.record.id);await shot(page,'received-week');await shot(page,'received-week-phone',390);
  const dailyReceipt=await dailyCourse(owner,origin,page,applied.record);
  await json(path.join(WORK,'daily-receipt.json'),dailyReceipt);await shot(page,'original-daily-simulation');
  if(!(await maybe(path.join(WORK,'delivery','household-complete.json'))))await download(page,'#household-export','household-complete.json');
  const backupBytes=await fs.readFile(path.join(WORK,'delivery','household-complete.json')),backup=JSON.parse(backupBytes.toString('utf8'));
  check(backup.schema==='gridkind-household/v1','Wrong original household backup format.');
  await json(path.join(WORK,'backup-receipt.json'),{bytes:backupBytes.length,sha256:sha(backupBytes),household_id:backup.payload.household.id,records:backup.payload.records.length});
  // Close the producing instance before the independent source/workspace restart.
  await owner.close();await offline.close();
  for(const server of servers.splice(0))await new Promise(resolve=>server.close(()=>resolve()));
  const independentRepo=path.join(WORK,'independent','checkout');await privateDir(independentRepo);
  for(const f of packet.files)await publish(path.join(independentRepo,f.path),Buffer.from(f.content,'utf8'));
  const independentApp=path.join(independentRepo,'amazon-gridkind-alexa-2026');
  const restoredOrigin=await start(independentApp,path.join(WORK,'independent','households'));
  const independentOwner=await contextFor(restoredOrigin,path.join(WORK,'browser-independent.private.json')),other=independentOwner.context;
  const receive=await other.newPage();track(receive);await receive.goto(restoredOrigin+'/');
  if(independentOwner.state.workspace.origin?.sha256!==backup.sha256){
    await receive.locator('#household-file').setInputFiles(path.join(WORK,'delivery','household-complete.json'));
    await receive.locator('#household-import:not([disabled])').waitFor();await receive.locator('#household-import').click();
    await receive.waitForFunction(()=>document.querySelector('#household-import-preview')?.textContent.includes('Backup restored'));
  }
  const restored=await get(other,restoredOrigin,'/api/state');
  check(restored.workspace.selectedId!==backup.payload.household.id,'Independent restore replaced the original household identity.');
  check(!restored.approved&&!restored.receipt,'Historical approval became active on independent restore.');
  const receivedHistory=await records(other,restoredOrigin,restored.workspace.selectedId);
  const restoredById=new Map(receivedHistory.map(r=>[r.id,r]));
  check(backup.payload.records.every(r=>restoredById.get(r.id)?.sha256===r.sha256),'Independent restore changed or omitted original history.');
  await uiState(receive,restoredOrigin,applied.record.id);await shot(receive,'independent-reopened-week');await shot(receive,'independent-reopened-phone',390);
  await receive.setViewportSize({width:1440,height:1000});
  await openRequest(receive,requestRecord.id);await receive.locator('#review-target').selectOption(current.id);await receive.locator('#review-return-file').setInputFiles(returnedPath);
  await clickPost(receive,'#preview-week-return','preview-return');await shot(receive,'independent-review-history');
  const independentReceipt=await dailyCourse(other,restoredOrigin,receive,applied.record,Math.max(...backup.payload.records.map(r=>r.sequence)));
  await json(path.join(WORK,'independent-daily-receipt.json'),independentReceipt);await shot(receive,'independent-fresh-daily-simulation');
  await json(path.join(WORK,'independent-result.json'),{household_id:restored.workspace.selectedId,original_household_id:backup.payload.household.id,exact_original_records:backup.payload.records.length,source_files:sources.length,request_id:requestRecord.id,return_id:applied.returnRecord.id,week_id:applied.record.id,historical_approval_inactive:true,fresh_original_daily_simulation:true});
  check(errors.length===0,'Actual browser error: '+JSON.stringify(errors));
  await json(path.join(WORK,'delivery','visual-observation-required-'+ATTEMPT+'.json'),{status:'captured-not-yet-viewed',screens:shots,rule:'The producing operator must open and LOOK at every captured image and open/use every actual outgoing attachment. This program cannot claim human visual inspection.'});
  await stop();
  const outputs=[];
  async function inventory(dir){for(const entry of await fs.readdir(dir,{withFileTypes:true})){const p=path.join(dir,entry.name);if(entry.isDirectory())await inventory(p);else{await regular(p);const bytes=await fs.readFile(p);outputs.push({path:path.relative(WORK,p).split(path.sep).join('/'),bytes:bytes.length,sha256:sha(bytes)});}}}
  await inventory(path.join(WORK,'delivery'));
  const result={schema:'gridkind.review-receiving-result/v1',operation,source_sha256:sha(raw),completed_at:new Date().toISOString(),native_and_browser_course:'complete',visual_inspection:'pending actual image/attachment viewing',source_files:sources.length,records:{original:original.id,current:current.id,request:requestRecord.id,returned:applied.returnRecord.id,received_week:applied.record.id},original_daily_simulation:true,independent_original_records:backup.payload.records.length,browser_closed:true,outputs};
  await json(path.join(WORK,'complete.json'),result);console.log(JSON.stringify(result));
}catch(error){
  let closeError=null;try{await stop();}catch(e){closeError=e.message;}
  const failure={operation,source_sha256:sha(raw),at:new Date().toISOString(),message:error.message,stack:error.stack,browser_closed:!browser,cleanup_error:closeError,outputs_retained:true};
  await json(path.join(WORK,'failure-'+crypto.randomUUID()+'.json'),failure);console.error(JSON.stringify(failure));process.exitCode=1;
}
