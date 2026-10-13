// MIT. Continue the same native operation from its preserved closed output.
import {createReadStream,constants} from 'node:fs';
import {readFile,writeFile,mkdir,open,rename,unlink,lstat,realpath,cp,link} from 'node:fs/promises';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {hostname} from 'node:os';

const need=(value,code,message)=>{if(!value)throw Object.assign(new Error(message),{code});return value;};
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const inside=(root,path)=>{const name=relative(root,path);return name===''||(!name.startsWith('..'+sep)&&name!=='..'&&!isAbsolute(name));};
const portable=name=>typeof name==='string'&&name&&!name.includes('\\')&&!name.includes('\0')&&!name.startsWith('/')&&name.split('/').every(part=>part&&part!=='.'&&part!=='..');
export async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
export async function writeArtifact(path,content){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}
  try{await link(temporary,path);}finally{await unlink(temporary);}
  const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
  try{await parent.sync();}finally{await parent.close();}
}
export async function atomicJSON(path,value){
  const temporary=path+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
  try{await rename(temporary,path);}catch(error){await unlink(temporary).catch(()=>{});throw error;}
  const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY);
  try{await parent.sync();}finally{await parent.close();}
}
export async function nativeProcess(pid){
  const self=pid===undefined;if(self)pid=process.pid;
  let bootId=null,startTicks=null,state=null,procPid=null;
  try{bootId=(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim();}catch{}
  try{const stat=await readFile(self?'/proc/self/stat':'/proc/'+pid+'/stat','utf8');
    procPid=Number(stat.slice(0,stat.indexOf(' ')))||null;
    const fields=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);startTicks=fields[19]||null;state=fields[0]||null;}catch{}
  return {hostname:hostname(),pid,procPid,bootId,startTicks,state};
}
export async function observedRunning(saved){
  if(!Number.isSafeInteger(saved?.pid)||saved.pid<=0||!saved.bootId||!saved.startTicks||saved.hostname!==hostname())return null;
  const current=await nativeProcess(Number.isSafeInteger(saved.procPid)&&saved.procPid>0?saved.procPid:saved.pid);
  return current.bootId===saved.bootId&&current.startTicks===saved.startTicks&&!['Z','X'].includes(current.state);
}
export async function nativeResources(context={}){
  const cgroup={};
  for(const name of ['memory.current','memory.max','memory.peak','memory.events']){
    try{cgroup[name]=(await readFile('/sys/fs/cgroup/'+name,'utf8')).trim();}catch{}
  }
  return {at:new Date().toISOString(),...context,memory:process.memoryUsage(),resourceUsage:process.resourceUsage(),cgroup};
}
async function fileIdentity(path){
  const before=await lstat(path);
  need(before.isFile()&&!before.isSymbolicLink(),'RESUME_ARTIFACT','Keep the retained artifact as an original regular file: '+path);
  const digest=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){bytes+=chunk.length;digest.update(chunk);}
  const after=await lstat(path);
  need(before.size===bytes&&after.size===bytes&&before.ino===after.ino&&before.dev===after.dev&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,
    'RESUME_ARTIFACT_CHANGED','The retained artifact changed during recovery: '+path);
  return {bytes,sha256:digest.digest('hex')};
}
export function rebaseOutput(value,previousOutput,output){
  if(typeof value==='string'&&isAbsolute(value)&&inside(previousOutput,value))return join(output,relative(previousOutput,value));
  if(Array.isArray(value))return value.map(row=>rebaseOutput(row,previousOutput,output));
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,row])=>[key,rebaseOutput(row,previousOutput,output)]));
  return value;
}
export async function verifyNativeSource(sourceRoot){
  const body=await readFile(join(sourceRoot,'receiving/source-manifest.json'));
  const manifest=JSON.parse(body);
  need(manifest.schema==='stellar-forge.native-source-manifest.v1'&&Array.isArray(manifest.files),'SOURCE_MANIFEST','Receive the complete original native source manifest.');
  const seen=new Set();let totalBytes=0;
  for(const file of manifest.files){
    need(portable(file.path)&&!seen.has(file.path),'SOURCE_PATH','Keep unique complete source paths.');seen.add(file.path);
    const path=join(sourceRoot,...file.path.split('/'));
    need(inside(sourceRoot,await realpath(path)),'SOURCE_PATH','An original source path leaves the selected source root: '+file.path);
    const bytes=await readFile(path),git=createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
    need(bytes.length===file.bytes&&git===file.gitBlobSha1,'SOURCE_CHANGED','The retained source file changed: '+file.path);
    totalBytes+=bytes.length;
  }
  return {manifest,identity:{path:join(sourceRoot,'receiving/source-manifest.json'),bytes:body.length,sha256:sha(body),
    sourceCommit:manifest.sourceCommit,files:seen.size,sourceBytes:totalBytes}};
}

/**
 * Read and copy the complete saved output. Every recorded immutable artifact is
 * checked before the copy. The original directory and receipt remain unchanged.
 * Current source and original output are separate; a restored output may have a
 * different path from the one recorded by its original native process.
 */
