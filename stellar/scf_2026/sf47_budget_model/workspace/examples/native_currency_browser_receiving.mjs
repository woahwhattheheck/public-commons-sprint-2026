import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';

const activeReceivers=new Set();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(left,right)=>JSON.stringify(canonical(left))===JSON.stringify(canonical(right));
async function exists(filename){try{await fs.access(filename);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function readJSON(filename){return JSON.parse(await fs.readFile(filename,'utf8'));}
async function syncDirectory(directory){const handle=await fs.open(directory,'r');try{await handle.sync();}finally{await handle.close();}}
async function writeAtomic(filename,bytes,{replace=false}={}){
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const temporary=filename+'.stage-'+randomUUID(),handle=await fs.open(temporary,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{
    if(replace)await fs.rename(temporary,filename);
    else try{await fs.link(temporary,filename);}catch(error){if(error.code!=='EEXIST')throw error;assert((await fs.readFile(filename)).equals(bytes),'Existing original file has different bytes: '+filename);}
    await syncDirectory(path.dirname(filename));
  }finally{await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
const PROC_IDENTITY='sf47.procfs-identity.v1';
function sameProcessIdentity(left,right){
  return left?.schema===PROC_IDENTITY&&right?.schema===PROC_IDENTITY&&
    left.procPid===right.procPid&&left.boot===right.boot&&
    left.start===right.start&&left.namespace===right.namespace;
}
async function fingerprint(selector){
  assert(selector==='self'||Number.isSafeInteger(selector)&&selector>0,'Use a self-observed procfs identity.');
  const root='/proc/'+selector;
  try{
    const [boot,stat,namespace]=await Promise.all([
      fs.readFile('/proc/sys/kernel/random/boot_id','utf8'),
      fs.readFile(root+'/stat','utf8'),fs.readlink(root+'/ns/pid')]);
    const close=stat.lastIndexOf(')'),fields=stat.slice(close+1).trim().split(/\s+/);
    const procPid=Number(stat.slice(0,stat.indexOf(' ')));
    assert(close>0&&Number.isSafeInteger(procPid)&&procPid>0&&
      (selector==='self'||procPid===selector)&&/^[0-9]+$/.test(fields[19]||'')&&
      /^[0-9]+$/.test(fields[1]||'')&&boot.trim()&&/^pid:\[[0-9]+\]$/.test(namespace),
      'Incomplete native procfs process identity.');
    return {schema:PROC_IDENTITY,procPid,boot:boot.trim(),start:fields[19],
      state:fields[0],parentProcPid:Number(fields[1]),namespace};
  }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return null;throw error;}
}
async function matches(identity){
  assert(identity?.schema===PROC_IDENTITY&&Number.isSafeInteger(identity.procPid)&&
    identity.procPid>0,'Legacy namespace-only process identity is ambiguous; preserve its original service owner.');
  const current=await fingerprint(identity.procPid);
  return !!current&&current.state!=='Z'&&sameProcessIdentity(current,identity);
}
async function hashFile(filename){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(filename)){hash.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:hash.digest('hex')};
}

/**
 * One actual browser continuation over the original prepared SF47 case.
 * The caller supplies its already-admitted Playwright Browser and owns that
 * browser's process. This function owns only its browser context and the two
 * sequential original Python services. It never opens a canonical case writer.
 */
export async function receiveNativeCurrency({readyFile,outputDirectory,browser,pythonExecutable='/usr/bin/python3'}){
  assert(browser&&typeof browser.newContext==='function','Supply the original admitted Playwright Browser.');
  assert(path.isAbsolute(readyFile)&&path.isAbsolute(outputDirectory)&&path.isAbsolute(pythonExecutable),'Use explicit absolute native paths.');
  const readyBytes=await fs.readFile(readyFile),nativeReadySha256=sha(readyBytes),ready=JSON.parse(readyBytes);
  assert(ready.state==='READY_FOR_BROWSER','Prepare the original native case before its browser continuation.');
  for(const key of ['operationId','caseId','planId','sourceRoot','workspaceRoot'])assert(typeof ready[key]==='string'&&ready[key], 'NATIVE_READY is missing '+key);
  assert(ready.native?.unvaluedForecastId&&ready.native?.pricedForecastId&&ready.native?.unvaluedPortfolioId&&ready.native?.pricedPortfolioId&&ready.browserInput?.nativeProjectId,'NATIVE_READY lacks its original native forecast identities.');
  const directory=path.resolve(outputDirectory),binding={schema:'sf47.native-currency.browser.v1',operationId:ready.operationId,caseId:ready.caseId,planId:ready.planId,nativeReadySha256};
  const runKey=directory+'|'+nativeReadySha256;assert(!activeReceivers.has(runKey),'The same browser continuation is already active in this process.');
  activeReceivers.add(runKey);
  try{
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const resultFile=path.join(directory,'RESULT.json'),journalFile=path.join(directory,'BROWSER_JOURNAL.json');
  let journal=await exists(journalFile)?await readJSON(journalFile):{...binding,steps:{},mutations:{},artifacts:{},services:[],startedAt:new Date().toISOString()};
  for(const key of Object.keys(binding))assert(journal[key]===binding[key],'Original browser binding changed: '+key);
  if(await exists(resultFile)){
    const result=await readJSON(resultFile);
    assert(result.state==='PASS'&&result.caseId===ready.caseId&&result.nativeReadySha256===nativeReadySha256,'Existing result belongs to another original receiving.');
    for(const item of Object.values(result.artifacts||{}))assert(same(await hashFile(path.join(directory,item.path)),{bytes:item.bytes,sha256:item.sha256}),'A completed original browser artifact changed.');
    return result;
  }
  let queue=Promise.resolve(),service=null,context=null,page=null,currentPhase='',routeJobs=new Set(),errors=[];
  const persist=patch=>{queue=queue.then(async()=>{if(patch)Object.assign(journal,patch);await writeAtomic(journalFile,json(journal),{replace:true});});return queue;};
  const selfIdentity=await fingerprint('self');
  const parentIdentity=selfIdentity?{...selfIdentity,apiPid:process.pid}:null;
  assert(parentIdentity,'This original receiving needs its Linux process identity.');
  await writeAtomic(path.join(directory,'NATIVE_READY.json'),readyBytes);
  await persist();
  async function artifact(name,bytes,source={}){
    const digest=sha(bytes),relative='artifacts/'+name.replace(/\.json$/,'')+'-'+digest.slice(0,16)+'.json';
    await writeAtomic(path.join(directory,relative),bytes);
    const record={path:relative,bytes:bytes.length,sha256:digest,...source};
    journal.artifacts[name]=record;await persist();return record;
  }
  async function waitOwnedExit(owned,milliseconds){
    let timer;
    try{return await Promise.race([
      owned.exited.then(outcome=>({ended:true,outcome})),
      new Promise(resolve=>{timer=setTimeout(()=>resolve({ended:false}),milliseconds);})]);
    }finally{clearTimeout(timer);}
  }
  async function reapOwnedChild(owned){
    assert(owned?.child&&owned.exited,'Retain the actual original ChildProcess handle.');
    const child=owned.child;
    // Node's handle/API PID and the procfs PID can belong to different views.
    // Only this held child object may receive a signal. Stored procfs identities
    // are read-only recovery evidence and are never signal targets.
    if(!owned.ended&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    let observed=await waitOwnedExit(owned,20000);
    if(!observed.ended){
      if(!owned.ended&&child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');
      observed=await waitOwnedExit(owned,5000);
    }
    assert(observed.ended,'The original owned Python child has not exited; preserve its workspace and handle.');
    return observed.outcome;
  }
  async function stopService(record){
    if(!record)return;
    if(service?.record===record){
      await reapOwnedChild(service);
    }else{
      assert(record.identity,'The original service has no unambiguous retained identity.');
      // The gate installs PDEATHSIG before GO. After an interrupted parent
      // disappears, allow that original child to close; never guess a signal PID.
      const until=Date.now()+5000;
      while(await matches(record.identity)&&Date.now()<until)await sleep(75);
      assert(!(await matches(record.identity)),
        'The original service is still alive without its held ChildProcess handle; retain its original owner before continuing.');
    }
    record.state='CLOSED';record.closedAt=new Date().toISOString();await persist();
  }
  async function reconcileServices(){
    for(const record of journal.services){
      if(record.state==='CLOSED')continue;
      if(await matches(record.parent)&&!sameProcessIdentity(record.parent,parentIdentity))
        throw new Error('The original browser receiver still owns its Python service.');
      await stopService(record);
    }
  }
  async function startService(label){
    await reconcileServices();
    const command=[pythonExecutable,'-B',path.join(ready.sourceRoot,'server.py'),'--workspace',ready.workspaceRoot,'--port','0'];
    const gate="import ctypes,json,os,signal,sys\nargv=json.loads(sys.argv[1])\ngate_id=sys.argv[2]\nexpected=json.loads(sys.argv[3])\ndef identity(selector):\n    root=\"/proc/\"+str(selector)\n    with open(root+\"/stat\",encoding=\"utf-8\") as f: stat=f.read()\n    fields=stat[stat.rfind(\")\")+1:].strip().split()\n    with open(\"/proc/sys/kernel/random/boot_id\",encoding=\"utf-8\") as f: boot=f.read().strip()\n    value={\"schema\":\"sf47.procfs-identity.v1\",\"procPid\":int(stat.split(\" \",1)[0]),\n           \"boot\":boot,\"start\":fields[19],\"state\":fields[0],\n           \"parentProcPid\":int(fields[1]),\"namespace\":os.readlink(root+\"/ns/pid\")}\n    if not boot or not value[\"start\"].isdigit(): raise RuntimeError(\"Incomplete child procfs identity\")\n    return value\nparent_api=os.getppid()\nlibc=ctypes.CDLL(None,use_errno=True)\ntry: prctl=libc.prctl\nexcept AttributeError as error: raise RuntimeError(\"Native Linux PR_SET_PDEATHSIG is required before this original service can run\") from error\nprctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong]\nprctl.restype=ctypes.c_int\nif prctl(1,int(signal.SIGTERM),0,0,0)!=0:\n    code=ctypes.get_errno()\n    raise OSError(code,\"Native Linux PR_SET_PDEATHSIG failed; original service was not dispatched\")\nif os.getppid()!=parent_api: raise RuntimeError(\"Original Node parent changed before the service gate\")\ncurrent=identity(\"self\")\nif current[\"parentProcPid\"]!=expected[\"procPid\"]: raise RuntimeError(\"Original procfs Node parent changed\")\nparent=identity(expected[\"procPid\"])\nfor field in (\"schema\",\"procPid\",\"boot\",\"start\",\"namespace\"):\n    if parent[field]!=expected[field]: raise RuntimeError(\"Original Node parent identity changed: \"+field)\nprint(json.dumps({\"sf47_gate\":{\"gateId\":gate_id,\"identity\":current,\n      \"apiPid\":os.getpid(),\"parentApiPid\":parent_api,\"parentDeathSignal\":\"SIGTERM\"}}),flush=True)\nif sys.stdin.readline()!=\"RUN\\n\": raise SystemExit(3)\nif os.getppid()!=parent_api: raise RuntimeError(\"Original Node parent changed before service dispatch\")\nos.execv(argv[0],argv)\n",gateId=randomUUID();
    const child=spawn(pythonExecutable,['-u','-c',gate,JSON.stringify(command),gateId,JSON.stringify(parentIdentity)],
      {stdio:['pipe','pipe','pipe'],shell:false,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    let stdout='',stderr='',announceDone=false,gateDone=false,announcementTimer,gateTimer;
    let resolveGate,rejectGate,resolveAnnouncement,rejectAnnouncement;
    const gated=new Promise((resolve,reject)=>{resolveGate=resolve;rejectGate=reject;});
    const announcement=new Promise((resolve,reject)=>{resolveAnnouncement=resolve;rejectAnnouncement=reject;});
    const rejectPending=error=>{
      clearTimeout(gateTimer);clearTimeout(announcementTimer);
      if(!gateDone){gateDone=true;rejectGate(error);}
      if(!announceDone){announceDone=true;rejectAnnouncement(error);}
    };
    const exited=new Promise(resolve=>{
      child.once('exit',(code,signal)=>{
        resolve({code,signal});
        rejectPending(new Error('Original Python service exited '+code+'/'+signal+': '+stderr.slice(-3000)));
      });
      child.once('error',error=>{resolve({error:error.message});rejectPending(error);});
    });
    const owned={record:null,child,exited,ended:null};
    exited.then(value=>{owned.ended=value;});
    service=owned;gated.catch(()=>{});announcement.catch(()=>{});
    gateTimer=setTimeout(()=>rejectPending(new Error('Original Python child did not report its own procfs identity: '+stderr.slice(-3000))),30000);
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-20000);});
    child.stdout.on('data',chunk=>{
      stdout+=chunk;
      let newline;
      while((newline=stdout.indexOf('\n'))>=0){
        const line=stdout.slice(0,newline);stdout=stdout.slice(newline+1);
        let value;try{value=JSON.parse(line);}catch{continue;}
        if(value.sf47_gate&&!gateDone){
          gateDone=true;clearTimeout(gateTimer);resolveGate(value.sf47_gate);
        }else if(value.url&&!announceDone){
          announceDone=true;clearTimeout(announcementTimer);resolveAnnouncement(value);
        }
      }
    });
    if(!child.pid)await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
    const reported=await gated,identity=reported.identity;
    assert(reported.gateId===gateId&&reported.parentDeathSignal==='SIGTERM'&&
      identity?.schema===PROC_IDENTITY&&identity.parentProcPid===parentIdentity.procPid&&
      identity.boot===parentIdentity.boot&&await matches(identity),
      'The gated Python child did not report its exact original process identity.');
    const record={label,command,identity,parent:parentIdentity,handlePid:child.pid,
      reportedApiPid:reported.apiPid,reportedParentApiPid:reported.parentApiPid,
      gateId,parentDeathSignal:reported.parentDeathSignal,state:'GATED',createdAt:new Date().toISOString()};
    service.record=record;journal.services.push(record);await persist();
    announcementTimer=setTimeout(()=>rejectPending(new Error('Original Python service did not announce its private URL: '+stderr.slice(-3000))),30000);
    child.stdin.end('RUN\n');
    record.state='STARTED';await persist();
    const value=await announcement,base=new URL(value.url);
    assert(base.protocol==='http:'&&base.hostname==='127.0.0.1'&&base.pathname==='/','Original service announced an unexpected destination.');
    const accessKey=(await fs.readFile(path.join(ready.workspaceRoot,'access.key'),'utf8')).trim();
    assert(/^[A-Za-z0-9_-]{32,128}$/.test(accessKey),'Use the original workspace access key.');
    record.url=base.origin;record.state='RUNNING';await persist();
    return {baseUrl:base.origin,accessKey};
  }
  async function get(apiPath){
    const response=await fetch(service.record.url+apiPath,{headers:{authorization:'Bearer '+service.accessKey,origin:service.record.url}});
    const raw=Buffer.from(await response.arrayBuffer());let body;try{body=JSON.parse(raw);}catch{throw new Error('Original native API returned unreadable JSON: '+apiPath);}
    if(!response.ok)throw new Error(body.error?.message||'Original native API failed: '+apiPath);
    return {body,raw};
  }
  async function originalReplay(entry){
    if(entry.response?.ok)return entry.response.body;
    const response=await fetch(service.record.url+'/api/operations/'+ready.caseId+'/command',{method:'POST',headers:{authorization:'Bearer '+service.accessKey,origin:service.record.url,'content-type':'application/json'},body:entry.rawBody});
    const raw=Buffer.from(await response.arrayBuffer()),body=JSON.parse(raw);
    entry.response={ok:response.ok,status:response.status,body,sha256:sha(raw)};entry.recoveredAt=new Date().toISOString();await persist();
    await artifact('original-command-recovery',raw,{requestId:entry.requestId});
    if(!response.ok)throw new Error(body.error?.message||'The original saved UI request could not be recovered.');
    return body;
  }
  async function observedRoute(route){
    const request=route.request(),rawBody=request.postData()||'',body=JSON.parse(rawBody),requestId=body.requestId;
    assert(typeof requestId==='string'&&requestId,'The original UI command did not retain its request identity.');
    const existing=journal.mutations[requestId];
    if(existing)assert(existing.rawBody===rawBody,'The same original UI request changed its native body.');
    const entry=existing||{requestId,rawBody,phase:currentPhase,createdAt:new Date().toISOString()};journal.mutations[requestId]=entry;await persist();
    const response=await route.fetch(),raw=Buffer.from(await response.body());let result;try{result=JSON.parse(raw);}catch{result=null;}
    entry.response={ok:response.ok(),status:response.status(),body:result,sha256:sha(raw)};entry.returnedAt=new Date().toISOString();await persist();
    await artifact('original-ui-command',raw,{requestId,phase:entry.phase});await route.fulfill({response,body:raw});
  }
  async function openBrowser(connection){
    service.accessKey=connection.accessKey;
    context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1050}});
    page=await context.newPage();page.setDefaultTimeout(20000);page.on('pageerror',error=>errors.push(error.message));
    await page.route(connection.baseUrl+'/api/operations/'+ready.caseId+'/command',route=>{
      const job=observedRoute(route).catch(async error=>{errors.push(error.message);try{await route.abort('failed');}catch{};throw error;});
      routeJobs.add(job);job.then(()=>routeJobs.delete(job),()=>routeJobs.delete(job));job.catch(()=>{});return job;
    });
    await page.goto(connection.baseUrl+'/',{waitUntil:'domcontentloaded'});
    await page.locator('#access-panel').waitFor({state:'visible'});
    await page.locator('#access-key').fill(connection.accessKey);
    await page.locator('#access-form button[type=submit]').click();
    await page.locator('#workbench').waitFor({state:'visible'});
    await page.locator('#plan-select').selectOption(ready.planId);
    await page.locator('[data-tab=operations]').click();
    await page.locator('.operations [name=caseSelect]').selectOption(ready.caseId);
    await page.locator('.operations [name=recordingActor]').fill('F47A native currency receiving');
    await page.locator('.operations [name=recordingActor]').dispatchEvent('change');
    await page.locator('[data-ops-tab=forecast]').click();
    await page.locator('.operating-forecast').waitFor({state:'visible'});
  }
  async function closeBrowser(){
    const failures=[];
    const pending=await Promise.allSettled([...routeJobs]);
    for(const item of pending)if(item.status==='rejected')failures.push(item.reason);
    if(context){try{await context.close();}catch(error){failures.push(error);}finally{context=null;page=null;}}
    try{await queue;}catch(error){failures.push(error);}
    if(service){
      try{
        if(service.record)await stopService(service.record);
        else{
          service.child.stdin.destroy();
          await reapOwnedChild(service);
        }
        service=null;
      }catch(error){failures.push(error);}
    }
    if(failures.length)throw new Error(failures.map(error=>error.message||String(error)).join('; '));
  }
  async function forecast(id){
    await page.locator('[data-ops-tab=forecast]').click();
    const select=page.locator('[data-forecast-selection]');
    const received=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/'+ready.caseId+'/forecasts/'+id&&response.request().method()==='GET');
    await select.selectOption(id);
    const response=await received;assert(response.ok(),'The original selected forecast read failed.');await response.body();
    await page.waitForFunction(wanted=>{
      const root=document.querySelector('.operating-forecast');
      return root?.getAttribute('aria-busy')==='false'&&root.querySelector('[data-forecast-selection]')?.value===wanted&&root.querySelector('[data-forecast-status]')?.textContent==='Reopened the original saved forecast.';
    },id);
    await page.locator('[data-forecast-report] [data-forecast-action=export-json]').waitFor({state:'visible'});
  }
  const form=()=>page.locator('[data-forecast-form]');
  async function projectRow(id){
    const rows=page.locator('[data-forecast-commercial]');
    for(let n=0;n<await rows.count();n++){const row=rows.nth(n);if(await row.getAttribute('data-forecast-commercial')===id)return row;}
    throw new Error('The original native project is absent from the actual form: '+id);
  }
  async function preview(){
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/'+ready.caseId+'/forecast-preview'&&response.request().method()==='POST');
    await form().locator('button[type=submit]').click();
    const response=await responsePromise,raw=Buffer.from(await response.body()),body=JSON.parse(raw);
    assert(response.ok(),body.error?.message||'Original preview rejected browser inputs.');
    await page.waitForFunction(()=>{
      const root=document.querySelector('.operating-forecast'),save=root?.querySelector('[data-forecast-action=save]');
      return root?.getAttribute('aria-busy')==='false'&&save&&!save.disabled&&root.querySelector('[data-forecast-status]')?.textContent==='Current source and dated assumptions are ready to save.';
    });
    await artifact(currentPhase+'-preview',raw,{previewSha256:body.previewSha256});return body;
  }
  async function verifySavedRequest(entry,recordId,previewResult=null){
    const request=JSON.parse(entry.rawBody),saved=(await get('/api/operations/'+ready.caseId+'/forecasts/'+recordId)).body;
    assert(request.action==='forecast.save'&&request.requestId===entry.requestId,'Retained browser mutation is not the original forecast save.');
    assert(saved.id===recordId&&saved.previewSha256===request.data.expectedPreviewSha256,'The saved forecast differs from the original accepted preview.');
    assert(same(saved.inputs,request.data.inputs),'The saved forecast differs from its exact retained native input.');
    if(previewResult)assert(saved.previewSha256===previewResult.previewSha256,'The original reviewed preview changed.');
    return saved;
  }
  async function saveForecast(phase,previewResult){
    currentPhase=phase;
    const prior=Object.values(journal.mutations).find(row=>row.phase===phase&&JSON.parse(row.rawBody).action==='forecast.save');
    if(prior){
      const recovered=await originalReplay(prior);assert(recovered.recordId,'Original recovery omitted its saved identity.');
      await verifySavedRequest(prior,recovered.recordId,previewResult);return recovered.recordId;
    }
    const responsePromise=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/'+ready.caseId+'/command'&&response.request().method()==='POST');
    await page.locator('[data-forecast-action=save]').click();
    const response=await responsePromise,body=await response.json();
    assert(response.ok()&&body.recordId,body.error?.message||'Original forecast save did not return its retained identity.');
    const requestId=JSON.parse(response.request().postData()).requestId,entry=journal.mutations[requestId];
    assert(entry,'The original UI request body was not retained before dispatch.');
    await verifySavedRequest(entry,body.recordId,previewResult);
    await forecast(body.recordId);return body.recordId;
  }
  async function download(name,action){
    const prior=journal.artifacts[name];
    if(prior){assert(same(await hashFile(path.join(directory,prior.path)),{bytes:prior.bytes,sha256:prior.sha256}),'Original download changed.');return prior;}
    const temporary=path.join(directory,'.download-'+randomUUID());
    const [transfer]=await Promise.all([page.waitForEvent('download'),action()]);
    await transfer.saveAs(temporary);
    const handle=await fs.open(temporary,'r+');try{await handle.sync();}finally{await handle.close();}
    const facts=await hashFile(temporary);assert(facts.bytes>0&&facts.bytes<=128*1024*1024,'The complete original download exceeds its receiving bound.');
    const extension=path.extname(transfer.suggestedFilename())||'.bin',relative='artifacts/'+name+'-'+facts.sha256.slice(0,16)+extension;
    const record={path:relative,...facts,originalFilename:transfer.suggestedFilename()};
    journal.pendingDownload={name,temporary,record};await persist();
    await fs.mkdir(path.dirname(path.join(directory,relative)),{recursive:true,mode:0o700});
    try{await fs.link(temporary,path.join(directory,relative));}catch(error){if(error.code!=='EEXIST')throw error;assert(same(await hashFile(path.join(directory,relative)),facts),'Published original download conflicts.');}
    await syncDirectory(path.dirname(path.join(directory,relative)));await fs.unlink(temporary);
    journal.artifacts[name]=record;delete journal.pendingDownload;await persist();return record;
  }
  async function reconcileDownload(){
    const item=journal.pendingDownload;if(!item)return;
    const destination=path.join(directory,item.record.path),facts={bytes:item.record.bytes,sha256:item.record.sha256};
    if(await exists(destination))assert(same(await hashFile(destination),facts),'Original published download changed.');
    else if(await exists(item.temporary)){assert(same(await hashFile(item.temporary),facts),'Original completed download stage changed.');await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.link(item.temporary,destination);await syncDirectory(path.dirname(destination));}
    else throw new Error('The original accepted download and its completed stage are missing; preserve the original request.');
    journal.artifacts[item.name]=item.record;await fs.unlink(item.temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});delete journal.pendingDownload;await persist();
  }
  async function legacyModeReview(){
    const rows=ready.legacy?.forecasts||[],legacyId=rows[0]?.id;
    assert(legacyId,'NATIVE_READY has no retained legacy forecast.');
    await forecast(legacyId);await page.locator('[data-forecast-action=reforecast]').click();
    const rowsUI=page.locator('[data-forecast-commercial]');assert(await rowsUI.count()>0,'Original legacy forecast has no customer project to inspect.');
    const row=rowsUI.first(),price=await row.locator('[name=priceUsd]').inputValue(),receipt=await row.locator('[name=receiptAmount]').first().inputValue();
    await row.locator('[name=pricingMode]').selectOption('NATIVE');
    assert(await row.locator('[name=nativePriceAmount]').inputValue()==='','Legacy USD price was silently relabelled.');
    assert(await row.locator('[name=receiptAmountNative]').first().inputValue()==='','Legacy USD milestone was silently relabelled.');
    assert(await row.locator('[name=priceUsd]').isDisabled(),'Hidden legacy price lost its original disabled state.');
    await row.locator('[name=pricingMode]').selectOption('LEGACY_USD');
    assert(await row.locator('[name=priceUsd]').inputValue()===price&&await row.locator('[name=receiptAmount]').first().inputValue()===receipt,'Original legacy amounts were not preserved in the open form.');
    journal.steps.legacy={state:'PASS',forecastId:legacyId,priceUsd:price,milestoneUsd:receipt};await persist();
  }
  async function unvaluedReview(){
    currentPhase='unvalued-dated-preview';
    await forecast(ready.native.unvaluedForecastId);
    assert((await page.locator('[data-forecast-report]').innerText()).includes('Native scope valuation incomplete'),'Unvalued original quote is not visible as incomplete.');
    await page.locator('[data-forecast-action=reforecast]').click();
    const row=await projectRow(ready.browserInput.nativeProjectId),dates=await row.locator('[name=receiptDate]').evaluateAll(nodes=>nodes.map(node=>node.value));
    const asOf=await form().locator('[name=asOfDate]').inputValue(),date=new Date(asOf+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+1);
    await row.locator('[name=receiptDate]').first().fill(date.toISOString().slice(0,10));
    const partial=await preview();
    assert(partial.report.currencyValuation.datedCashComplete===false,'Unvalued dated quote incorrectly became a complete cash curve.');
    assert(partial.report.scenarios.commercial.additionalCashNeededUsd===null,'Unvalued dated cash was presented as zero.');
    assert((await page.locator('.forecast-chart').innerText()).includes('Valued portion'),'The actual cash chart hides its partial valuation.');
    for(let n=0;n<dates.length;n++)await row.locator('[name=receiptDate]').nth(n).fill(dates[n]);
    journal.steps.unvalued={state:'PASS',originalForecastId:ready.native.unvaluedForecastId,temporaryDatedPreview:partial.previewSha256,originalCollectionDates:dates};await persist();
  }
  async function fillRates(){
    for(const rate of ready.browserInput.rates||[]){
      const details=page.locator('details').filter({has:page.locator('[data-forecast-fx-rates]')});
      if((await details.getAttribute('open'))===null)await details.locator(':scope > summary').click();
      let row=null,rows=page.locator('[data-forecast-fx]');
      for(let n=0;n<await rows.count();n++)if(await rows.nth(n).locator('[name=fxId]').inputValue()===rate.id)row=rows.nth(n);
      if(!row){await page.locator('[data-forecast-action=add-fx]').click();row=page.locator('[data-forecast-fx]').last();}
      for(const [key,name] of Object.entries({id:'fxId',baseCurrency:'fxBaseCurrency',quoteCurrency:'fxQuoteCurrency',rate:'fxRate',observationDate:'fxObservationDate',publicationDate:'fxPublicationDate',sourceUrl:'fxSourceUrl',sourceReference:'fxSourceReference',note:'fxNote'}))await row.locator('[name="'+name+'"]').fill(rate[key]??'');
      await row.locator('[name=fxBasis]').selectOption(rate.basis);await row.locator('[name=fxRounding]').selectOption(rate.rounding);
      await row.locator('[name=fxSourceIds]').selectOption(rate.sourceIds||[]);
    }
  }
  async function pricedReview(){
    const original=(await get('/api/operations/'+ready.caseId+'/forecasts/'+ready.native.pricedForecastId)).body;
    const priced=original.inputs.commercial.find(item=>item.id===ready.browserInput.nativeProjectId);
    assert(priced?.nativePricing,'Original priced forecast lacks native input.');
    const prior=Object.values(journal.mutations).find(row=>row.phase==='save-valued-forecast'&&JSON.parse(row.rawBody).action==='forecast.save');
    if(prior){
      const recovered=await originalReplay(prior),saved=await verifySavedRequest(prior,recovered.recordId);
      const item=saved.inputs.commercial.find(value=>value.id===ready.browserInput.nativeProjectId);
      assert(saved.report.currencyValuation.complete===true&&same(item.nativePricing,priced.nativePricing)&&same(item.receipts,priced.receipts)&&same(saved.inputs.fxRates,original.inputs.fxRates),'Recovered original valued forecast lost its native terms, dates or rate sources.');
      journal.steps.priced={...(journal.steps.priced||{}),state:'PASS',forecastId:recovered.recordId,previewSha256:saved.previewSha256};await persist();await forecast(recovered.recordId);return;
    }
    await forecast(ready.native.unvaluedForecastId);await page.locator('[data-forecast-action=reforecast]').click();
    const row=await projectRow(ready.browserInput.nativeProjectId);
    const before={price:await row.locator('[name=nativePriceAmount]').inputValue(),cost:await row.locator('[name=nativeCostAmount]').inputValue(),dates:await row.locator('[name=receiptDate]').evaluateAll(nodes=>nodes.map(node=>node.value))};
    await form().locator('[name=name]').fill(original.inputs.name+' — browser source review');
    await fillRates();
    if(priced.nativePricing.price.currency!=='USD')await row.locator('[name=nativePriceRate]').selectOption(priced.nativePricing.price.fxRateId||'');
    if(priced.nativePricing.deliveryCost.currency!=='USD')await row.locator('[name=nativeCostRate]').selectOption(priced.nativePricing.deliveryCost.fxRateId||'');
    else assert(await row.locator('[name=nativeCostRate]').isDisabled(),'Outer host reenables the USD rate selector.');
    for(const [field,ids] of [['cashIds',ready.browserInput.cashIds],['invoiceIds',ready.browserInput.invoiceIds],['directCashIds',ready.browserInput.directCashIds]])await row.locator('[name="'+field+'"]').selectOption(ids||[]);
    for(const entry of ready.browserInput.priceCredits||[]){
      const credit=row.locator('[data-native-price-credit]');
      let target=null;for(let n=0;n<await credit.count();n++)if(await credit.nth(n).getAttribute('data-native-price-credit')===entry.cashId)target=credit.nth(n);
      assert(target,'Original price credit control is missing.');await target.locator('[name=priceCreditAmount]').fill(entry.amount);await target.locator('[name=priceCreditNote]').fill(entry.note);
    }
    for(const entry of ready.browserInput.costCredits||[]){
      const credits=row.locator('[data-native-cost-credit]');let target=null;for(let n=0;n<await credits.count();n++)if(await credits.nth(n).getAttribute('data-native-cost-credit')===entry.kind+':'+entry.id)target=credits.nth(n);
      assert(target,'Original cost credit control is missing.');await target.locator('[name=costCreditAmount]').fill(entry.amount);await target.locator('[name=costCreditNote]').fill(entry.note);
    }
    currentPhase='priced-ui';const viewed=await preview(),selected=viewed.inputs.commercial.find(item=>item.id===ready.browserInput.nativeProjectId);
    assert(viewed.report.currencyValuation.complete===true,'Explicit original rates did not produce full native valuation.');
    assert(selected.nativePricing.price.amount===priced.nativePricing.price.amount&&selected.nativePricing.deliveryCost.amount===priced.nativePricing.deliveryCost.amount,'UI rate entry changed the original native amount.');
    assert(same(selected.receipts.map(item=>item.date),priced.receipts.map(item=>item.date)),'UI valuation assigned actual collection dates.');
    assert(same(selected.nativePricing,priced.nativePricing),'UI native price/cost/credit inputs differ from the retained original priced scenario.');
    assert(same(viewed.inputs.fxRates,original.inputs.fxRates),'UI changed the exact original rate source.');
    const id=await saveForecast('save-valued-forecast',viewed);
    journal.steps.priced={state:'PASS',forecastId:id,previewSha256:viewed.previewSha256,originalAmounts:before};await persist();
    await forecast(id);
  }
  async function nativeExportReview(){
    await forecast(journal.steps.priced.forecastId);
    const downloaded=await download('browser-valued-forecast',()=>page.locator('[data-forecast-action=export-forecast]').click());
    const originalJSON=await download('browser-valued-forecast-json',()=>page.locator('[data-forecast-action=export-json]').click());
    const value=JSON.parse(await fs.readFile(path.join(directory,originalJSON.path),'utf8'));
    assert(value.id===journal.steps.priced.forecastId&&value.report.currencyValuation.complete===true,'Original browser download changed its forecast identity or currency coverage.');
    const selected=value.inputs.commercial.find(item=>item.id===ready.browserInput.nativeProjectId);
    const original=(await get('/api/operations/'+ready.caseId+'/forecasts/'+ready.native.pricedForecastId)).body.inputs.commercial.find(item=>item.id===ready.browserInput.nativeProjectId);
    assert(same(selected.nativePricing,original.nativePricing),'Original native quote or cost units were lost.');
    journal.steps.forecastExports={state:'PASS',forecastId:value.id,zip:downloaded,json:originalJSON};await persist();
  }
  async function portfolio(id){
    await page.locator('[data-ops-tab=portfolio]').click();
    const received=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/'+ready.caseId+'/portfolios/'+id&&response.request().method()==='GET');
    await page.locator('select[data-portfolio-saved]').selectOption(id);
    const response=await received;assert(response.ok(),'Original saved allocation could not be reopened.');await response.body();
    await page.waitForFunction(wanted=>{
      const root=document.querySelector('.portfolio');
      return root?.getAttribute('aria-busy')==='false'&&root.querySelector('[data-portfolio-saved]')?.value===wanted&&root.querySelector('[data-portfolio-status]')?.textContent==='Reopened the original saved allocation and its source-bound cash comparison.';
    },id);
    return (await get('/api/operations/'+ready.caseId+'/portfolios/'+id)).body;
  }
  async function nativeControlState(){
    const row=await projectRow(ready.browserInput.nativeProjectId);
    await page.waitForFunction(()=>{
      const root=document.querySelector('.operating-forecast');
      return root?.getAttribute('aria-busy')==='false';
    });
    const mode=await row.locator('[name=pricingMode]').inputValue(),currency=await row.locator('[name=nativeCostCurrency]').inputValue();
    assert(mode==='NATIVE','Original selected native input was changed to a legacy price.');
    assert(await row.locator('[name=priceUsd]').isDisabled(),'The outer app/Operations busy release enabled the legacy USD price.');
    assert(await row.locator('[name=receiptAmount]').first().isDisabled(),'The outer app/Operations busy release enabled a legacy USD milestone.');
    assert(!(await row.locator('[name=nativePriceAmount]').isDisabled()),'The actual native price editor remains blocked after host loading.');
    if(currency==='USD')assert(await row.locator('[name=nativeCostRate]').isDisabled(),'Host loading enabled an inapplicable USD FX selector.');
    return {pricingMode:mode,legacyPriceDisabled:true,legacyMilestoneDisabled:true,nativePriceEditable:true,costCurrency:currency,usdRateDisabled:currency==='USD'?true:null};
  }
  async function portfolioReview(){
    assert(ready.native.unvaluedPortfolioId&&ready.native.pricedPortfolioId,'Original READY lacks its retained allocation identities.');
    const original=(await get('/api/operations/'+ready.caseId+'/forecasts/'+ready.native.pricedForecastId)).body;
    const originalProject=original.inputs.commercial.find(item=>item.id===ready.browserInput.nativeProjectId);
    const prior=Object.values(journal.mutations).find(row=>row.phase==='save-portfolio-selected-forecast'&&JSON.parse(row.rawBody).action==='forecast.save');
    if(prior){
      const recovered=await originalReplay(prior),saved=await verifySavedRequest(prior,recovered.recordId);
      const item=saved.inputs.commercial.find(value=>value.id===ready.browserInput.nativeProjectId);
      assert(same(item.nativePricing,originalProject.nativePricing)&&same(item.receipts,originalProject.receipts)&&same(saved.inputs.fxRates,original.inputs.fxRates),'Recovered allocation selection changed the native quote, receipts or source rates.');
      const selectionArtifact=journal.artifacts['portfolio-date-selection'];assert(selectionArtifact,'Original portfolio selection source is missing.');
      const selectionRaw=await fs.readFile(path.join(directory,selectionArtifact.path));
      assert(sha(selectionRaw)===selectionArtifact.sha256,'Retained original date selection changed.');
      const selection=JSON.parse(selectionRaw);
      assert(same(saved.inputs,{...selection.inputs,name:selection.inputs.name+' — browser selected dates'}),'Recovered selected Forecast differs from its original complete selection.');
      journal.steps.portfolio={...(journal.steps.portfolio||{}),state:'PASS',portfolioId:ready.native.pricedPortfolioId,selectedForecastId:recovered.recordId,selection:selection.selection,previewSha256:saved.previewSha256};await persist();await forecast(recovered.recordId);return;
    }
    const unvalued=await portfolio(ready.native.unvaluedPortfolioId);
    const unvaluedBase=unvalued.report.alternatives.find(item=>item.id==='base');
    assert(unvaluedBase,'Original unvalued allocation lacks its base alternative.');
    assert((await page.locator('[data-portfolio-currency]').innerText()).includes('Valuation incomplete'),'Allocation hides incomplete native valuation.');
    if(unvaluedBase.status==='READY')assert(!(await page.locator('[data-portfolio-action=select-dates]').isDisabled()),'Unknown valuation incorrectly blocks an operationally ready original schedule.');
    const priced=await portfolio(ready.native.pricedPortfolioId);
    const pricedBase=priced.report.alternatives.find(item=>item.id==='base');
    assert(pricedBase?.status==='READY','Original priced allocation is not operationally ready.');
    assert((await page.locator('[data-portfolio-currency]').innerText()).includes('Valuation complete'),'Original allocation lost its priced native scope.');
    await download('original-priced-portfolio',()=>page.locator('[data-portfolio-action=download-portfolio]').click());
    currentPhase='portfolio-date-selection';
    const received=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/operations/'+ready.caseId+'/portfolio-selection'&&response.request().method()==='POST');
    await page.locator('[data-portfolio-action=select-dates]').click();
    const response=await received,raw=Buffer.from(await response.body()),selection=JSON.parse(raw),request=JSON.parse(response.request().postData());
    assert(response.ok()&&request.portfolioId===ready.native.pricedPortfolioId&&request.alternativeId==='base'&&selection.inputs&&selection.selection,'Original allocation selection did not preserve its chosen source.');
    await artifact('portfolio-date-selection',raw,{portfolioId:ready.native.pricedPortfolioId,alternativeId:'base'});
    await page.locator('[data-forecast-form]').waitFor({state:'visible'});
    const controls=await nativeControlState();
    const item=selection.inputs.commercial.find(value=>value.id===ready.browserInput.nativeProjectId);
    assert(same(item.nativePricing,originalProject.nativePricing)&&same(item.receipts,originalProject.receipts)&&same(selection.inputs.fxRates,original.inputs.fxRates),'Date selection altered original native prices, credits, rates or collection dates.');
    await form().locator('[name=name]').fill(selection.inputs.name+' — browser selected dates');
    currentPhase='portfolio-selected-ui';const viewed=await preview();
    assert(same(viewed.inputs,{...selection.inputs,name:selection.inputs.name+' — browser selected dates'}),'The actual Forecast editor lost part of the original selected allocation.');
    const id=await saveForecast('save-portfolio-selected-forecast',viewed);
    journal.steps.portfolio={state:'PASS',portfolioId:ready.native.pricedPortfolioId,unvaluedPortfolioId:ready.native.unvaluedPortfolioId,selectedForecastId:id,selection:selection.selection,previewSha256:viewed.previewSha256,controls};await persist();
    await forecast(id);
  }
  async function portfolioForecastExports(){
    await forecast(journal.steps.portfolio.selectedForecastId);
    const zip=await download('browser-portfolio-selected-forecast',()=>page.locator('[data-forecast-action=export-forecast]').click());
    const full=await download('browser-portfolio-selected-forecast-json',()=>page.locator('[data-forecast-action=export-json]').click());
    const record=JSON.parse(await fs.readFile(path.join(directory,full.path),'utf8'));
    assert(record.id===journal.steps.portfolio.selectedForecastId&&record.previewSha256===journal.steps.portfolio.previewSha256,'Selected Forecast export changed its original native identity.');
    journal.steps.portfolioExports={state:'PASS',forecastId:record.id,zip,json:full};await persist();
  }
  async function mobileReview(){
    await page.setViewportSize({width:390,height:844});
    await page.locator('.operating-forecast').screenshot({path:path.join(directory,'forecast-mobile.png')});
    const overflow=await page.evaluate(()=>({document:document.documentElement.scrollWidth,viewport:innerWidth}));
    assert(overflow.document<=overflow.viewport+2,'The full native forecast overflows the mobile page.');
    await page.setViewportSize({width:1440,height:1050});
    await page.locator('.operating-forecast').screenshot({path:path.join(directory,'forecast-desktop.png')});
    journal.steps.mobile={state:'PASS',width:390,documentWidth:overflow.document};await persist();
  }
  async function wholeExport(){
    await download('browser-complete-case',()=>page.locator('[data-ops-action=export]').click());
    journal.steps.caseExport={state:'PASS'};await persist();
  }
  try{
    await reconcileDownload();
    await openBrowser(await startService('native-currency-ui'));
    if(!journal.steps.legacy)await legacyModeReview();
    if(!journal.steps.unvalued)await unvaluedReview();
    await pricedReview();
    await nativeExportReview();
    await portfolioReview();
    await portfolioForecastExports();
    await mobileReview();
    await wholeExport();
    await closeBrowser();
    await openBrowser(await startService('fresh-original-reopen'));
    await forecast(journal.steps.priced.forecastId);
    const reopened=(await get('/api/operations/'+ready.caseId+'/forecasts/'+journal.steps.priced.forecastId)).body;
    assert(reopened.report.currencyValuation.complete===true,'Fresh service lost the original native forecast valuation.');
    await artifact('fresh-reopened-forecast',json(reopened),{forecastId:reopened.id});
    const reopenedPortfolio=await portfolio(ready.native.pricedPortfolioId);
    assert(reopenedPortfolio.id===ready.native.pricedPortfolioId,'Fresh server changed the original saved allocation.');
    await artifact('fresh-reopened-portfolio',json(reopenedPortfolio),{portfolioId:reopenedPortfolio.id});
    await forecast(journal.steps.portfolio.selectedForecastId);
    const selected=(await get('/api/operations/'+ready.caseId+'/forecasts/'+journal.steps.portfolio.selectedForecastId)).body;
    assert(selected.previewSha256===journal.steps.portfolio.previewSha256&&selected.report.currencyValuation.complete===true,'Fresh service lost the reviewed allocation Forecast.');
    const exported=JSON.parse(await fs.readFile(path.join(directory,journal.artifacts['browser-portfolio-selected-forecast-json'].path),'utf8'));
    const comparable=structuredClone(selected);delete comparable.current;
    assert(same(comparable,exported),'Fresh original service changed a complete saved Forecast or its original source.');
    await artifact('fresh-reopened-selected-forecast',json(selected),{forecastId:selected.id});
    journal.steps.reopen={state:'PASS',forecastId:reopened.id,portfolioId:reopenedPortfolio.id,selectedForecastId:selected.id,sourceVersion:reopened.source.version};await persist();
    await page.locator('#sign-out').click();await page.locator('#access-panel').waitFor({state:'visible'});
    await closeBrowser();assert(!errors.length,'Actual browser errors: '+errors.join('; '));
    const result={...binding,state:'PASS',startedAt:journal.startedAt,completedAt:new Date().toISOString(),steps:journal.steps,artifacts:journal.artifacts,servicesClosed:journal.services.every(row=>row.state==='CLOSED'),browserContextClosed:true,notes:['Original case/source and legacy saves are preserved.','The temporary dated unvalued preview was never saved; native customer collection dates remain unchanged.','Screenshots are local visual inspection and do not form part of the source or customer case package.']};
    assert(result.servicesClosed,'An original service is still open.');await writeAtomic(resultFile,json(result));return result;
  }catch(error){
    journal.lastError={message:error.message,at:new Date().toISOString(),phase:currentPhase};try{await persist();}catch{}
    try{await closeBrowser();}catch(closeError){journal.closeError={message:closeError.message,at:new Date().toISOString()};try{await persist();}catch{}}
    throw error;
  }
  }finally{activeReceivers.delete(runKey);}
}
