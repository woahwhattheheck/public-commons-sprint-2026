// SPDX-License-Identifier: MIT
// Operate the exact maintained Evidence pane and retained reports on an existing accepting browser.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
const run=promisify(execFile);

const OPERATION='LANDSAGE-PARCEL-EVIDENCE-OPERATOR-103D-20261013';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=v=>structuredClone(v);
const check=(ok,message)=>{if(!ok)throw new Error(message);};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function retain(filename,bytes){
  bytes=Buffer.from(bytes);
  await fs.mkdir(path.dirname(filename),{recursive:true,mode:0o700});
  const temporary=filename+'.pending-'+crypto.randomUUID();
  let handle;
  try{
    handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await fs.link(temporary,filename);}
    catch(error){if(error.code!=='EEXIST')throw error;check((await fs.readFile(filename)).equals(bytes),'The original receiving file changed: '+filename);}
    const directory=await fs.open(path.dirname(filename),'r');
    try{await directory.sync();}finally{await directory.close();}
  }finally{if(handle)await handle.close();await fs.unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {path:filename,bytes:bytes.length,sha256:hash(bytes)};
}
async function verifyDescriptor(item){
 check(item&&typeof item.path==='string'&&Number.isSafeInteger(item.bytes)&&item.bytes>=0&&/^[a-f0-9]{64}$/.test(item.sha256||''),'Use a complete original output descriptor.');
 const handle=await fs.open(item.path,'r');
 try{
  const before=await handle.stat();check(before.isFile()&&before.size===item.bytes,'The original output size changed: '+item.path);
  const digest=crypto.createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
  while(offset<before.size){const {bytesRead}=await handle.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);check(bytesRead>0,'The original output was truncated: '+item.path);digest.update(buffer.subarray(0,bytesRead));offset+=bytesRead;}
  const after=await handle.stat(),named=await fs.lstat(item.path);
  const same=value=>value.dev===before.dev&&value.ino===before.ino&&value.size===before.size&&value.mtimeMs===before.mtimeMs&&value.ctimeMs===before.ctimeMs;
  check(!named.isSymbolicLink()&&same(after)&&same(named)&&digest.digest('hex')===item.sha256,'The completed original output changed: '+item.path);
 }finally{await handle.close();}
}
async function json(filename,value){return retain(filename,Buffer.from(JSON.stringify(value,null,2)+'\n'));}

