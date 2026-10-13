// MIT. Installed client for complete original-source native receiving.
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {readFile,writeFile,lstat,realpath,open,rename} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';

export const OPERATION='SCF-CARBON-NATIVE-8D45-20261012';
const need=(condition,code,message)=>{if(!condition)throw Object.assign(new Error(message),{code});};
const hash=(value,algorithm='sha256')=>createHash(algorithm).update(value).digest('hex');
const json=body=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body));
const inside=(root,path)=>{const name=relative(root,path);return name===''||(!name.startsWith('..'+sep)&&name!=='..'&&!isAbsolute(name));};
const pathValue=(value,name)=>{need(typeof value==='string'&&value.trim()&&!value.includes('\0'),'RECEIVING_PATH','Provide '+name+'.');return resolve(value);};
const present=value=>value!==undefined&&value!==null;
const portable=name=>typeof name==='string'&&name&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
const readOptional=async path=>{try{const body=await readFile(path);return {body,value:json(body)};}catch(error){if(error.code==='ENOENT')return null;return {error:{code:error.code||'INVALID_JSON',message:error.message}};}};
async function regular(path){
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
  try{const before=await handle.stat({bigint:true});need(before.isFile(),'ORIGINAL_FILE','Use a complete original regular file: '+path);
    const body=await handle.readFile();need(BigInt(body.length)===before.size&&sameStat(before,await handle.stat({bigint:true})),'ORIGINAL_CHANGED','The original file changed while reading: '+path);return body;
  }finally{await handle.close();}
}
async function absent(path){try{await lstat(path);throw Object.assign(new Error('Preserve the existing path and select a new receiving operation directory: '+path),{code:'RECEIVING_EXISTS'});}catch(error){if(error.code!=='ENOENT')throw error;}}
async function writeState(path,value){const temp=path+'.partial-'+randomUUID();const handle=await open(temp,'wx',0o600);try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}await rename(temp,path);}
async function identity(pid){
  let bootId=null,startTicks=null,state=null;
  try{bootId=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();}catch{}
  try{const stat=await readFile('/proc/'+pid+'/stat','utf8'),fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);startTicks=fields[19]||null;state=fields[0]||null;}catch{}
  return {hostname:hostname(),pid,bootId,startTicks,state};
}
async function observeIdentity(old){
  if(!Number.isSafeInteger(old?.pid)||old.pid<=0||!old.bootId||!old.startTicks||old.hostname!==hostname())return null;
  const current=await identity(old.pid);
  return current.state!=='Z'&&current.state!=='X'&&current.bootId===old.bootId&&current.startTicks===old.startTicks;
}
async function observeProcess(invocation){
  if(!invocation)return null;
  if(invocation.state==='exited'||invocation.state==='spawn-error')return false;
  return observeIdentity(invocation.process);
}
async function canonicalTarget(path){
  let ancestor=path;const tail=[];
  for(;;){
    try{return join(await realpath(ancestor),...tail.reverse());}
    catch(error){if(error.code!=='ENOENT')throw error;const parent=dirname(ancestor);if(parent===ancestor)throw error;
      tail.push(relative(parent,ancestor));ancestor=parent;}
  }
}
async function inspectResumeOutput(resumeFrom){
  const directory=await realpath(pathValue(resumeFrom,'the preserved receiving output directory'));
  need((await lstat(directory)).isDirectory(),'RESUME_DIRECTORY','Select the preserved output directory containing receiving.json and its complete operated files.');
  const receivingFile=join(directory,'receiving.json'),body=await regular(receivingFile),snapshot=json(body);
  need(snapshot.schema==='stellar-forge.carbon-native-receiving.v1'&&snapshot.operation===OPERATION
    &&typeof snapshot.output==='string'&&isAbsolute(snapshot.output)&&typeof snapshot.sourceRoot==='string'&&isAbsolute(snapshot.sourceRoot)
    &&Array.isArray(snapshot.stages),'RESUME_IDENTITY','Select the complete original receiving snapshot for this operation.');
  const originalOutput=resolve(snapshot.output),originalSourceRoot=resolve(snapshot.sourceRoot),observations=[];
  if(snapshot.process){
    const running=await observeIdentity(snapshot.process);
    observations.push({source:receivingFile,process:snapshot.process,running});
    need(running!==true,'RESUME_RUNNING','The original receiving process is still running. Continue that existing process before reopening its output.');
  }
  for(const path of new Set([directory+'.invocation.json',originalOutput+'.invocation.json'])){
    const read=await readOptional(path);
    if(!read)continue;
    if(read.error){observations.push({source:path,running:null,error:read.error});continue;}
    const invocation=read.value;
    const matches=invocation?.schema==='stellar-forge.carbon-native-invocation.v1'&&invocation.operation===OPERATION
      &&typeof invocation.output==='string'&&[directory,originalOutput].includes(resolve(invocation.output))
      &&typeof invocation.sourceRoot==='string'&&resolve(invocation.sourceRoot)===originalSourceRoot;
    if(!matches){observations.push({source:path,running:null,selection:'unrelated-invocation'});continue;}
    const running=await observeIdentity(invocation.process);
    observations.push({source:path,bytes:read.body.length,sha256:hash(read.body),process:invocation.process||null,recordedState:invocation.state||null,running});
    need(running!==true,'RESUME_RUNNING','The original receiving process is still running. Continue that existing process before reopening its output.');
  }
  return {directory,receivingFile,receiving:{bytes:body.length,sha256:hash(body)},originalOutput,originalSourceRoot,
    originalStartedAt:snapshot.startedAt||null,originalStatus:snapshot.status||null,observations};
}

