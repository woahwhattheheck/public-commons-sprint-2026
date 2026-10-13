import {readFile,mkdir,open,rename,stat,readlink,chmod,readdir,unlink} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {gunzipSync} from 'node:zlib';
import * as Model from '../../products/curriculum-migration-workbench/app/model.mjs';
import * as Curriculum from '../../products/curriculum-migration-workbench/app/curriculum-migration.mjs';
import {generateSdk} from '../../products/curriculum-migration-workbench/app/generate-sdk.mjs';
const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
if(config.schema!=='stellar-forge.curriculum-managed-browser.v1')throw Error('Use the original complete managed browser input.');
const operation=config.operationId,root=process.cwd(),out=resolve(config.directory);
const inputPath=config.acceptedWorkspaceFile,guard=Number(process.env.CURRICULUM_RECEIVING_GUARD_FD);
if(!inputPath||!Number.isInteger(guard)||guard<3)throw Error('Use the owned managed receiving course.');
await stat('/proc/self/fd/'+guard);
const sha=b=>createHash('sha256').update(b).digest('hex'),canonical=Model.canonical,require=createRequire(import.meta.url);
const equal=(a,b)=>canonical(a)===canonical(b);
function requireThat(value,message){if(!value)throw Error(message);}
async function maybe(path){try{return await readFile(path);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function syncDir(path){const fd=await open(path,'r');try{await fd.sync();}finally{await fd.close();}}
async function atomic(path,bytes){await mkdir(dirname(path),{recursive:true});const temporary=path+'.new-'+randomUUID(),fd=await open(temporary,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}await rename(temporary,path);await syncDir(dirname(path));}
async function fixed(path,bytes){const present=await maybe(path);if(present){requireThat(present.equals(Buffer.from(bytes)),'Retained original bytes differ: '+path);return;}await atomic(path,bytes);}
function packet(raw){const p=JSON.parse(raw);requireThat(p.format==='curriculum-workspace-export.v1'&&p.sha256===sha(canonical(p.workspace)),'Portable input hash or format differs.');Curriculum.receiveCurriculumWorkspace(p.workspace);return p;}
const acceptedRaw=await readFile(inputPath),accepted=packet(acceptedRaw);
const html=await readFile(resolve(root,'curriculum-migration-workbench.html'),'utf8');
const sourceSelection=JSON.parse(await readFile(resolve(root,'source-selection.json'),'utf8'));
const sourceBody={...sourceSelection};delete sourceBody.sha256;
requireThat(sourceSelection.files.length===20&&sourceSelection.sha256===config.sourceSha256&&sha(canonical(sourceBody))===sourceSelection.sha256,'Exact original source selection differs.');
for(const file of sourceSelection.files){
 requireThat(file.path&&!file.path.startsWith('/')&&file.path.split('/').every(x=>x&&x!=='.'&&x!=='..')&&!file.path.includes('\\'),'Unsafe original source member.');
 const raw=await readFile(resolve(root,file.path));
 requireThat(raw.length===file.bytes&&sha(raw)===file.sha256,'Exact original source differs: '+file.path);
}
const sourceFiles=sourceSelection.files,actor=config.actor||'TJLabs curriculum receiving engineer';
await mkdir(out,{recursive:true});await fixed(resolve(out,'source-selection.json'),canonical(sourceSelection)+'\n');
const initialIdentity={workspaceId:accepted.workspace.id,revision:accepted.workspace.revision,snapshotSha256:accepted.sha256};
const targetBinding={storeId:config.storeId,storeDirectory:config.storeDirectory,branchId:config.branchId,sourceSha256:config.sourceSha256,offlinePort:config.offlinePort};
const journalPath=resolve(out,'result.json'),old=await maybe(journalPath);
let report=old?JSON.parse(old):{operation,sourceSha256:sourceSelection.sha256,acceptedWorkspace:initialIdentity,targetBinding,startedAt:new Date().toISOString(),status:'RUNNING',steps:{},launches:[],artifacts:[]};
requireThat(report.operation===operation&&report.sourceSha256===sourceSelection.sha256&&equal(report.acceptedWorkspace,initialIdentity)&&equal(report.targetBinding,targetBinding),'Original receiving source/input differs.');
let retainTail=Promise.resolve();
const retain=()=>{const pending=retainTail.then(()=>atomic(journalPath,JSON.stringify(report,null,2)+'\n'));retainTail=pending.catch(()=>{});return pending;};
const artifact=async relative=>{requireThat(relative&&!relative.startsWith('/')&&!relative.split('/').includes('..'),'Unsafe output path.');const data=await readFile(resolve(out,relative)),d={path:relative,bytes:data.length,sha256:sha(data)},previous=report.artifacts.find(x=>x.path===relative);if(previous)requireThat(equal(previous,d),'Original artifact changed: '+relative);else report.artifacts.push(d);return d;};
if(report.status==='COMPLETE'){for(const f of report.artifacts)await artifact(f.path);requireThat(report.browserClosed&&report.serverClosed,'Completed resources are not closed.');console.log(JSON.stringify(report));process.exit(0);}
await retain();
const currentHost={bootId:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim(),pidNamespace:await readlink('/proc/self/ns/pid')};
// Original Invoice supervisor group census/closure, adapted to this Node owner.
// Source: Commons 28cf790fc5ee4803a51a4e8fa705c83c73c51857.
async function groupMembers(record){
 requireThat(record.bootId===currentHost.bootId&&record.pidNamespace===currentHost.pidNamespace,'Reconcile the original browser host/namespace before continuation.');
 requireThat(Number.isInteger(record.procPid)&&record.procPid>1&&record.procPgid===record.procPid&&record.procSession===record.procPid&&Number.isInteger(record.namespacePgid)&&record.namespacePgid===record.namespacePid&&record.namespacePid>1,'The original private browser group identity is incomplete.');
 const leader=await maybe('/proc/'+record.procPid+'/stat');
 if(leader){const fields=leader.toString().slice(leader.toString().lastIndexOf(')')+2).split(' ');requireThat(fields[19]===record.startTicks,'Original browser PID was reused; reconcile before signalling its retained group.');}
 const members=[];
 for(const name of await readdir('/proc')){
  if(!/^[0-9]+$/.test(name))continue;
  const path='/proc/'+name,body=await maybe(path+'/stat');if(!body)continue;
  const raw=body.toString(),fields=raw.slice(raw.lastIndexOf(')')+2).split(' ');
  if(Number(fields[2])!==record.procPgid||fields[0]==='Z')continue;
  let namespace;try{namespace=await readlink(path+'/ns/pid');}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')continue;throw e;}
  requireThat(namespace===record.pidNamespace&&Number(fields[3])===record.procSession&&BigInt(fields[19])>=BigInt(record.startTicks),'Retained browser group contains an unbound process; reconcile before signalling.');
  const again=await maybe(path+'/stat');if(!again)continue;const next=again.toString().slice(again.toString().lastIndexOf(')')+2).split(' ');
  if(next[19]!==fields[19]||Number(next[2])!==record.procPgid||next[0]==='Z')continue;
  members.push({procPid:Number(name),startTicks:fields[19]});
 }
 return members;
}
async function browserRecord(launch){const raw=await maybe(resolve(out,'control',launch.id+'.process.json'));if(!raw)return null;const record=JSON.parse(raw);requireThat(record.operation===operation&&record.launchId===launch.id&&record.sourceSha256===sourceSelection.sha256,'Original browser process binding differs.');return record;}
async function closeRecorded(launch,{allowOrphan=false}={}){
 if(launch.status==='CLOSED')return;
 const record=await browserRecord(launch);requireThat(record,'Original browser launch has no process identity; reconcile before retrying.');
 let members=await groupMembers(record);
 if(members.length){
  requireThat(allowOrphan,'The original private browser group must be closed before continuation.');
  for(const signal of ['SIGTERM','SIGKILL']){
   // Refresh the exact owned group before each signal; a leader's absence alone
   // is never evidence that its subprocesses have stopped.
   members=await groupMembers(record);if(!members.length)break;
   try{process.kill(-record.namespacePgid,signal);}catch(e){if(e.code!=='ESRCH')throw e;}
   for(let i=0;i<100;i++){members=await groupMembers(record);if(!members.length)break;await new Promise(r=>setTimeout(r,50));}
   if(!members.length)break;
  }
  requireThat(!(await groupMembers(record)).length,'Original browser process group remains active.');
 }
 launch.status='CLOSED';launch.closedAt=new Date().toISOString();launch.groupClosed=true;await retain();
}
for(const launch of report.launches)if(launch.status!=='CLOSED')await closeRecorded(launch,{allowOrphan:true});
let context=null,server=null,activeLaunch=null,launchPending=null,browserClosePromise=null,shutdownPromise=null,shutdownReason=null;const pageErrors=[];
function assertRunning(){if(shutdownReason)throw shutdownReason;}
const python=process.env.CURRICULUM_RECEIVING_PYTHON||'python3',chrome=process.env.CURRICULUM_CHROMIUM_EXECUTABLE;
requireThat(chrome,'Select an existing compatible Chromium with CURRICULUM_CHROMIUM_EXECUTABLE.');await stat(chrome);
const wrapper=resolve(out,'control','chrome-owner.py');
const wrapperSource='#!'+python+'\n'+"import json,os,pathlib\npath=pathlib.Path(os.environ[\"CURRICULUM_BRANCH_PROCESS_RECORD\"])\ntry: os.setsid()\nexcept PermissionError:\n if os.getpgrp()!=os.getpid(): raise\nproc_pid=int(os.readlink(\"/proc/self\"))\nraw=pathlib.Path(\"/proc/self/stat\").read_text()\nfields=raw[raw.rfind(\")\")+2:].split()\nif int(raw.split(\"(\",1)[0].strip())!=proc_pid or int(fields[2])!=proc_pid or int(fields[3])!=proc_pid: raise RuntimeError(\"Original browser did not enter its own private group/session\")\nrecord={\"operation\":os.environ[\"CURRICULUM_BRANCH_OPERATION\"],\"launchId\":os.environ[\"CURRICULUM_BRANCH_LAUNCH_ID\"],\"sourceSha256\":os.environ[\"CURRICULUM_BRANCH_SOURCE_SHA\"],\"procPid\":proc_pid,\"procPgid\":int(fields[2]),\"procSession\":int(fields[3]),\"namespacePid\":os.getpid(),\"namespacePgid\":os.getpgrp(),\"bootId\":pathlib.Path(\"/proc/sys/kernel/random/boot_id\").read_text().strip(),\"pidNamespace\":os.readlink(\"/proc/self/ns/pid\"),\"startTicks\":raw[raw.rfind(\")\")+2:].split()[19]}\npath.parent.mkdir(parents=True,exist_ok=True)\nwith path.open(\"x\",encoding=\"utf8\") as f:\n f.write(json.dumps(record,sort_keys=True)+\"\\n\");f.flush();os.fsync(f.fileno())\nd=os.open(str(path.parent),os.O_RDONLY)\ntry: os.fsync(d)\nfinally: os.close(d)\nos.execv(os.environ[\"CURRICULUM_BRANCH_CHROME\"],[os.environ[\"CURRICULUM_BRANCH_CHROME\"],*__import__(\"sys\").argv[1:]])\n";

await fixed(wrapper,wrapperSource);await chmod(wrapper,0o700);
let playwright;try{playwright=require('playwright');}catch{}
for(const base of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules',resolve(root,'node_modules')].filter(Boolean)){if(playwright)break;try{playwright=require(resolve(base,'playwright'));}catch{}}
requireThat(playwright,'An existing Playwright installation is required.');
let url=config.url;
requireThat(new URL(url).hostname==='127.0.0.1'&&new URL(url).protocol==='http:','Use the original loopback Application URL.');
async function launch(profile){
 assertRunning();requireThat(!context&&!activeLaunch,'Only one browser interval may run.');
 activeLaunch={id:randomUUID(),profile,status:'PREPARING',startedAt:new Date().toISOString()};report.launches.push(activeLaunch);
 const preparing=activeLaunch;
 // Retain one pending owner before the first yield so shutdown cannot race
 // durable preparation. Only this live never-dispatched branch closes without
 // a process receipt; every dispatched launch still requires its original census.
 launchPending=(async()=>{
  await retain();
  if(!shutdownReason){preparing.status='STARTING';await retain();}
  if(shutdownReason){preparing.status='CLOSED';preparing.closedAt=new Date().toISOString();preparing.groupClosed=true;preparing.notDispatched=true;await retain();throw shutdownReason;}
  context=await playwright.chromium.launchPersistentContext(resolve(out,'profiles',profile),{
  executablePath:wrapper,headless:true,timeout:15000,viewport:{width:1440,height:1000},acceptDownloads:true,
  env:{...process.env,CURRICULUM_BRANCH_CHROME:chrome,CURRICULUM_BRANCH_OPERATION:operation,CURRICULUM_BRANCH_SOURCE_SHA:sourceSelection.sha256,CURRICULUM_BRANCH_LAUNCH_ID:activeLaunch.id,CURRICULUM_BRANCH_PROCESS_RECORD:resolve(out,'control',activeLaunch.id+'.process.json')},
  args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--single-process','--no-zygote']
 });
  return context;
 })();
 try{context=await launchPending;}finally{launchPending=null;}
 assertRunning();context.setDefaultTimeout(60000);context.setDefaultNavigationTimeout(60000);
 requireThat(await browserRecord(activeLaunch),'Browser did not retain its process identity.');
 activeLaunch.status='RUNNING';await retain();

 context.on('page',p=>p.on('pageerror',e=>pageErrors.push(e.stack||e.message)));
 return context;
}
async function closeBrowser(){
 if(browserClosePromise)return browserClosePromise;
 const launchRecord=activeLaunch,owned=context;
 browserClosePromise=(async()=>{
  const closed=owned?owned.close().then(()=>({closed:true}),error=>({error})):Promise.resolve({closed:true});
  // Playwright's close can wait on a stuck child. Give graceful close a bounded
  // opportunity, then settle the exact retained group independently.
  await Promise.race([closed,new Promise(resolve=>setTimeout(resolve,2000))]);
  if(launchRecord)await closeRecorded(launchRecord,{allowOrphan:true});
  if(context===owned)context=null;if(activeLaunch===launchRecord)activeLaunch=null;
  const result=await Promise.race([closed,new Promise(resolve=>setTimeout(()=>resolve({error:Error('Browser group closed but its API close did not return.')}),1000))]);
  if(result.error)throw result.error;
 })();
 try{return await browserClosePromise;}finally{browserClosePromise=null;}
}
async function shutdown(reason=null){
 if(reason&&!shutdownReason)shutdownReason=reason;
 if(shutdownPromise)return shutdownPromise;
 shutdownPromise=(async()=>{
  const cleanup=[];
  // The original launch must return or time out before its retained process
  // receipt is reconciled. Never mark an in-flight launch closed by assumption.
  if(launchPending)try{await launchPending;}catch{}
  try{if(context||activeLaunch)await closeBrowser();}catch(e){cleanup.push(e.stack||String(e));}
  try{if(server){const owned=server;await new Promise((yes,no)=>owned.close(e=>e?no(e):yes()));if(server===owned)server=null;}}catch(e){cleanup.push(e.stack||String(e));}
  report.browserClosed=!context&&!activeLaunch&&report.launches.every(x=>x.status==='CLOSED'&&x.groupClosed===true);
  report.serverClosed=!server||!server.listening;
  if(cleanup.length){report.cleanupErrors=cleanup;throw Error('Original receiving cleanup remains unresolved:\n'+cleanup.join('\n'));}
  requireThat(report.browserClosed&&report.serverClosed,'Original receiving resources remain unresolved.');
 })();
 return shutdownPromise;
}
function interrupted(signal){
 const error=new Error('Original receiving interrupted by '+signal);
 process.exitCode=signal==='SIGTERM'?143:130;
 void shutdown(error).catch(e=>{report.cleanupErrors=[...(report.cleanupErrors||[]),e.stack||String(e)];}).finally(async()=>{
  report.status='INCOMPLETE';report.error=shutdownReason.stack;try{await retain();}catch(e){console.error(e.stack||String(e));}
 });
}
const terminate=()=>interrupted('SIGTERM'),interrupt=()=>interrupted('SIGINT');
process.on('SIGTERM',terminate);process.on('SIGINT',interrupt);

async function idle(p){
 assertRunning();await p.waitForFunction(()=>typeof workspace!=='undefined'&&workspace&&(typeof Managed==='undefined'||!Managed.isBusy()));assertRunning();
}
async function pageOpen({offline=false}={}){
 assertRunning();const p=await context.newPage();p.on('pageerror',e=>pageErrors.push(e.stack||e.message));
 await p.goto(url,{waitUntil:'domcontentloaded'});
 await p.waitForFunction(()=>typeof workspace!=='undefined'&&workspace?.id&&document.querySelector('#main h2'));
 await idle(p);requireThat(await p.locator('#engineer').isEnabled(),'Operating engineer remained disabled.');await p.locator('#engineer').fill(actor);
 if(!offline&&await p.evaluate(async()=>Boolean(await Managed.pending()))){await p.locator('#managed-recover').click();await idle(p);}
 return p;
}
async function observe(p){
 await idle(p);const value=await p.evaluate(async()=>{
  const record=Managed.current(),saved=await Managed.read(record.id);
  return {selected:{id:record.id,workspaceId:record.workspaceId,revision:record.revision,snapshotSha256:record.snapshotSha256},record:saved,snapshot:workspace};
 });
 requireThat(value.record.storeId===config.storeId&&equal(value.snapshot,value.record.snapshot),'Visible and saved physical branch differ.');
 packet(JSON.stringify({format:'curriculum-workspace-export.v1',sha256:value.record.snapshotSha256,workspace:value.snapshot}));return value;
}
async function choose(p,id){
 await idle(p);await p.locator('#managed-branches').selectOption(id);
 await p.waitForFunction(id=>Managed.current()?.id===id&&!Managed.isBusy(),id);await idle(p);
 requireThat((await observe(p)).selected.id===id,'Visible branch selection differs.');
}
async function tab(p,name){await p.locator('[data-tab="'+name+'"]').click();await idle(p);}
async function discard(p){await p.locator('#managed-discard-draft').click();await idle(p);}
async function screenshot(p,name){
 const relative='screenshots/'+name+'.png',path=resolve(out,relative);await mkdir(dirname(path),{recursive:true});
 if(!await maybe(path))await p.screenshot({path,fullPage:true});const png=await readFile(path);
 requireThat(png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&png.subarray(-8,-4).toString()==='IEND','Screenshot is incomplete: '+relative);
 await artifact(relative);await retain();
}
async function portableDownload(p,name,expected,{offline=false}={}){
 const relative='outputs/'+name,path=resolve(out,relative);await mkdir(dirname(path),{recursive:true});let raw=await maybe(path);
 if(!raw){
  const [d]=await Promise.all([p.waitForEvent('download'),p.locator('#export-workspace').click()]);await idle(p);
  await d.saveAs(path+'.partial');raw=await readFile(path+'.partial');packet(raw);await rename(path+'.partial',path);await syncDir(dirname(path));
 }
 const value=packet(raw);requireThat(equal(value.workspace,expected),'Export changed the complete reviewed branch.');await artifact(relative);await retain();return path;
}
async function receive(p,name,input){
 const raw=await readFile(input),incoming=packet(raw);let step=report.steps[name];
 if(!step){step=report.steps[name]={status:'PENDING',inputSha256:sha(raw),snapshotSha256:incoming.sha256,parent:(await observe(p)).selected,existingIds:await p.evaluate(async()=> (await Managed.list()).map(x=>x.id))};await retain();}
 requireThat(step.inputSha256===sha(raw)&&step.snapshotSha256===incoming.sha256,'Original receiving input differs.');
 if(step.status==='COMPLETE'){await choose(p,step.branchId);return step.branchId;}
 let matches=await p.evaluate(async({ids,inputSha,parent})=>{
  const found=[];for(const summary of await Managed.list()){if(ids.includes(summary.id))continue;const r=await Managed.read(summary.id);
   if(r.origin.kind==='operator-file'&&r.origin.inputSha256===inputSha&&r.origin.parentBranchId===parent)found.push(r);
  }return found;
 },{ids:step.existingIds,inputSha:step.inputSha256,parent:step.parent.id});
 requireThat(matches.length<=1,'More than one original receive effect needs reconciliation.');
 if(!matches.length){
  await choose(p,step.parent.id);await p.locator('#receive-workspace').setInputFiles(input);await idle(p);
  const value=await observe(p);requireThat(value.record.origin.kind==='operator-file'&&value.record.origin.inputSha256===step.inputSha256,'UI did not receive the exact selected file.');matches=[value.record];
 }
 const record=matches[0];requireThat(equal(record.snapshot,incoming.workspace),'Receiving changed original source or history.');
 step.branchId=record.id;step.snapshot=record.snapshot;step.status='COMPLETE';step.completedAt=new Date().toISOString();await retain();await choose(p,record.id);return record.id;
}
async function saveSource(p,name,label,sourcePath){
 let step=report.steps[name];const current=await observe(p),content=await readFile(resolve(root,sourcePath),'utf8');
 if(!step){step=report.steps[name]={status:'PENDING',before:current.selected,beforeSnapshot:current.snapshot,label,sourcePath,sourceSha256:sha(content),actor};await retain();}
 requireThat(step.label===label&&step.sourcePath===sourcePath&&step.sourceSha256===sha(content)&&step.actor===actor&&step.before.id===current.selected.id,'Original source-retention intent differs.');
 if(step.status==='COMPLETE'){requireThat(equal(current.snapshot,step.snapshot),'Recorded source branch changed.');return current;}
 const before=step.beforeSnapshot;
 if(current.record.snapshotSha256===step.before.snapshotSha256){
  await tab(p,'sources');await discard(p);await p.locator('#asset-name').fill(label);await p.locator('#asset-kind').selectOption('source-notes');await p.locator('#asset-content').fill(content);
  await p.locator('#asset-save').click();await idle(p);
 }
 const saved=await observe(p),added=saved.snapshot.assets.filter(a=>!before.assets.some(old=>old.id===a.id)),event=saved.snapshot.history.at(-1);
 requireThat(added.length===1&&added[0].name===label&&added[0].kind==='source-notes'&&added[0].content===content&&event?.type==='asset-added'&&event.actor===actor,'Original source save has a different result.');
 const reproduced=Model.addAsset(before,added[0],{actor:event.actor,at:event.at});
 requireThat(equal(saved.snapshot,reproduced),'Saved browser operation differs from the complete original native transition.');
 step.snapshot=saved.snapshot;step.result=saved.selected;step.asset=added[0];step.status='COMPLETE';step.completedAt=new Date().toISOString();await retain();return saved;
}
async function inspectZip(path,expected){
 const script='import sys,zipfile,json,hashlib,base64\nwith zipfile.ZipFile(sys.argv[1]) as z:\n assert z.testzip() is None\n names=z.namelist(); assert len(names)==len(set(names))\n out={n:{"bytes":len(z.read(n)),"sha256":hashlib.sha256(z.read(n)).hexdigest()} for n in names}\n out["$workspace"]=json.loads(z.read("current-workspace.json"))\n out["$html"]=base64.b64encode(z.read("curriculum-migration-workbench.html")).decode("ascii")\n print(json.dumps(out))\n';
 const checked=spawnSync(python,['-c',script,path],{encoding:'utf8',maxBuffer:160*1024*1024});
 requireThat(checked.status===0,'Complete application ZIP could not be opened: '+checked.stderr);
 const result=JSON.parse(checked.stdout),decoded=packet(JSON.stringify(result.$workspace)),downloadedHtml=Buffer.from(result.$html,'base64');
 requireThat(equal(decoded.workspace,expected)&&downloadedHtml.equals(Buffer.from(html)),'Downloaded workspace or pristine original HTML differs.');
 const generated=generateSdk(expected.editions.at(-1)).files;
 const expectedPaths=[...sourceFiles.map(f=>f.path),...generated.map(f=>'generated/'+f.path),'current-workspace.json','RECEIVE_CURRENT_WORKSPACE.txt'].sort();
 requireThat(equal(Object.keys(result).filter(k=>!k.startsWith('$')).sort(),expectedPaths),'Complete application ZIP member inventory differs.');
 for(const f of sourceFiles)requireThat(result[f.path]?.bytes===f.bytes&&result[f.path]?.sha256===f.sha256,'Downloaded original source changed: '+f.path);
 for(const f of generated)requireThat(result['generated/'+f.path]?.bytes===Buffer.byteLength(f.content)&&result['generated/'+f.path]?.sha256===sha(f.content),'Downloaded generated SDK changed: '+f.path);
 return {manifest:Object.fromEntries(Object.entries(result).filter(([k])=>!k.startsWith('$'))),html:downloadedHtml};
}

let servingHtml=html;
try{
 assertRunning();await launch('main');let p=await pageOpen();
 if(!report.steps.managedOpen){
  await choose(p,config.branchId);const value=await observe(p);requireThat(equal(value.snapshot,accepted.workspace),'Managed opening changed the selected complete workspace.');
  report.steps.managedOpen={status:'COMPLETE',branchId:value.selected.id,snapshot:value.snapshot,storeId:config.storeId,storeDirectory:config.storeDirectory};await retain();
 }
 const original=report.steps.managedOpen.branchId;await choose(p,original);
 const copy=await receive(p,'copy',inputPath);requireThat(copy!==original,'Receiving replaced the original physical branch.');
 if(!report.steps.drafts){
  await tab(p,'case');await p.locator('#candidate-source').fill('Received branch — retained response source draft');
  await choose(p,original);await tab(p,'case');await p.locator('#candidate-source').fill('Original branch — retained response source draft');
  await choose(p,copy);requireThat(await p.locator('#candidate-source').inputValue()==='Received branch — retained response source draft','Received form was lost or mixed.');await screenshot(p,'received-draft-desktop');
  await choose(p,original);requireThat(await p.locator('#candidate-source').inputValue()==='Original branch — retained response source draft','Original form was lost or mixed.');await screenshot(p,'original-draft-desktop');
  report.steps.drafts={status:'COMPLETE',original,received:copy};await retain();
 }
 await choose(p,copy);await saveSource(p,'receivedEdit','Retained curriculum migration engine — independent received branch','curriculum-migration.mjs');
 await screenshot(p,'received-saved-source-desktop');await choose(p,original);
 if(!report.steps.staleConflict){
  const attempts=report.staleConflictAttempts||(report.staleConflictAttempts=[]);let attempt=attempts.at(-1);
  if(attempt?.status==='PENDING'){
   const edit=report.steps[attempt.editName],current=await observe(p);
   if(edit?.status==='COMPLETE'||current.record.snapshotSha256!==attempt.before.snapshotSha256){
    requireThat(edit,'The interrupted conflict interval has an unbound branch change.');
    await saveSource(p,attempt.editName,attempt.label,attempt.sourcePath);
    attempt.status='INTERRUPTED_EDIT_RETAINED';attempt.retainedEdit=edit.result;await retain();attempt=null;
   }
  }else attempt=null;
  if(!attempt){
   const before=await observe(p),previous=attempts.at(-1);
   if(previous?.status==='INTERRUPTED_EDIT_RETAINED')requireThat(equal(before.snapshot,report.steps[previous.editName].snapshot),'Retained source edition changed before the next conflict interval.');
   const number=attempts.length+1;
   attempt={number,status:'PENDING',editName:'originalSourceInterval'+number,label:'Retained case engine — original branch interval '+number,sourcePath:'model.mjs',before:before.selected,beforeSnapshot:before.snapshot};
   attempts.push(attempt);await retain();
  }
  requireThat(equal((await observe(p)).snapshot,attempt.beforeSnapshot),'Conflict interval basis changed before its stale tab opened.');
  const stale=await pageOpen();await choose(stale,original);await tab(stale,'sources');await discard(stale);
  const staleContent=await readFile(resolve(root,'curriculum-coverage.mjs'),'utf8');
  await stale.locator('#asset-name').fill('Retained occurrence engine — unsaved stale-tab source');await stale.locator('#asset-kind').selectOption('source-notes');await stale.locator('#asset-content').fill(staleContent);
  const before=await observe(stale);requireThat(equal(before.snapshot,attempt.beforeSnapshot),'Actual stale tab did not open the frozen interval basis.');
  await saveSource(p,attempt.editName,attempt.label,attempt.sourcePath);const edit=report.steps[attempt.editName];
  await stale.locator('#asset-save').click();await idle(stale);const message=await stale.locator('#notice').innerText();
  requireThat(message.includes('This physical branch has advanced'),'The actual stale UI did not return the saved-revision conflict.');
  requireThat(await stale.locator('#asset-content').inputValue()===staleContent&&await stale.locator('#asset-name').inputValue()==='Retained occurrence engine — unsaved stale-tab source','Rejected source form was discarded.');
  const stored=await stale.evaluate(async id=>Managed.read(id),original);requireThat(equal(stored.snapshot,edit.snapshot),'Stale UI changed the current branch.');
  await screenshot(stale,'stale-tab-conflict-'+attempt.number+'-desktop');
  await stale.locator('#managed-reopen').click();await idle(stale);
  requireThat(equal((await observe(stale)).snapshot,edit.snapshot)&&await stale.locator('#asset-content').inputValue()===staleContent,'Reopen lost the current branch or retained source form.');
  requireThat(await stale.locator('#managed-rebase-draft').isVisible(),'Changed form basis has no explicit review control.');
  const draftPath='outputs/stale-source-form-'+attempt.number+'.json';await mkdir(dirname(resolve(out,draftPath)),{recursive:true});
  const [draft]=await Promise.all([stale.waitForEvent('download'),stale.locator('#managed-export-draft').click()]);
  await draft.saveAs(resolve(out,draftPath)+'.partial');const draftRaw=await readFile(resolve(out,draftPath)+'.partial'),draftPacket=JSON.parse(draftRaw);
  requireThat(Object.values(draftPacket.drafts).some(d=>d.basis.snapshotSha256===before.selected.snapshotSha256&&d.values.some(v=>v.id==='asset-content'&&v.value===staleContent)),'Exported retained form omitted its complete original source or saved basis.');
  await fixed(resolve(out,draftPath),draftRaw);await unlink(resolve(out,draftPath)+'.partial');await artifact(draftPath);
  attempt.status='COMPLETE';attempt.after=edit.result;
  report.steps.staleConflict={status:'COMPLETE',attemptNumber:attempt.number,editName:attempt.editName,before:before.selected,after:edit.result,message,draftPreserved:true};
  report.steps.finalOriginal={status:'COMPLETE',editName:attempt.editName,result:edit.result,snapshot:edit.snapshot};await retain();await stale.close();
 }else{
  const edit=report.steps[report.steps.staleConflict.editName];requireThat(edit?.status==='COMPLETE','Completed conflict interval has no exact original source edition.');
  requireThat(equal(report.steps.finalOriginal.snapshot,edit.snapshot)&&equal((await observe(p)).snapshot,edit.snapshot),'Final original branch differs.');
 }
 await closeBrowser();await launch('main');p=await pageOpen();
 for(const [name,id,expected]of [['original',original,report.steps.finalOriginal.snapshot],['received',copy,report.steps.receivedEdit.snapshot]]){
  await choose(p,id);requireThat(equal((await observe(p)).snapshot,expected),'Browser reopen changed '+name+' branch.');
  await portableDownload(p,name+'-workspace.json',expected);
 }
 const tabs=['case','overview','curriculum','contracts','sources','history'];await choose(p,original);
 for(const name of tabs){await tab(p,name);await screenshot(p,name+'-desktop');}
 await p.setViewportSize({width:390,height:844});
 for(const name of tabs){
  await tab(p,name);const widths=await p.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth}));
  requireThat(widths.content<=widths.viewport,'Mobile horizontal overflow in '+name+': '+canonical(widths));await screenshot(p,name+'-mobile');
 }
 report.steps.reopenAndViews={status:'COMPLETE',desktop:tabs.length,mobile:tabs.length,original,received:copy};await retain();
 await p.setViewportSize({width:1440,height:1000});await tab(p,'contracts');
 const relative='outputs/complete-curriculum-application.zip',zipPath=resolve(out,relative);
 if(!await maybe(zipPath)){
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#download-source').click()]);
  await idle(p);await download.saveAs(zipPath+'.partial');await inspectZip(zipPath+'.partial',report.steps.finalOriginal.snapshot);await rename(zipPath+'.partial',zipPath);await syncDir(dirname(zipPath));
 }
 const checked=await inspectZip(zipPath,report.steps.finalOriginal.snapshot);await artifact(relative);
 await fixed(resolve(out,'outputs/application-member-inventory.json'),JSON.stringify(checked.manifest,null,2)+'\n');await artifact('outputs/application-member-inventory.json');
 servingHtml=checked.html;await fixed(resolve(out,'outputs/received-application.html'),servingHtml);await artifact('outputs/received-application.html');await retain();
 await closeBrowser();url='http://127.0.0.1:'+config.offlinePort+'/';
 server=createServer((req,res)=>{if(req.headers.host!==new URL(url).host){res.writeHead(403);res.end();return;}res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(servingHtml);});
 await new Promise((yes,no)=>{server.once('error',no);server.listen(config.offlinePort,'127.0.0.1',yes);});
 for(const [name,file,expected]of [['independentOriginal','original-workspace.json',report.steps.finalOriginal.snapshot],['independentReceived','received-workspace.json',report.steps.receivedEdit.snapshot]]){
  await launch(name);p=await pageOpen({offline:true});
  requireThat(await p.locator('#managed-controls').count()===0,'Downloaded original application retained managed runtime controls.');
  const current=await p.evaluate(()=>workspace);
  if(!equal(current,expected)){await p.locator('#receive-workspace').setInputFiles(resolve(out,'outputs',file));await p.waitForFunction(expected=>Model.canonical(workspace)===Model.canonical(expected),expected);}
  const received=await p.evaluate(()=>workspace);requireThat(equal(received,expected),'Independent downloaded application changed complete workspace history.');
  Curriculum.receiveCurriculumWorkspace(received);await screenshot(p,name+'-desktop');await portableDownload(p,name+'-roundtrip.json',expected,{offline:true});
  report.steps[name]={status:'COMPLETE',snapshotSha256:sha(canonical(received)),revision:received.revision,history:received.history.length,cases:received.cases.length,assets:received.assets.map(a=>({id:a.id,bytes:Buffer.byteLength(a.content),sha256:sha(a.content)}))};await retain();await closeBrowser();
 }
 requireThat(!pageErrors.length,'Browser errors: '+pageErrors.join('\n'));
 await shutdown();assertRunning();
 report.managedSelection={storeId:config.storeId,storeDirectory:config.storeDirectory,branchId:original};report.status='COMPLETE';report.completedAt=new Date().toISOString();report.browserClosed=true;report.serverClosed=true;report.artifacts.sort((a,b)=>a.path.localeCompare(b.path));await retain();console.log(JSON.stringify(report));
}catch(error){report.status='INCOMPLETE';report.error=error.stack||String(error);await retain();console.error(report.error);process.exitCode=1;}
finally{
 try{await shutdown();}catch(e){report.status='INCOMPLETE';report.cleanupErrors=[...(report.cleanupErrors||[]),e.stack||String(e)];process.exitCode=process.exitCode||1;}
 if(shutdownReason){report.status='INCOMPLETE';report.error=shutdownReason.stack||String(shutdownReason);}
 await retain();process.removeListener('SIGTERM',terminate);process.removeListener('SIGINT',interrupt);
}