const stable=value=>JSON.stringify(order(value));
function order(value){return Array.isArray(value)?value.map(order):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,order(value[k])])):value;}
async function readJSON(filename){try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function matches(body,spec){return body&&body.action===spec.action&&body.actor===spec.actor&&stable(body.payload)===stable(spec.payload);}
function fromOperation(row,spec,inputs){
  const value=row.input;
  check(value&&value.workspaceId===inputs.workspaceId&&value.workspaceDirectory===inputs.workspace&&matches(value,spec),
    'The selected original operation has a different workspace, actor, action or complete payload.');
  return {requestId:row.requestId,action:value.action,payload:value.payload,revision:value.revision,actor:value.actor};
}
async function storedBrowserRequests(page,inputs){
  return page.evaluate(async workspaceId=>{
    const requests=[];
    const draft=JSON.parse(localStorage.getItem('starforge-qgis-analyst:'+workspaceId)||'{}');
    for(const value of Object.values(draft.pending||{}))if(value.body)requests.push({...value.body,_pending:true});
    const db=await new Promise((resolve,reject)=>{
      const open=indexedDB.open('starforge-parcel-evidence-v1',1);
      open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);
      open.onupgradeneeded=()=>open.transaction.abort();
    });
    try{
      const records=await new Promise((resolve,reject)=>{
        const tx=db.transaction('records','readonly'),q=tx.objectStore('records').getAll();
        q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);
      });
      for(const row of records)if(row.key.startsWith(workspaceId+':')&&row.value?.request&&
        row.value.context?.workspaceDirectory)requests.push({...row.value.request,
          _workspaceDirectory:row.value.context.workspaceDirectory,_pending:row.key===workspaceId+':pending'});
    }finally{db.close();}
    return requests;
  },inputs.workspaceId);
}
async function findOriginalRequest(page,inputs,spec,filename){
  let request=await readJSON(filename);
  if(request){check(matches(request,spec),'The retained original phase request changed.');return request;}
  const candidates=new Map();
  for(const body of await storedBrowserRequests(page,inputs)){
    if(body._workspaceDirectory&&body._workspaceDirectory!==inputs.workspace)continue;
    if(matches(body,spec)){const value=clone(body);delete value._workspaceDirectory;delete value._pending;candidates.set(value.requestId,value);}
  }
  let offset=0;
  while(true){
    const p=await api(page,'/api/operations?offset='+offset+'&limit=100');
    for(const item of p.items){
      if(!/^(evidence|analyst)-/.test(item.requestId)||item.action!==spec.action||item.actor!==spec.actor)continue;
      const row=await api(page,'/api/operations/'+encodeURIComponent(item.requestId));
      if(row.input?.workspaceId===inputs.workspaceId&&row.input.workspaceDirectory===inputs.workspace&&matches(row.input,spec)){
        const body=fromOperation(row,spec,inputs);
        const old=candidates.get(body.requestId);check(!old||stable(old)===stable(body),'Browser and original journal request bodies differ.');
        candidates.set(body.requestId,body);
      }
    }
    if(p.complete)break;
    check(p.items.length>0,'The original operation inventory did not advance.');offset+=p.items.length;
  }
  check(candidates.size<=1,'Several original browser requests match this exact phase. Preserve all IDs and reconcile the original accepted result.');
  request=[...candidates.values()][0];
  if(request)await json(filename,request);
  return request||null;
}
async function exactOperation(page,request,inputs,spec,timeout){
  const end=Date.now()+timeout;
  let response=await page.evaluate(async id=>{
    const token=sessionStorage.getItem('qgis-token:'+location.origin);
    const r=await fetch('/api/operations/'+encodeURIComponent(id),{cache:'no-store',headers:{'X-Starforge-Qgis-Workspace':token||''}});
    return {status:r.status,body:await r.json()};
  },request.requestId);
  if(response.status===404&&response.body?.error==='ANALYST_REQUEST_NOT_FOUND'){
    // A previous route was durably recorded before POST, or the original browser retained an unsent request.
    // Only this exact original body is retried; a new UUID is never constructed here.
    response=await page.evaluate(async body=>{
      const token=sessionStorage.getItem('qgis-token:'+location.origin);
      const r=await fetch('/api/operations',{method:'POST',headers:{'Content-Type':'application/json',
        'X-Starforge-Qgis-Workspace':token||''},body:JSON.stringify(body)});
      return {status:r.status,body:await r.json()};
    },request);
  }
  check(response.status>=200&&response.status<300,'Receive the original saved phase: '+JSON.stringify(response));
  while(true){
    const row=response.body,body=fromOperation(row,spec,inputs);
    check(stable(body)===stable(request),'The original request changed after dispatch.');
    if(row.status==='COMPLETED')return row;
    if(['FAILED','INTERRUPTED','CANCELLED'].includes(row.status))throw new Error('Original '+request.requestId+' remains '+row.status+'; retain its exact input and use the maintained original continuation: '+JSON.stringify(row.error));
    check(Date.now()<end,'The original phase is still running; retain '+request.requestId+' for continuation.');
    await sleep(600);response={status:200,body:await api(page,'/api/operations/'+encodeURIComponent(request.requestId))};
  }
}
async function originalPhase(page,inputs,stateDirectory,name,spec,click,timeout){
  const filename=path.join(stateDirectory,'original-browser-'+name+'-request.json');
  await json(path.join(stateDirectory,'original-browser-'+name+'-selection.json'),
    {workspaceId:inputs.workspaceId,workspaceDirectory:inputs.workspace,...spec});
  let request=await findOriginalRequest(page,inputs,spec,filename);
  if(!request){
    // The route cannot reach the original listener before the exact UUID/body has a durable file.
    let resolveRoute,rejectRoute;
    const captured=new Promise((resolve,reject)=>{resolveRoute=resolve;rejectRoute=reject;});
    captured.catch(()=>{});
    const matcher='**/api/operations';
    const handler=async route=>{
      const sent=route.request();
      if(sent.method()!=='POST')return route.continue();
      let body;
      try{
        body=sent.postDataJSON();
        check(matches(body,spec),'A different operation was submitted while this original phase owned dispatch.');
        check(typeof body.requestId==='string'&&Number.isSafeInteger(body.revision),'The original browser request is incomplete.');
        await json(filename,body);request=body;
        await route.continue();resolveRoute(body);
      }catch(error){await route.abort().catch(()=>{});rejectRoute(error);}
    };
    await page.route(matcher,handler);
    let timer;
    try{
      await click();
      request=await Promise.race([captured,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('No original request dispatch was observed. Inspect the retained browser draft and phase before retrying.')),60000);})]);
    }finally{clearTimeout(timer);await page.unroute(matcher,handler);}
  }
  const result=await exactOperation(page,request,inputs,spec,timeout);
  const saved=path.join(stateDirectory,'original-browser-'+name+'-result.json'),prior=await readJSON(saved);
  if(prior){
    check(prior.requestId===result.requestId&&prior.inputSha256===result.inputSha256&&stable(prior.result)===stable(result.result),
      'The original completed phase result changed.');
    return {request,result:prior};
  }
  await json(saved,result);return {request,result};
}
async function inspectOriginalInHistory(page,id){
  await page.getByRole('button',{name:'History',exact:true}).click();
  await page.getByLabel('Saved request ID',{exact:true}).fill(id);
  await page.getByRole('button',{name:'Open original request',exact:true}).click();
  await page.getByRole('button',{name:'Refresh request',exact:true}).waitFor();
}