/** Check the selected bootstrap closure and whole original handover before execution. */
export async function inspectReceivingSource({sourceRoot}={}){
  const root=await realpath(pathValue(sourceRoot,'the received source root'));
  const manifestPath=join(root,'receiving/source-manifest.json');
  const manifestBody=await regular(manifestPath),manifest=json(manifestBody);
  need(manifest.schema==='stellar-forge.native-source-manifest.v1'&&Array.isArray(manifest.files)&&manifest.files.length,'SOURCE_MANIFEST','Use the complete bootstrap-owned native source manifest.');
  const seen=new Set();let bytes=0;
  for(const file of manifest.files){
    need(portable(file.path)&&!seen.has(file.path),'SOURCE_PATH','Use unique complete relative source paths.');seen.add(file.path);
    need(Number.isSafeInteger(file.bytes)&&file.bytes>=0&&/^[a-f0-9]{40}$/.test(file.gitBlobSha1),'SOURCE_IDENTITY','Retain the original source byte count and Git blob identity: '+file.path);
    const path=join(root,...file.path.split('/'));
    need(inside(root,await realpath(path)),'SOURCE_PATH','An original source path leaves the selected root: '+file.path);
    const body=await regular(path);
    const git=createHash('sha1').update('blob '+body.length+'\0').update(body).digest('hex');
    need(body.length===file.bytes&&git===file.gitBlobSha1&&(!file.sha256||hash(body)===file.sha256),'SOURCE_CHANGED','The complete original source changed: '+file.path);
    bytes+=body.length;
  }
  for(const path of ['receiving/receive-native.mjs','receiving/browser-actions.mjs','receiving/finalize-native.mjs'])
    need(seen.has(path),'SOURCE_CLOSURE','The source manifest must include '+path+'.');
  const handover=await regular(join(root,'receiving/stellarcarbon-current-handover.json'));
  need(manifest.handover&&handover.length===manifest.handover.bytes&&hash(handover)===manifest.handover.sha256,'HANDOVER_CHANGED','Use the exact complete original customer handover.');
  need(json(handover).schema==='stellar-forge.stellarcarbon-handover.v1','HANDOVER_SCHEMA','Use the complete editable Stellarcarbon handover.');
  return {schema:'stellar-forge.carbon-native-source-inspection.v1',operation:OPERATION,sourceRoot:root,sourceCommit:manifest.sourceCommit,
    files:seen.size,sourceBytes:bytes,capabilities:manifest.capabilities&&typeof manifest.capabilities==='object'&&!Array.isArray(manifest.capabilities)?manifest.capabilities:{},
    manifest:{path:manifestPath,bytes:manifestBody.length,sha256:hash(manifestBody)},
    handover:{bytes:handover.length,sha256:hash(handover)}};
}