export async function prepareNativeRecovery({resumeFrom,output,sourceRoot,operation}){
  output=resolve(output);sourceRoot=await realpath(resolve(sourceRoot));
  need(!inside(sourceRoot,output)&&!inside(output,sourceRoot),'RECEIVING_DIRECTORIES','Keep current source and operated output in separate directories.');
  need(!(await exists(output)),'RECEIVING_EXISTS','Select a new private continuation output directory.');
  const source=await verifyNativeSource(sourceRoot);
  if(!resumeFrom){await mkdir(output,{mode:0o700});return {previous:null,source};}
  need(source.manifest.capabilities?.resumeFrom==='preserved-output-v1','RESUME_SOURCE_CAPABILITY','Use the complete source edition with preserved-output-v1 continuation.');
  const from=await realpath(resolve(resumeFrom)),info=await lstat(from);
  need(info.isDirectory()&&!info.isSymbolicLink(),'RESUME_DIRECTORY','Select the preserved original output directory.');
  need(!inside(from,output)&&!inside(output,from)&&!inside(from,sourceRoot)&&!inside(sourceRoot,from),
    'RESUME_DIRECTORIES','Keep original output, new output and current source in separate directories.');
  const originalReceiptPath=join(from,'receiving.json'),body=await readFile(originalReceiptPath),previous=JSON.parse(body);
  need(previous.schema==='stellar-forge.carbon-native-receiving.v1'&&previous.operation===operation
    &&typeof previous.output==='string'&&isAbsolute(previous.output)&&typeof previous.sourceRoot==='string'&&isAbsolute(previous.sourceRoot)
    &&Array.isArray(previous.stages)&&Array.isArray(previous.artifacts)&&previous.workspaces&&typeof previous.workspaces==='object',
    'RESUME_IDENTITY','Select this operation’s complete original receiving receipt and output.');
  const observations=[];
  const observe=async(process,source)=>{
    const running=await observedRunning(process);observations.push({source,process:process||null,running});
    need(running!==true,'RESUME_RUNNING','The original native process is still running. Continue that process before reopening its output.');
  };
  await observe(previous.process,originalReceiptPath);
  for(const path of new Set([from+'.invocation.json',resolve(previous.output)+'.invocation.json'])){
    if(!(await exists(path)))continue;
    try{
      const invocation=JSON.parse(await readFile(path,'utf8'));
      if(invocation.schema==='stellar-forge.carbon-native-invocation.v1'&&invocation.operation===operation
        &&[from,resolve(previous.output)].includes(resolve(invocation.output))&&resolve(invocation.sourceRoot)===resolve(previous.sourceRoot))
        await observe(invocation.process,path);
    }catch(error){if(error.code==='RESUME_RUNNING')throw error;observations.push({source:path,running:null,error:{code:error.code||null,message:error.message}});}
  }
  const names=new Set();
  for(const artifact of previous.artifacts){
    need(portable(artifact.path)&&!names.has(artifact.path),'RESUME_ARTIFACT_PATH','Keep unique complete relative artifact paths.');names.add(artifact.path);
    const path=join(from,...artifact.path.split('/'));
    need(inside(from,await realpath(path)),'RESUME_ARTIFACT_PATH','A saved artifact leaves the original output: '+artifact.path);
    const actual=await fileIdentity(path);
    need(actual.bytes===artifact.bytes&&actual.sha256===artifact.sha256,'RESUME_ARTIFACT_CHANGED','Restore the complete original artifact: '+artifact.path);
  }
  need(sha(await readFile(originalReceiptPath))===sha(body),'RESUME_CHANGED','The original receiving receipt changed during selection.');
  await observe(previous.process,originalReceiptPath);
  // cp owns the new destination; pre-creating it conflicts with errorOnExist.
  await cp(from,output,{recursive:true,errorOnExist:true,force:false,dereference:false,preserveTimestamps:true,verbatimSymlinks:true});
  const originalReceiptSha256=sha(body),retained='recovery/'+originalReceiptSha256+'.receiving.json';
  await mkdir(join(output,'recovery'),{recursive:true,mode:0o700});
  if(await exists(join(output,retained)))need(sha(await readFile(join(output,retained)))===originalReceiptSha256,'RESUME_RECEIPT_CHANGED','Preserve the original receiving receipt.');
  else await writeFile(join(output,retained),body,{flag:'wx',mode:0o600});
  const resume={schema:'stellar-forge.native-preserved-output.v1',from,originalOutput:previous.output,originalSourceRoot:previous.sourceRoot,
    originalReceiptPath,originalReceiptSha256,originalReceiptBytes:body.length,retainedReceipt:retained,originalOperation:previous.operation,
    originalStatus:previous.status||null,originalStartedAt:previous.startedAt,startedAt:new Date().toISOString(),
    completedStages:previous.stages.filter(row=>row.status==='complete').map(row=>row.name),
    reusedArtifacts:previous.artifacts.length,processObservations:observations};
  return {previous,recovered:rebaseOutput(previous,resolve(previous.output),output),resume,source};
}

/** Recover complete browser identifiers from its immutable action records. */
export async function recoverBrowserJourney(output,stageValue,workspaces,prefix=''){
  const path=name=>join(output,prefix,'browser-actions',name),read=async name=>JSON.parse(await readFile(path(name),'utf8'));
  const complete=await read('complete.json');
  const first=await read('actions/01.json'),assigned=await read('actions/02.json'),statement=await read('actions/03.json');
  need(complete.schema==='stellar-forge.carbon-browser-actions.v1'&&complete.completedAt,
    'RESUME_BROWSER_INCOMPLETE','Keep the whole completed original browser action record.');
  const customer=first.result?.customer,project=first.result?.project,assignment=assigned.result?.assignment;
  need(customer?.id&&project?.id&&assignment?.id&&statement.result?.statementId,'RESUME_BROWSER_IDENTITIES','Keep the original browser customer, project, assignment and statement identities.');
  return {...complete,...stageValue,carbonReceived:workspaces.stellarcarbonBrowserReceived,giveReceived:workspaces.givecreditBrowserReceived,
    carbonCustomerId:customer.id,carbonProjectId:project.id,carbonAssignmentId:assignment.id,
    carbonStatementId:statement.result.statementId,giveStatementId:stageValue.giveStatementId};
}