const REPORT_TITLE='Bloomington original parcel — operated browser report';
const REPORT_INTERPRETATION='Complete original case received through the desktop operator. Exact source roles, partial parcel coverage, named review, same-byte software source edition and unresolved jurisdiction/professional questions are retained. Actual native maps and geometry remain separately bound to their completed original requests.';
function reportSpec(inputs,reviewer){return {action:'evidence.command',actor:reviewer.trim(),payload:{action:'report.build',payload:{
  caseId:inputs.caseId,caseVersionId:inputs.caseVersionId,title:REPORT_TITLE,interpretation:REPORT_INTERPRETATION,mapRequestIds:clone(inputs.nativeMapRequestIds||[])}}};}
function comparisonSpec(inputs,reviewer){return {action:'evidence.command',actor:reviewer.trim(),payload:{action:'source.compare',payload:{
  caseId:inputs.caseId,leftSourceId:inputs.sourceIds.fema_selected_parcel_query,rightSourceId:inputs.sourceIds['fema-software-edition']}}};}
async function recoverCoursePending(page,inputs,stateDirectory,reviewer,timeout){
  const pending=(await storedBrowserRequests(page,inputs)).filter(row=>row._pending);
  const unique=new Map(pending.map(row=>[row.requestId,row]));
  for(const row of unique.values()){
    check(!row._workspaceDirectory||row._workspaceDirectory===inputs.workspace,'Another original workspace has pending work.');
    const exportSpec={action:'project.export',payload:{directory:path.join(stateDirectory,'editable-handover')},actor:reviewer.trim()};
    let name,spec;
    for(const [key,value]of [['report',reportSpec(inputs,reviewer)],['source-comparison',comparisonSpec(inputs,reviewer)],['export',exportSpec]]){
      if(matches(row,value)){name=key;spec=value;break;}
    }
    if(!spec&&row.action==='project.receive'){
      const prior=await originalPhase(page,inputs,stateDirectory,'export',exportSpec,()=>{throw new Error('Receive the original export before its pending receiving request.');},timeout);
      spec={action:'project.receive',payload:{file:prior.result.result.path,destination:path.join(stateDirectory,'received-operated-workspace'),expectedSha256:prior.result.result.sha256},actor:reviewer.trim()};
      check(matches(row,spec),'A different receiving request is pending; preserve it.');name='receive';
    }
    check(spec,'Another user operation is pending; preserve its original request before this course proceeds.');
    const request=clone(row);delete request._pending;delete request._workspaceDirectory;
    await json(path.join(stateDirectory,'original-browser-'+name+'-request.json'),request);
    await originalPhase(page,inputs,stateDirectory,name,spec,()=>{throw new Error('Retain the already selected original request.');},timeout);
  }
  await receivePending(page,timeout);
}