export const RUN_FLAGS=Object.freeze({
  sourceRoot:'source-root',output:'output',resumeFrom:'resume-from',chromium:'chromium',sdkModule:'sdk-module',actor:'actor',
  ledgerSource:'ledger-source',registrySource:'registry-source',captureOptions:'capture-options',captureCheckpoint:'capture-checkpoint',
  from:'from',before:'before',archivePath:'archive-path',accountingDirectory:'accounting-directory',
  expectedAccountingWorkspaceId:'expected-accounting-workspace-id',expectedAccountingSourcesSha256:'expected-accounting-sources-sha256',accountingConfig:'accounting-config'
});
const PATH_OPTIONS=new Set(['sourceRoot','output','resumeFrom','chromium','sdkModule','ledgerSource','registrySource','captureOptions','captureCheckpoint','archivePath','accountingDirectory','accountingConfig']);
export function receivingArguments(options={}){
  for(const name of Object.keys(options))need(Object.hasOwn(RUN_FLAGS,name)||['keepOpen','signal','onEvent','onStdout','onStderr'].includes(name),'UNKNOWN_OPTION','Unknown receiving option: '+name);
  need(present(options.sourceRoot)&&present(options.output),'RECEIVING_SELECTION','Select both the received source root and a new output directory.');
  need(!present(options.keepOpen)||typeof options.keepOpen==='boolean','RECEIVING_BOOLEAN','keepOpen must be a boolean.');
  for(const key of ['from','before'])if(present(options[key])){
    const day=options[key];need(typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T00:00:00Z'))&&new Date(day+'T00:00:00Z').toISOString().slice(0,10)===day,'RECEIVING_PERIOD','Use an exact civil date for '+key+'.');
  }
  if(options.from&&options.before)need(options.before>options.from,'RECEIVING_PERIOD','The excluded end date must follow the included start date.');
  const args=[];
  for(const [key,flag] of Object.entries(RUN_FLAGS))if(present(options[key])){
    need(typeof options[key]==='string'&&options[key].trim()&&!options[key].includes('\0'),'RECEIVING_VALUE','Provide a complete string value for '+flag+'.');
    args.push('--'+flag,PATH_OPTIONS.has(key)?resolve(options[key]):options[key]);
  }
  if(options.keepOpen)args.push('--keep-open');return args;
}
function launch(node,args,options={}){
  const ownGroup=process.platform!=='win32';
  const child=spawn(node,args,{stdio:['ignore','pipe','pipe'],shell:false,detached:ownGroup});
  let tail='',stderrTail='',pending='';const observerErrors=[];
  const observe=(callback,value)=>{if(!callback)return;try{callback(value);}catch(error){if(observerErrors.length<8)observerErrors.push(String(error.message||error));}};
  const lines=chunk=>{pending+=chunk;let next;while((next=pending.indexOf('\n'))!==-1){const line=pending.slice(0,next);pending=pending.slice(next+1);try{observe(options.onEvent,JSON.parse(line));}catch{}}
    if(pending.length>65536)pending=pending.slice(-65536);};
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
  child.stdout.on('data',chunk=>{tail=(tail+chunk).slice(-65536);observe(options.onStdout,chunk);lines(chunk);});
  child.stderr.on('data',chunk=>{stderrTail=(stderrTail+chunk).slice(-65536);observe(options.onStderr,chunk);});
  const signalGroup=(signal='SIGTERM')=>{
    if(!ownGroup||!child.pid)return false;
    try{process.kill(-child.pid,signal);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
  };
  const stopped=(signal='SIGTERM')=>{
    if(child.exitCode!==null||child.signalCode!==null||!child.pid)return false;
    return ownGroup?signalGroup(signal):child.kill(signal);
  };
  let groupCleanup=null;
  child.once('exit',()=>{try{groupCleanup={signal:'SIGTERM',delivered:signalGroup('SIGTERM')};}
    catch(error){groupCleanup={signal:'SIGTERM',error:{code:error.code||'PROCESS_GROUP_CLEANUP',message:error.message}};}});
  const abort=()=>stopped('SIGTERM');
  if(options.signal){if(options.signal.aborted)abort();else options.signal.addEventListener('abort',abort,{once:true});}
  const done=new Promise(resolveDone=>{
    let spawnError=null;child.once('error',error=>{spawnError={code:error.code||'SPAWN_ERROR',message:error.message};});
    child.once('close',(code,signal)=>{options.signal?.removeEventListener('abort',abort);if(pending.trim()){try{observe(options.onEvent,JSON.parse(pending));}catch{}}
      resolveDone({code,signal,error:spawnError,stdout:tail,stderr:stderrTail,observerErrors,groupCleanup});});
  });
  return {child,done,stop:stopped};
}

/** Archive metadata is cheap to inspect. verifyArchive streams the complete original archive. */
export async function receivingStatus({output,archivePath,verifyArchive=false}={}){
  output=pathValue(output,'the original receiving output directory');
  try{output=await realpath(output);}catch(error){if(error.code!=='ENOENT')throw error;}
  const invocationFile=output+'.invocation.json',snapshotFile=join(output,'receiving.json');
  const [invocationRead,snapshotRead,liveRead,postRead]=await Promise.all([
    readOptional(invocationFile),readOptional(snapshotFile),readOptional(output+'.live-reopened.json'),readOptional(output+'.post-archive-error.json')]);
  const invocation=invocationRead?.value,snapshot=snapshotRead?.value,issues=[];
  for(const [name,value] of [['invocation',invocationRead],['receiving',snapshotRead],['live',liveRead],['postArchive',postRead]])if(value?.error)issues.push({part:name,...value.error});
  if(snapshot)need(snapshot.schema==='stellar-forge.carbon-native-receiving.v1'&&snapshot.operation===OPERATION&&resolve(snapshot.output)===output,'RECEIVING_IDENTITY','Select the original receiving snapshot and its output directory.');
  if(invocation)need(invocation.schema==='stellar-forge.carbon-native-invocation.v1'&&invocation.operation===OPERATION&&resolve(invocation.output)===output,'INVOCATION_IDENTITY','Select the invocation belonging to this original output.');
  const archive=pathValue(archivePath||snapshot?.delivery?.archive||invocation?.archivePath||output+'.tar.gz','the original archive path');
  const descriptorPath=archive+'.json',descriptorRead=await readOptional(descriptorPath),descriptor=descriptorRead?.value;
  if(descriptorRead?.error)issues.push({part:'archiveDescriptor',...descriptorRead.error});
  let archiveStat=null,archiveComplete=false,actualSha256=null;
  try{archiveStat=await lstat(archive,{bigint:true});}catch(error){if(error.code!=='ENOENT')issues.push({part:'archive',code:error.code,message:error.message});}
  if(descriptor){
    const member=descriptor.members?.find(row=>row.path==='output/receiving.json');
    archiveComplete=descriptor.schema==='stellar-forge.native-receiving-archive.v1'&&descriptor.operation===OPERATION&&descriptor.status==='complete'
      &&snapshot?.status==='complete'&&resolve(descriptor.outputDirectory||'.')===output&&resolve(descriptor.archive||'.')===archive
      &&resolve(descriptor.sourceRoot||'.')===resolve(snapshot.sourceRoot||'.')&&snapshot.delivery?.archive&&resolve(snapshot.delivery.archive)===archive
      &&descriptor.createdAt===snapshot.completedAt&&/^[a-f0-9]{64}$/.test(descriptor.sha256)&&Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0
      &&archiveStat?.isFile()&&archiveStat.size===BigInt(descriptor.bytes)&&member?.sha256===hash(snapshotRead.body)
      &&String(member.bytes)===String(snapshotRead.body.length);
    if(!archiveComplete)issues.push({part:'archive',code:'ARCHIVE_IDENTITY',message:'The complete descriptor, archive file and immutable receiving snapshot must agree.'});
  }
  if(verifyArchive&&archiveComplete){
    const handle=await open(archive,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    try{
      const before=await handle.stat({bigint:true});need(sameStat(before,archiveStat),'ARCHIVE_CHANGED','The archive changed before verification.');
      const digest=createHash('sha256');let bytes=0n;
      for await(const chunk of handle.createReadStream({autoClose:false})){digest.update(chunk);bytes+=BigInt(chunk.length);}
      actualSha256=digest.digest('hex');
      archiveComplete=bytes===archiveStat.size&&sameStat(before,await handle.stat({bigint:true}))&&actualSha256===descriptor.sha256;
      if(!archiveComplete)issues.push({part:'archive',code:'ARCHIVE_DIGEST',message:'The complete archive bytes differ from their descriptor.'});
    }finally{await handle.close();}
  }
  const processRunning=await observeProcess(invocation);
  const live=liveRead?.value,post=postRead?.value;
  const liveMatches=live?.operation===OPERATION&&live.archive&&resolve(live.archive)===archive&&live.archiveSha256===descriptor?.sha256;
  const state=archiveComplete?'complete':descriptor?'archive-invalid':snapshot?.status==='interrupted'?'interrupted':
    snapshot?.status==='complete'?'archive-pending':processRunning===true?'running':invocation?.state==='spawn-error'?'interrupted':
    (snapshot||invocation)?'incomplete':'not-started';
  return {schema:'stellar-forge.carbon-native-status.v1',operation:OPERATION,state,output,sourceRoot:snapshot?.sourceRoot||invocation?.sourceRoot||null,
    invocationFile:invocation?invocationFile:null,receivingFile:snapshot?snapshotFile:null,
    process:{running:processRunning,recordedState:invocation?.state||null,pid:invocation?.process?.pid||null,exitCode:invocation?.exitCode??null,signal:invocation?.signal||null},
    startedAt:snapshot?.startedAt||invocation?.startedAt||null,completedAt:archiveComplete?descriptor.completedAt:null,
    stages:(snapshot?.stages||[]).map(({name,status,startedAt,completedAt,error})=>({name,status,startedAt,completedAt,error})),
    workspaces:snapshot?.workspaces||{},accounting:snapshot?.accounting||null,resume:snapshot?.resume||invocation?.resume||null,
    errors:[...(snapshot?.errors||[]),...(post?.error?[{stage:'live-reopen',...post.error}]:[])],
    archive:{path:archive,descriptor:descriptorPath,complete:Boolean(archiveComplete),bytes:descriptor?.bytes??null,sha256:descriptor?.sha256||null,
      verification:actualSha256?'sha256':archiveComplete?'metadata':'pending',actualSha256,members:descriptor?.memberCount??null},
    live:liveMatches?{stellarcarbon:live.stellarcarbon,givecredit:live.givecredit,observed:processRunning===true?'open':processRunning===false?'closed':'unknown'}:null,issues};
}

export class CarbonNativeReceivingClient{
  constructor({nodeExecutable=process.execPath}={}){this.nodeExecutable=pathValue(nodeExecutable,'the existing Node executable');}
  inspectSource(options){return inspectReceivingSource(options);}
  async prepareSdk(options){const {prepareSdkRuntime}=await import('./prepare-sdk-runtime.mjs');return prepareSdkRuntime(options);}
  async prepareLedgerInputs(options){
    const source=await inspectReceivingSource(options),body=await regular(source.manifest.path),manifest=json(body);
    need(hash(body)===source.manifest.sha256&&manifest.files.some(file=>file.path==='receiving/prepare-ledger-inputs.mjs'),'SOURCE_CLOSURE','Select the complete source packet containing its original historical input reader.');
    const {prepareArchiveInputs}=await import(pathToFileURL(join(source.sourceRoot,'receiving/prepare-ledger-inputs.mjs')).href);
    return prepareArchiveInputs({...options,sourceRoot:source.sourceRoot});
  }
  status(options){return receivingStatus(options);}
  verify(options){return receivingStatus({...options,verifyArchive:true});}
  async receiveSource({downloads,sourceRoot,signal,onStderr}={}){
    need(Number(process.versions.node.split('.')[0])>=22,'NODE_VERSION','Use the existing Node 22 or newer runtime.');
    downloads=pathValue(downloads,'the complete original download directory');sourceRoot=pathValue(sourceRoot,'a new private source directory');await absent(sourceRoot);
    need(!signal?.aborted,'RECEIVING_ABORTED','Source receiving was cancelled before execution.');
    const script=fileURLToPath(new URL('./receive-source.mjs',import.meta.url));
    const processRun=launch(this.nodeExecutable,[script,downloads,sourceRoot],{signal,onStderr}),result=await processRun.done;
    need(!result.error&&result.code===0,'SOURCE_RECEIVING_FAILED',result.error?.message||'Source receiving exited with '+String(result.code)+': '+result.stderr.slice(-4000));
    return inspectReceivingSource({sourceRoot});
  }
  async start(options={}){
    need(Number(process.versions.node.split('.')[0])>=22,'NODE_VERSION','Use the existing Node 22 or newer runtime.');
    receivingArguments(options);need(!options.signal?.aborted,'RECEIVING_ABORTED','Receiving was cancelled before execution.');
    const source=await inspectReceivingSource(options);
    const selectedOutput=pathValue(options.output,'a new receiving output directory');
    const parent=await realpath(dirname(selectedOutput)),output=join(parent,relative(dirname(selectedOutput),selectedOutput));
    const archivePath=await canonicalTarget(pathValue(options.archivePath||output+'.tar.gz','a new complete archive path'));
    const resume=present(options.resumeFrom)?await inspectResumeOutput(options.resumeFrom):null;
    if(resume){
      need(source.capabilities.resumeFrom==='preserved-output-v1','RESUME_SOURCE_CAPABILITY','Receive the complete current source packet with preserved-output-v1 recovery before resuming this saved run.');
      need(!inside(resume.directory,source.sourceRoot)&&!inside(source.sourceRoot,resume.directory),'RESUME_DIRECTORIES','Keep the current source and preserved original output in separate directories.');
    }
    need(!inside(source.sourceRoot,output)&&!inside(output,source.sourceRoot),'RECEIVING_DIRECTORIES','Keep the original source and operated output in separate directories.');
    need(!inside(source.sourceRoot,archivePath)&&!inside(output,archivePath),'RECEIVING_ARCHIVE','Place the final archive outside the source and operated output.');
    const invocationFile=output+'.invocation.json';
    const reserved=[output,archivePath,archivePath+'.json',invocationFile,output+'.live-reopened.json',output+'.post-archive-error.json'];
    need(new Set(reserved).size===reserved.length,'RECEIVING_ARCHIVE','Select separate archive, descriptor and invocation paths.');
    for(const path of reserved){
      if(resume)need(!inside(resume.directory,path)&&!inside(path,resume.directory),'RESUME_DIRECTORIES','Keep every continuation output, archive and sidecar outside the preserved original output.');
      await absent(path);
    }
    if(resume){
      const current=await inspectResumeOutput(resume.directory);
      need(current.receiving.sha256===resume.receiving.sha256&&current.receiving.bytes===resume.receiving.bytes,'RESUME_CHANGED','The original receiving snapshot changed during continuation selection.');
    }
    const args=receivingArguments({...options,...(resume?{resumeFrom:resume.directory}:{}),sourceRoot:source.sourceRoot,output,archivePath});
    const invocation={schema:'stellar-forge.carbon-native-invocation.v1',operation:OPERATION,startedAt:new Date().toISOString(),state:'starting',
      sourceRoot:source.sourceRoot,sourceManifest:source.manifest,output,archivePath,nodeExecutable:this.nodeExecutable,resume,
      script:join(source.sourceRoot,'receiving/receive-native.mjs'),args,process:null};
    await writeFile(invocationFile,JSON.stringify(invocation,null,2)+'\n',{flag:'wx',mode:0o600});
    const running=launch(this.nodeExecutable,[invocation.script,...args],options);
    invocation.process=await identity(running.child.pid||0);invocation.state=running.child.pid?'running':'spawn-error';
    try{await writeState(invocationFile,invocation);}catch(error){running.stop('SIGTERM');await running.done;throw Object.assign(error,{output,invocationFile});}
    const completion=running.done.then(async exit=>{
      Object.assign(invocation,{state:exit.error?'spawn-error':'exited',finishedAt:new Date().toISOString(),exitCode:exit.code,signal:exit.signal,error:exit.error,observerErrors:exit.observerErrors,groupCleanup:exit.groupCleanup});
      let invocationError=null;try{await writeState(invocationFile,invocation);}catch(error){invocationError={part:'invocation',code:error.code||'INVOCATION_WRITE',message:error.message};}
      const status=await receivingStatus({output,archivePath});if(invocationError)status.issues.push(invocationError);
      if(exit.error||exit.code!==0||!status.archive.complete)throw Object.assign(new Error(exit.error?.message||'The native operation retained its current receiving state and source diagnostics.'),{code:'NATIVE_RECEIVING_INTERRUPTED',exitCode:exit.code,signal:exit.signal,status});
      return status;
    });
    return {pid:running.child.pid||null,sourceRoot:source.sourceRoot,output,invocationFile,completion,stop:running.stop};
  }
  async run(options){const run=await this.start(options);return run.completion;}
}
