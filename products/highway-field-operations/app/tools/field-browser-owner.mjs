/** Whole original browser-group custody. Adapted from the maintained MPC/Invoice receiving owner. */
import {readFile,mkdir,open,rename,stat,readlink,chmod,readdir} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
const require=createRequire(import.meta.url);
export async function createOwner({operation,out,root,report,retain,sourceSelection,guard}){
 function requireThat(x,m){if(!x)throw Error(m);}
 requireThat(Number.isInteger(guard)&&guard>=3,'The original programme lock must be inherited.');await stat('/proc/self/fd/'+guard);
 async function maybe(path){try{return await readFile(path);}catch(e){if(e.code==='ENOENT'||e.code==='ESRCH')return null;throw e;}}
 async function fixed(path,bytes){await mkdir(dirname(path),{recursive:true,mode:0o700});const old=await maybe(path);if(old){requireThat(old.equals(Buffer.from(bytes)),'Retained process owner source changed.');return;}const fd=await open(path,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}const d=await open(dirname(path),'r');try{await d.sync();}finally{await d.close();}}
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
for(const launch of report.launches)if(launch.status!=='CLOSED'){
 // PREPARING was durably saved before STARTING and before Playwright invocation.
 // The inherited programme flock proves the earlier owner is no longer running.
 // A process receipt contradicting PREPARING is never discarded.
 if(launch.status==='PREPARING'){requireThat(!await browserRecord(launch),'A PREPARING launch has a process receipt; reconcile its original owner.');launch.status='CLOSED';launch.notDispatched=true;launch.groupClosed=true;launch.closedAt=new Date().toISOString();await retain();}
 else await closeRecorded(launch,{allowOrphan:true});
}
let context=null,server=null,activeLaunch=null,launchPending=null,browserClosePromise=null,shutdownPromise=null,shutdownReason=null;const pageErrors=[];
function assertRunning(){if(shutdownReason)throw shutdownReason;}
const python=process.env.HIGHWAY_FIELD_PYTHON||'python3',chrome=process.env.HIGHWAY_FIELD_CHROMIUM;
requireThat(chrome,'Select an existing compatible Chromium with HIGHWAY_FIELD_CHROMIUM.');await stat(chrome);
const wrapper=resolve(out,'control','chrome-owner.py');
const wrapperSource='#!'+python+'\n'+"import json,os,pathlib\npath=pathlib.Path(os.environ[\"HIGHWAY_FIELD_PROCESS_RECORD\"])\ntry: os.setsid()\nexcept PermissionError:\n if os.getpgrp()!=os.getpid(): raise\nproc_pid=int(os.readlink(\"/proc/self\"))\nraw=pathlib.Path(\"/proc/self/stat\").read_text()\nfields=raw[raw.rfind(\")\")+2:].split()\nif int(raw.split(\"(\",1)[0].strip())!=proc_pid or int(fields[2])!=proc_pid or int(fields[3])!=proc_pid: raise RuntimeError(\"Original browser did not enter its own private group/session\")\nrecord={\"operation\":os.environ[\"HIGHWAY_FIELD_OPERATION\"],\"launchId\":os.environ[\"HIGHWAY_FIELD_LAUNCH_ID\"],\"sourceSha256\":os.environ[\"HIGHWAY_FIELD_SOURCE_SHA\"],\"procPid\":proc_pid,\"procPgid\":int(fields[2]),\"procSession\":int(fields[3]),\"namespacePid\":os.getpid(),\"namespacePgid\":os.getpgrp(),\"bootId\":pathlib.Path(\"/proc/sys/kernel/random/boot_id\").read_text().strip(),\"pidNamespace\":os.readlink(\"/proc/self/ns/pid\"),\"startTicks\":raw[raw.rfind(\")\")+2:].split()[19]}\npath.parent.mkdir(parents=True,exist_ok=True)\nwith path.open(\"x\",encoding=\"utf8\") as f:\n f.write(json.dumps(record,sort_keys=True)+\"\\n\");f.flush();os.fsync(f.fileno())\nd=os.open(str(path.parent),os.O_RDONLY)\ntry: os.fsync(d)\nfinally: os.close(d)\nos.execv(os.environ[\"HIGHWAY_FIELD_CHROME\"],[os.environ[\"HIGHWAY_FIELD_CHROME\"],*__import__(\"sys\").argv[1:]])\n";

await fixed(wrapper,wrapperSource);await chmod(wrapper,0o700);
let playwright;try{playwright=require('playwright');}catch{}
for(const base of [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules',resolve(root,'node_modules')].filter(Boolean)){if(playwright)break;try{playwright=require(resolve(base,'playwright'));}catch{}}
requireThat(playwright,'An existing Playwright installation is required.');

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
  env:{...process.env,HIGHWAY_FIELD_CHROME:chrome,HIGHWAY_FIELD_OPERATION:operation,HIGHWAY_FIELD_SOURCE_SHA:sourceSelection.sha256,HIGHWAY_FIELD_LAUNCH_ID:activeLaunch.id,HIGHWAY_FIELD_PROCESS_RECORD:resolve(out,'control',activeLaunch.id+'.process.json')},
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
return {launch,closeBrowser,shutdown,assertRunning,pageErrors,
 setServer(value){server=value;}, removeSignals(){process.off('SIGTERM',terminate);process.off('SIGINT',interrupt);}};



}