async function api(page,url){
  const value=await page.evaluate(async url=>{
    const token=sessionStorage.getItem('qgis-token:'+location.origin);
    const response=await fetch(url,{cache:'no-store',headers:{'X-Starforge-Qgis-Workspace':token||''}});
    return {status:response.status,body:await response.json()};
  },url);
  check(value.status>=200&&value.status<300,'Original receiving read '+url+' returned '+value.status+': '+JSON.stringify(value.body));
  return value.body;
}
async function catalog(page){return api(page,'/api/evidence');}
async function snapshot(page,id){return api(page,'/api/evidence/cases/'+encodeURIComponent(id)+'/snapshot');}
async function operation(page,id,timeout){
  const end=Date.now()+timeout;
  while(true){
    const row=await api(page,'/api/operations/'+encodeURIComponent(id));
    if(row.status==='COMPLETED')return row;
    if(['FAILED','INTERRUPTED'].includes(row.status))throw new Error('Original request '+id+' remains '+row.status+': '+JSON.stringify(row.error));
    check(Date.now()<end,'Original request '+id+' is still retained; keep that ID for continuation.');
    await sleep(600);
  }
}
async function waitUntil(read,predicate,timeout,label){
  const end=Date.now()+timeout;while(true){const v=await read();if(predicate(v))return v;check(Date.now()<end,label);await sleep(200);}
}
async function download(page,click,directory,label,expected){
  const completed=page.waitForEvent('download',{timeout:60000});
  await click();
  const item=await completed;
  check(await item.failure()===null,'The original download failed: '+label);
  const temporary=await item.path();
  const bytes=await fs.readFile(temporary);
  if(expected){check(bytes.length===expected.bytes&&hash(bytes)===expected.sha256,'Downloaded original bytes differ: '+label);}
  return retain(path.join(directory,label),bytes);
}
async function getRows(page,caseId,kind){
  let offset=0,result=[];
  while(true){
    const p=await api(page,'/api/evidence/cases/'+encodeURIComponent(caseId)+'/'+kind+'?offset='+offset+'&limit=100');
    result.push(...p.items);if(p.complete)return result;
    check(p.items.length>0,'The original '+kind+' page did not advance.');offset+=p.items.length;
  }
}
async function connect(page,url,inputs,reviewer,width){
  await page.setViewportSize({width,height:900});
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByLabel('Responsible analyst',{exact:true}).waitFor({timeout:60000});
  await page.getByLabel('Responsible analyst',{exact:true}).fill(reviewer);
  await page.getByRole('button',{name:'Evidence',exact:true}).click();
  await page.getByTestId('evidence-workbench').waitFor();
  const c=await catalog(page);check(c.workspaceId===inputs.workspaceId,'The browser belongs to a different original workspace.');
  await page.getByLabel('Current case',{exact:true}).selectOption(inputs.caseId);
  await page.getByTestId('evidence-workbench').getByRole('button',{name:'Refresh saved evidence',exact:true}).click();
  await page.getByLabel('Current case',{exact:true}).waitFor();
  check((await snapshot(page,inputs.caseId)).case.id===inputs.caseVersionId,'The selected original case edition changed.');
}
function workbench(page){return page.getByTestId('evidence-workbench');}
async function tab(page,name){
  await workbench(page).getByRole('navigation',{name:'Evidence workflow'}).getByRole('button',{name,exact:true}).click();
}
async function shot(page,directory,name,images){
  const result=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,
    errors:[...document.querySelectorAll('[role="alert"]')].map(x=>x.textContent)}));
  check(result.pageWidth<=result.width+2,'The actual page overflows its viewport: '+name+' '+JSON.stringify(result));
  const filename=path.join(directory,name+'.png');
  await page.screenshot({path:filename,fullPage:true});
  const bytes=await fs.readFile(filename);images.push({path:filename,bytes:bytes.length,sha256:hash(bytes),viewport:await page.viewportSize()});
}
async function receivePending(page,timeout){
  const button=workbench(page).getByRole('button',{name:'Receive saved outcome',exact:true});
  const end=Date.now()+timeout;
  while(await button.count()){
    check(Date.now()<end,'Retain the original browser pending request for continued receiving.');
    if(await button.isEnabled())await button.click();
    await sleep(350);
  }
}
async function sourceAndCase(page,inputs,directory,images,downloads,width){
  await tab(page,'Sources');
  const c=await catalog(page);const source=c.sources.find(s=>s.id===inputs.sourceIds.parcel);
  check(source,'The original parcel source is missing.');
  await workbench(page).getByRole('button',{name:source.title,exact:true}).click();
  await workbench(page).getByText('Complete original record',{exact:true}).click();
  await shot(page,directory,'sources-'+width,images);
  if(width>600){
    const row=workbench(page).locator('tr').filter({has:page.getByRole('button',{name:source.title,exact:true})});
    downloads.push(await download(page,()=>row.getByRole('link',{name:'Download original file',exact:true}).click(),
      directory,'original-parcel.json',source.file));
  }
  await tab(page,'Case & subjects');
  await workbench(page).getByRole('button',{name:'Inspect complete original case and all history',exact:true}).click();
  const detail=workbench(page).getByText('Complete original record',{exact:true});
  if(await detail.count())await detail.click();
  await shot(page,directory,'case-and-subjects-'+width,images);
  if(width>600){
    const saved=await download(page,()=>workbench(page).getByRole('button',{name:'Download complete current case snapshot',exact:true}).click(),
      directory,'complete-case-snapshot.json');
    const body=JSON.parse(await fs.readFile(saved.path,'utf8'));
    check(body.case.caseId===inputs.caseId&&body.case.id===inputs.caseVersionId,'The downloaded case selection changed.');
    check(body.case.subjects.some(s=>s.feature?.coverage?.exceededTransferLimit===true),'The actual partial parcel coverage must remain visible in the downloaded case.');
    downloads.push(saved);
  }
  await tab(page,'Findings');
  check((await snapshot(page,inputs.caseId)).currentFindings.length>=4,'The original populated finding workflow is incomplete.');
  await shot(page,directory,'findings-'+width,images);
}
async function draftRecovery(page,url,inputs,reviewer,directory,images,stateDirectory){
  await tab(page,'Findings');
  const selected=(await snapshot(page,inputs.caseId)).currentFindings.find(x=>x.classification==='SOURCE_FACT');
  await workbench(page).getByRole('button',{name:selected.title,exact:true}).click();
  const field=workbench(page).getByLabel('Source fact, interpretation or exact question',{exact:true});
  const draftFile=path.join(stateDirectory,'original-browser-draft-selection.json');
  let baseline=await readJSON(draftFile);
  const current=await field.inputValue();
  if(!baseline){baseline={findingId:selected.findingId,versionId:selected.id,original:current,draft:current+'\nBrowser receiving draft: retained locally for the original operator, not a saved finding.'};await json(draftFile,baseline);}
  check(baseline.findingId===selected.findingId&&baseline.versionId===selected.id,'The original draft receiving source changed.');
  check(current===baseline.original||current===baseline.draft,'A later operator draft is present; preserve it before continuing this original receiving phase.');
  const {original,draft}=baseline;
  await field.fill(draft);
  await tab(page,'Recovery'); // Navigation drains the original persistence tail.
  const before=await download(page,()=>workbench(page).getByRole('button',{name:'Download complete browser recovery',exact:true}).click(),
      directory,'browser-recovery-with-draft.json');
  const exported=JSON.parse(await fs.readFile(before.path,'utf8'));
  check(JSON.stringify(exported).includes(draft),'The browser recovery omitted the complete selected draft.');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.getByTestId('evidence-workbench').waitFor();
  await page.getByLabel('Current case',{exact:true}).selectOption(inputs.caseId);
  await tab(page,'Findings');
  await workbench(page).getByRole('button',{name:selected.title,exact:true}).click();
  check(await workbench(page).getByLabel('Source fact, interpretation or exact question',{exact:true}).inputValue()===draft,
        'The original finding draft did not survive reload.');
  await shot(page,directory,'draft-reopened-desktop',images);
  await workbench(page).getByLabel('Source fact, interpretation or exact question',{exact:true}).fill(original);
  await tab(page,'Recovery');
  const restored=await download(page,()=>workbench(page).getByRole('button',{name:'Download complete browser recovery',exact:true}).click(),
      directory,'browser-recovery-restored-draft.json');
  check((await snapshot(page,inputs.caseId)).currentFindings.find(x=>x.findingId===selected.findingId).id===selected.id,
        'Editing an unsaved draft changed the authoritative finding.');
  return [before,restored];
}
async function sourceComparison(page,inputs,directory,images,timeout,stateDirectory,reviewer){
  await tab(page,'Later sources');
  await workbench(page).getByLabel('Earlier source',{exact:true}).selectOption(inputs.sourceIds.fema_selected_parcel_query);
  await workbench(page).getByLabel('Later edition from the same declared series',{exact:true}).selectOption(inputs.sourceIds['fema-software-edition']);
  const adopt=workbench(page).getByRole('button',{name:'Keep draft and adopt reviewed current basis',exact:true});
  if(await adopt.count()&&await adopt.isEnabled())await adopt.click();
  const phase=await originalPhase(page,inputs,stateDirectory,'source-comparison',
    {action:'evidence.command',actor:reviewer.trim(),payload:{action:'source.compare',payload:{
      caseId:inputs.caseId,leftSourceId:inputs.sourceIds.fema_selected_parcel_query,rightSourceId:inputs.sourceIds['fema-software-edition']}}},
    ()=>workbench(page).getByRole('button',{name:'Inspect all impacted current decisions',exact:true}).click(),timeout);
  await receivePending(page,timeout);
  const comparison=workbench(page).getByText('Exact changed metadata, file identities and impacted subjects',{exact:true});
  if(!await comparison.count()){
    // A fresh browser can inspect the original retained outcome without dispatching a new comparison.
    check(phase.result.result.sameOriginalBytes===true,'The retained original comparison changed its source meaning.');
    await inspectOriginalInHistory(page,phase.request.requestId);
    await page.getByText('Saved result',{exact:true}).click();
    await shot(page,directory,'complete-source-succession-desktop',images);
    await page.getByRole('button',{name:'Evidence',exact:true}).click();
    return;
  }
  await comparison.waitFor();
  await workbench(page).getByText('Exact changed metadata, file identities and impacted subjects',{exact:true}).click();
  await shot(page,directory,'complete-source-succession-desktop',images);
  check(await workbench(page).getByText('Both editions retain identical original bytes; applicability still needs named review.',{exact:true}).count(),
        'The actual source comparison lost its same-byte meaning.');
}
async function buildReport(page,inputs,directory,images,timeout,stateDirectory,reviewer){
  const title=REPORT_TITLE;
  const interpretation=REPORT_INTERPRETATION;
  let reports=await getRows(page,inputs.caseId,'reports');
  let selected=reports.filter(r=>r.title===title&&r.interpretation===interpretation&&r.caseVersionId===inputs.caseVersionId);
  check(selected.length<=1,'More than one original operated report matches; receive the exact earlier request before dispatching again.');
  await tab(page,'Reports');
  if(!selected.length){
    await workbench(page).getByLabel('Report title',{exact:true}).fill(title);
    await workbench(page).getByLabel('Full interpretation and remaining questions',{exact:true}).fill(interpretation);
    if(inputs.nativeMapRequestIds?.length){
      await workbench(page).getByRole('button',{name:'Read existing completed map renders',exact:true}).click();
      for(const id of inputs.nativeMapRequestIds)await workbench(page).getByLabel(id,{exact:true}).check();
    }
    const adopt=workbench(page).getByRole('button',{name:'Keep draft and adopt reviewed current basis',exact:true}).first();
    if(await adopt.count()&&await adopt.isEnabled())await adopt.click();
    const spec={action:'evidence.command',actor:reviewer.trim(),payload:{action:'report.build',payload:{
      caseId:inputs.caseId,caseVersionId:inputs.caseVersionId,title,interpretation,mapRequestIds:clone(inputs.nativeMapRequestIds||[])}}};
    const phase=await originalPhase(page,inputs,stateDirectory,'report',spec,
      ()=>workbench(page).getByRole('button',{name:'Build complete frozen report',exact:true}).click(),timeout);
    await receivePending(page,timeout);
    selected=[phase.result.result.report];
  }else{
    const phase=await originalPhase(page,inputs,stateDirectory,'report',reportSpec(inputs,reviewer),()=>{throw new Error('The saved report must retain its original browser request.');},timeout);
    check(phase.result.result.report.id===selected[0].id,'The selected saved report differs from its original phase result.');
  }
  const report=selected[0];
  await workbench(page).getByRole('button',{name:'Refresh saved evidence',exact:true}).click();
  await tab(page,'Reports');
  await shot(page,directory,'reports-desktop',images);
  const row=workbench(page).locator('tr').filter({has:page.getByText(title,{exact:true})});
  const zip=await download(page,()=>row.getByRole('link',{name:'Complete report ZIP',exact:true}).click(),
      directory,'operated-complete-report.zip',report.archive);
  const caseJSON=await download(page,()=>row.getByRole('link',{name:'Full case JSON',exact:true}).click(),
      directory,'operated-report-case.json');
  check(JSON.parse(await fs.readFile(caseJSON.path,'utf8')).case.caseId===inputs.caseId,'The report download changed cases.');
  const csv=[];
  for(const [label,filename]of [['Findings CSV','operated-findings.csv'],['Actions CSV','operated-actions.csv']]){
    csv.push(await download(page,()=>row.getByRole('link',{name:label,exact:true}).click(),directory,filename));
  }
  return {report,downloads:[zip,caseJSON,...csv]};
}
async function renderedReport(context,report,inputs,directory,images,zip,python){
  const extracted=path.join(directory,'complete-operated-report');
  const program="import hashlib,json,pathlib,stat,sys,zipfile\nroot=pathlib.Path(sys.argv[2]).absolute();root.mkdir(parents=True,exist_ok=True,mode=0o700)\nwith zipfile.ZipFile(sys.argv[1]) as z:\n names=z.namelist()\n if len(names)!=len(set(names)): raise ValueError(\"Duplicate report member\")\n manifest=json.loads(z.read(\"manifest.json\")); records={r[\"path\"]:r for r in manifest[\"files\"]}\n if set(names)!=set(records)|{\"manifest.json\"}: raise ValueError(\"Incomplete report inventory\")\n for name in names:\n  p=pathlib.PurePosixPath(name);i=z.getinfo(name)\n  if p.is_absolute() or \"\\\\\" in name or any(x in (\"\",\".\",\"..\") for x in name.split(\"/\")) or i.is_dir() or stat.S_ISLNK(i.external_attr>>16): raise ValueError(\"Unsafe original report member\")\n  b=z.read(name)\n  if name in records and (len(b)!=records[name][\"bytes\"] or hashlib.sha256(b).hexdigest()!=records[name][\"sha256\"]): raise ValueError(\"Changed original report member\")\n  target=root.joinpath(*p.parts)\n  q=root\n  for part in p.parts:\n   q=q/part\n   if q.is_symlink(): raise ValueError(\"Symlink receiving member\")\n  target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)\n  if target.exists():\n   if target.read_bytes()!=b: raise ValueError(\"Changed retained original member\")\n  else:\n   with target.open(\"xb\") as out: out.write(b)\n print(json.dumps({\"files\":len(names),\"directory\":str(root)}))\n";
  await run(python,['-c',program,zip.path,extracted],{timeout:120000,maxBuffer:1048576});
  const reportPage=await context.newPage();
  try{
    // Open the actual complete downloaded report with all original sibling source files.
    const url=pathToFileURL(path.join(extracted,'OPEN.html')).href;
    await reportPage.setViewportSize({width:1280,height:900});
    const response=await reportPage.goto(url,{waitUntil:'domcontentloaded'});
    check(!response||response.ok(),'The actual original report did not open.');
    await reportPage.getByRole('heading',{name:report.title,exact:true}).waitFor();
    await shot(reportPage,directory,'actual-report-desktop',images);
    const mapCount=await reportPage.locator('figure img').count();
    check(mapCount===(inputs.nativeMapRequestIds||[]).length,'The actual rendered report lost a selected original native map.');
    for(const image of await reportPage.locator('figure img').all()){
      check(await image.evaluate(n=>n.complete&&n.naturalWidth>0),'A retained original native map did not render.');
    }
    await reportPage.pdf({path:path.join(directory,'operated-report.pdf'),format:'A4',printBackground:true,preferCSSPageSize:true});
    await reportPage.setViewportSize({width:390,height:844});
    await shot(reportPage,directory,'actual-report-phone',images);
  }finally{await reportPage.close();}
}
async function editableExport(page,inputs,directory,timeout,stateDirectory,reviewer){
  await tab(page,'Reports');
  const exportDirectory=path.join(stateDirectory,'editable-handover');
  await workbench(page).getByLabel('Optional new archive directory on this host',{exact:true}).fill(exportDirectory);
  const basis=workbench(page).getByRole('button',{name:'Keep draft and adopt reviewed current basis',exact:true}).last();
  if(await basis.count()&&await basis.isEnabled())await basis.click();
  const phase=await originalPhase(page,inputs,stateDirectory,'export',
    {action:'project.export',payload:{directory:exportDirectory},actor:reviewer.trim()},
    ()=>workbench(page).getByRole('button',{name:'Export complete editable workspace',exact:true}).click(),timeout);
  await receivePending(page,timeout);
  // Recover the exact completed operation through the original user-visible History, even if a prior browser receipt was lost.
  await inspectOriginalInHistory(page,phase.request.requestId);
  const archived=await download(page,()=>page.getByRole('link',{name:'Download complete project archive',exact:true}).click(),
      directory,'operated-editable-project.zip',phase.result.result);
  await page.getByRole('button',{name:'Evidence',exact:true}).click();
  await tab(page,'Reports');
  return {request:phase.request.requestId,result:phase.result.result,download:archived};
}
async function receiveEditable(page,inputs,exported,directory,timeout,stateDirectory,reviewer){
  await workbench(page).getByRole('button',{name:'Open original project receiving',exact:true}).click();
  const destination=path.join(stateDirectory,'received-operated-workspace');
  await page.getByLabel('Expected complete archive SHA-256',{exact:true}).fill(exported.result.sha256);
  await page.getByLabel('Original complete archive on this host',{exact:true}).fill(exported.result.path);
  await page.getByLabel('New independent receiving directory on this host',{exact:true}).fill(destination);
  const phase=await originalPhase(page,inputs,stateDirectory,'receive',
    {action:'project.receive',payload:{file:exported.result.path,destination,expectedSha256:exported.result.sha256},actor:reviewer.trim()},
    ()=>page.getByRole('button',{name:'Receive complete original project',exact:true}).click(),timeout);
  const result=phase.result;
  check(result.result.state.id===inputs.workspaceId&&result.result.receipt.sha256===exported.result.sha256,
        'The browser receiving changed the original project or selected archive.');
  await inspectOriginalInHistory(page,phase.request.requestId);
  await page.getByRole('button',{name:'Transfers',exact:true}).click();
  await page.getByText('Received project',{exact:true}).waitFor();
  return result.result;
}

/**
 * Uses one existing accepting Playwright Page/context and the original application.
 * openReceived(directory) must launch/reuse the same maintained analyst on that received directory,
 * return {url,close?}, and retain lifecycle ownership until this function closes it.
 */
export async function reviewEvidenceBrowser({page,url,inputs,directory,reviewer,openReceived,pythonExecutable='python3',operationTimeoutMs=180000}){
  check(inputs.schema==='commons.landsage-browser-inputs/v1'&&inputs.operationId===OPERATION,'Use the original backend course input.');
  check(typeof reviewer==='string'&&reviewer.trim(),'Name the actual receiving operator.');
  check(typeof openReceived==='function','Supply the original maintained listener opener for the independently received workspace.');
  await fs.mkdir(directory,{recursive:true,mode:0o700});
  const stateDirectory=path.resolve(directory);
  await json(path.join(stateDirectory,'original-browser-inputs.json'),inputs);
  await json(path.join(stateDirectory,'original-browser-reviewer.json'),{reviewer:reviewer.trim()});
  const completed=await readJSON(path.join(stateDirectory,'rendered-receiving-result.json'));
  if(completed){
    check(completed.operationId===OPERATION&&completed.workspaceId===inputs.workspaceId&&completed.caseId===inputs.caseId&&completed.caseVersionId===inputs.caseVersionId,'The completed original browser course belongs to another selection.');
    for(const file of [...completed.images,...completed.downloads,completed.printedReport]){
      await verifyDescriptor(file);
    }
    return completed;
  }
  directory=await fs.mkdtemp(path.join(stateDirectory,'capture-attempt-'));
  const images=[],downloads=[],context=page.context(),errors=[];
  const onError=error=>errors.push(String(error));page.on('pageerror',onError);
  let receivedListener,primaryError;
  try{
    await connect(page,url,inputs,reviewer,1280);
    await recoverCoursePending(page,inputs,stateDirectory,reviewer,operationTimeoutMs);
    await sourceAndCase(page,inputs,directory,images,downloads,1280);
    downloads.push(...await draftRecovery(page,url,inputs,reviewer,directory,images,stateDirectory));
    await sourceComparison(page,inputs,directory,images,operationTimeoutMs,stateDirectory,reviewer);
    const built=await buildReport(page,inputs,directory,images,operationTimeoutMs,stateDirectory,reviewer);
    downloads.push(...built.downloads);
    await renderedReport(context,built.report,inputs,directory,images,built.downloads[0],pythonExecutable);
    await page.setViewportSize({width:390,height:844});
    await sourceAndCase(page,inputs,directory,images,downloads,390);
    for(const pane of ['Later sources','Spatial','Reports','Recovery']){
      await tab(page,pane);await shot(page,directory,pane.toLowerCase().replaceAll(' ','-')+'-phone',images);
    }
    await page.setViewportSize({width:1280,height:900});
    const exported=await editableExport(page,inputs,directory,operationTimeoutMs,stateDirectory,reviewer);
    downloads.push(exported.download);
    const received=await receiveEditable(page,inputs,exported,directory,operationTimeoutMs,stateDirectory,reviewer);
    await shot(page,directory,'independent-browser-receiving-desktop',images);
    receivedListener=await openReceived(received.directory);
    check(receivedListener&&typeof receivedListener.url==='string','The maintained received listener did not return its actual private URL.');
    await connect(page,receivedListener.url,inputs,reviewer,1280);
    const reopened=await snapshot(page,inputs.caseId);
    check(reopened.currentFindings.length>=4&&reopened.history.successions.length>=1,
          'The independently opened application lost original findings or complete source decisions.');
    await tab(page,'Reports');
    check((await getRows(page,inputs.caseId,'reports')).some(r=>r.id===built.report.id),'The received application omitted the browser-built report.');
    await shot(page,directory,'reopened-original-evidence-desktop',images);
    await page.setViewportSize({width:390,height:844});
    await tab(page,'Findings');await shot(page,directory,'reopened-original-evidence-phone',images);
    check(errors.length===0,'The actual application reported uncaught errors: '+errors.join('\n'));
    const pdf=await fs.readFile(path.join(directory,'operated-report.pdf'));
    const result={schema:'commons.landsage-rendered-receiving/v1',operationId:OPERATION,state:'RENDERED_AWAITING_VISUAL_INSPECTION',
      workspaceId:inputs.workspaceId,caseId:inputs.caseId,caseVersionId:inputs.caseVersionId,reportId:built.report.id,
      actualBrowser:await context.browser()?.version(),viewports:[1280,390],images,downloads,
      printedReport:{path:path.join(directory,'operated-report.pdf'),bytes:pdf.length,sha256:hash(pdf)},
      editableExport:exported.result,coldReceipt:received.receipt,receivedDirectory:received.directory,
      reviewedScreens:[],meaning:'The exact populated UI and real report were operated and captured. The receiving operator must LOOK at the retained screens and printed pages and record any fixes before customer-ready delivery.'};
    await json(path.join(stateDirectory,'rendered-receiving-result.json'),result);return result;
  }catch(error){primaryError=error;throw error;}
  finally{
    page.off('pageerror',onError);
    if(receivedListener?.close){try{await receivedListener.close();}catch(error){if(primaryError)throw new AggregateError([primaryError,error],'Original browser receiving failed and its owned listener cleanup also failed.');throw error;}}
  }
}
