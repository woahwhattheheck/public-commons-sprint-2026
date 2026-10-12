// MIT. Complete cold accounting-state recovery over the original SF101 engine.
import {constants} from 'node:fs';
import {copyFile,link,lstat,mkdir,mkdtemp,open,readdir,realpath,rm,unlink} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';

const ENGINE=fileURLToPath(new URL('../../sf101-merchant-recovery/recover.mjs',import.meta.url));
const STATE='stellar-forge.merchant-accounting-workspace.v1';
const BACKUP='stellar-forge.accounting-operating-backup.v1';
const MAPPING='stellar-forge.accounting-operating-map.v1';
const RESTORE='stellar-forge.accounting-operating-restore.v1';
export const RESTORE_MARKER='recovery-restore.json';
const MAX_FILES=9990,MAX_BYTES=4*1024**3,MAX_FILE=2*1024**3;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const json=value=>JSON.stringify(value,null,2)+'\n';
const inside=(parent,path)=>parent===path||path.startsWith(parent+sep);
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const need=(ok,code,message)=>{if(!ok)fail(code,message);};
const aborted=signal=>{if(signal?.aborted)fail('ACCOUNTING_RECOVERY_CANCELLED','Accounting recovery was cancelled. Resume the same backup if a restore was in progress.');};
function absolute(path){need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!=='/'&&!path.includes('\0'),'ACCOUNTING_RECOVERY_PATH','Use an absolute normalized private path.');return path;}
async function info(path){try{return await lstat(path,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}}
function regular(st){return st?.isFile()&&!st.isSymbolicLink()&&st.nlink===1n&&st.size<=BigInt(MAX_FILE);}
function version(st){return [st.dev,st.ino,st.mode,st.nlink,st.size,st.mtimeNs,st.ctimeNs].map(String).join(':');}
async function privateRoot(path){
  absolute(path);const st=await info(path);
  need(st?.isDirectory()&&!st.isSymbolicLink()&&(st.mode&0o077n)===0n&&
    (process.getuid===undefined||st.uid===BigInt(process.getuid()))&&await realpath(path)===path,
  'ACCOUNTING_RECOVERY_PRIVATE_ROOT','Use a real, owner-private directory with mode 0700.');return path;
}
function beneath(root,path){absolute(path);need(path!==root&&inside(root,path),'ACCOUNTING_RECOVERY_SCOPE','Every retained operating source must be inside the selected private state root.');return path;}
async function directories(root,path,{create=false}={}){
  need(inside(root,path),'ACCOUNTING_RECOVERY_SCOPE','A destination escaped the private state root.');
  let current=root;
  for(const part of relative(root,path).split(sep).filter(Boolean)){
    current=join(current,part);let st=await info(current);
    if(!st&&create){try{await mkdir(current,{mode:0o700});await syncDirectory(dirname(current));}catch(error){if(error.code!=='EEXIST')throw error;}st=await info(current);}
    if(!st)return false;
    need(st.isDirectory()&&!st.isSymbolicLink()&&(process.getuid===undefined||st.uid===BigInt(process.getuid())),
      'ACCOUNTING_RECOVERY_DIRECTORY','Operating paths require real directories owned by the current account.');
  }return true;
}
async function syncDirectory(path){const fd=await open(path,constants.O_RDONLY|(constants.O_DIRECTORY??0));try{await fd.sync();}finally{await fd.close();}}
async function writeNew(path,bytes){const fd=await open(path,'wx',0o600);try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}}
async function readBytes(path,max){
  const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{const before=await fd.stat({bigint:true});need(regular(before)&&before.size<=BigInt(max),'ACCOUNTING_RECOVERY_FILE','Expected a bounded regular retained file.');
    const bytes=await fd.readFile();need(bytes.length<=max&&version(before)===version(await fd.stat({bigint:true})),'ACCOUNTING_RECOVERY_SOURCE_CHANGED','A retained source changed while it was read.');return bytes;
  }finally{await fd.close();}
}
async function readJSON(path,max=32_000_000){let value;try{value=JSON.parse((await readBytes(path,max)).toString('utf8'));}catch(error){if(error.code)throw error;fail('ACCOUNTING_RECOVERY_JSON','A retained recovery file is not valid JSON.');}return value;}
async function digest(path,signal){
  aborted(signal);const fd=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{const before=await fd.stat({bigint:true});need(regular(before),'ACCOUNTING_RECOVERY_FILE','Expected an unlinked regular operating file.');
    const sha=createHash('sha256');let bytes=0;
    for await(const chunk of fd.createReadStream({autoClose:false})){aborted(signal);bytes+=chunk.length;need(bytes<=MAX_FILE,'ACCOUNTING_RECOVERY_LIMIT','Operating file exceeds the original recovery limit.');sha.update(chunk);}
    const after=await fd.stat({bigint:true});need(version(before)===version(after)&&bytes===Number(after.size),'ACCOUNTING_RECOVERY_SOURCE_CHANGED','A retained source changed while it was read.');
    return {sha256:sha.digest('hex'),bytes,version:version(after)};
  }finally{await fd.close();}
}
function rootsFor(state,root,directory){
  need(object(state)&&state.schema===STATE&&Number.isSafeInteger(state.revision)&&object(state.sources)&&Array.isArray(state.runs)&&Array.isArray(state.proofs)&&object(state.notes),'ACCOUNTING_RECOVERY_WORKSPACE','Select an existing original accounting workspace.');
  const roots=[{name:'Accounting',path:beneath(root,directory),kind:'directory'},
    ...[['Outbox','outboxDir','directory'],['Proofs','proofDir','directory'],['Terms','termsFile','file'],['Recovered','recoveredDir','directory']]
      .filter(([,key])=>key!=='recoveredDir'||state.sources[key]!==undefined)
      .map(([name,key,kind])=>({name,path:beneath(root,state.sources[key]),kind}))];
  for(const other of roots.slice(1))need(!inside(directory,other.path)&&!inside(other.path,directory),'ACCOUNTING_RECOVERY_OVERLAP','The accounting workspace must remain separate from its external sources.');
  roots.sort((a,b)=>a.path.length-b.path.length||a.path.localeCompare(b.path));
  const selected=[];
  for(const item of roots){const parent=selected.find(r=>inside(r.path,item.path));
    if(parent){need(parent.kind==='directory'||parent.path===item.path&&parent.kind===item.kind,'ACCOUNTING_RECOVERY_OVERLAP','Invalid overlapping source roots.');continue;}selected.push(item);}
  return selected.sort((a,b)=>a.name.localeCompare(b.name));
}

const HOST_PROFILE='stellar-forge.accounting-host-source-profile.v1';
function hostProfile(value,stateRoot){
  need(object(value)&&value.schema===HOST_PROFILE&&/^[a-z][a-z0-9-]{0,63}$/.test(value.kind)&&object(value.binding)&&
    Array.isArray(value.roots)&&value.roots.length>0&&value.roots.length<=256&&
    Array.isArray(value.requiredEnvironment)&&value.requiredEnvironment.length<=256&&
    value.requiredEnvironment.every(name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name))&&
    Object.keys(value).every(key=>['schema','kind','binding','roots','requiredEnvironment'].includes(key)),
    'ACCOUNTING_RECOVERY_HOST_PROFILE','Use the original trusted host source profile.');
  const names=new Set(),roots=value.roots.map(item=>{
    need(object(item)&&Object.keys(item).every(key=>['name','path','kind'].includes(key))&&
      /^[A-Za-z][A-Za-z0-9_-]{0,95}$/.test(item.name)&&!names.has(item.name)&&['directory','file'].includes(item.kind),
      'ACCOUNTING_RECOVERY_HOST_PROFILE','The host source profile needs unique named files or directories.');
    names.add(item.name);return {name:item.name,path:beneath(stateRoot,item.path),kind:item.kind};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  const profile={schema:HOST_PROFILE,kind:value.kind,binding:value.binding,roots,
    requiredEnvironment:[...new Set(value.requiredEnvironment)].sort()};
  need(Buffer.byteLength(json(profile))<=256*1024,'ACCOUNTING_RECOVERY_HOST_PROFILE','The trusted host source profile exceeds 256 KiB.');
  return profile;
}
function additionalHostRoots(profile,roots){
  if(!profile)return [];
  const selected=[];
  for(const item of [...profile.roots].sort((a,b)=>a.path.length-b.path.length||a.path.localeCompare(b.path))){
    const covered=roots.find(root=>inside(root.path,item.path));
    if(covered){need(covered.kind==='directory'||covered.path===item.path&&covered.kind===item.kind,
      'ACCOUNTING_RECOVERY_OVERLAP','A host source overlaps an original file.');continue;}
    need(!roots.some(root=>inside(item.path,root.path)),'ACCOUNTING_RECOVERY_OVERLAP',
      'A host source may be inside an existing captured directory; it must not contain an original operating root.');
    const parent=selected.find(root=>inside(root.path,item.path));
    if(parent){need(parent.kind==='directory'||parent.path===item.path&&parent.kind===item.kind,
      'ACCOUNTING_RECOVERY_OVERLAP','Host source roots overlap incompatible source types.');continue;}
    selected.push(item);
  }
  return selected.sort((a,b)=>a.name.localeCompare(b.name));
}
function hostSummary(profile,inventory){
  if(!profile)return null;
  const files=inventory.entries.filter(entry=>entry.kind==='file'&&profile.roots.some(root=>inside(root.path,entry.path)));
  return {kind:profile.kind,profileSha256:hash(json(profile)),roots:profile.roots.length,files:files.length,
    bytes:files.reduce((sum,item)=>sum+Number(item.version.split(':')[4]),0),
    requiredEnvironment:[...profile.requiredEnvironment]};
}
function validHostSummary(value){
  return object(value)&&typeof value.kind==='string'&&hex(value.profileSha256)&&
    ['roots','files','bytes'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)&&
    Array.isArray(value.requiredEnvironment)&&value.requiredEnvironment.length<=256&&
    value.requiredEnvironment.every(name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(name));
}
async function resolveLiveHostSources(hostSources,stateRoot,signal){
  if(hostSources===undefined)return {profile:null,readVersions:new Map()};
  need(typeof hostSources==='function','ACCOUNTING_RECOVERY_HOST_PROFILE','Use a trusted host source resolver.');
  const readVersions=new Map();
  const value=await hostSources({readFile:async(path,max)=>{
    aborted(signal);beneath(stateRoot,path);
    need(await directories(stateRoot,dirname(path)),'ACCOUNTING_RECOVERY_FILE','An original host source parent is missing.');
    const before=await info(path),bytes=await readBytes(path,max),after=await info(path);
    need(before&&after&&version(before)===version(after)&&(!readVersions.has(path)||readVersions.get(path)===version(after)),
      'ACCOUNTING_RECOVERY_SOURCE_CHANGED','An original host profile source changed while being resolved.');
    readVersions.set(path,version(after));return bytes;
  }});
  aborted(signal);const profile=hostProfile(value,stateRoot);
  for(const root of profile.roots)if(root.kind==='directory')await privateRoot(root.path);
  return {profile,readVersions};
}
async function stageHostSources(temporary,roots,before,signal){
  const entries=before.entries.filter(entry=>roots.some(root=>inside(root.path,entry.path)));
  if(!entries.length)return [];
  const target=join(temporary,'host');await mkdir(target,{mode:0o700});const result=[];
  for(const item of entries){
    aborted(signal);const name=hash(item.path),destination=join(target,name);
    if(item.kind==='directory'){await mkdir(destination,{mode:0o700});result.push({name,path:item.path,kind:item.kind});}
    else{
      await copyFile(item.path,destination,constants.COPYFILE_EXCL);
      const actual=await digest(destination,signal);
      result.push({name,path:item.path,kind:item.kind,size:actual.bytes,sha256:actual.sha256});
    }
  }
  return result;
}
function retainedHostEntries(value,roots,stateRoot){
  need(Array.isArray(value)&&value.length<MAX_FILES,'ACCOUNTING_RECOVERY_HOST_MAPPING','The authenticated host inventory is invalid.');
  const paths=new Map(),names=new Set();
  for(const item of value){
    need(object(item)&&Object.keys(item).every(key=>['name','path','kind','size','sha256'].includes(key))&&
      ['directory','file'].includes(item.kind)&&hex(item.name)&&item.name===hash(beneath(stateRoot,item.path))&&
      !paths.has(item.path)&&!names.has(item.name),
      'ACCOUNTING_RECOVERY_HOST_MAPPING','The authenticated host source identity is invalid.');
    const root=roots.find(root=>inside(root.path,item.path));
    need(root&&relative(root.path,item.path).split(sep).filter(Boolean).length<=16&&
      (root.path!==item.path||root.kind===item.kind)&&
      (item.kind==='file'?hex(item.sha256)&&Number.isSafeInteger(item.size)&&item.size>=0&&item.size<=MAX_FILE:
        item.sha256===undefined&&item.size===undefined),
      'ACCOUNTING_RECOVERY_HOST_MAPPING','The authenticated host inventory escaped its original source roots.');
    paths.set(item.path,item);names.add(item.name);
  }
  for(const root of roots)need(paths.get(root.path)?.kind===root.kind,
    'ACCOUNTING_RECOVERY_HOST_MAPPING','An original host source root is missing from the authenticated inventory.');
  for(const item of value)if(!roots.some(root=>root.path===item.path))
    need(paths.get(dirname(item.path))?.kind==='directory','ACCOUNTING_RECOVERY_HOST_MAPPING','A host source parent is missing.');
  return paths;
}

async function extrasFor(state,root,directory,roots,readConfig){
  const paths=new Set();
  need(state.recoveryPreviews===undefined||Array.isArray(state.recoveryPreviews)&&state.recoveryPreviews.length<=2000,'ACCOUNTING_RECOVERY_WORKSPACE','Invalid retained recovery reviews.');
  for(const preview of state.recoveryPreviews??[]){
    need(typeof preview.id==='string'&&/^[a-f0-9-]{36}$/.test(preview.id)&&hex(preview.configSha256),'ACCOUNTING_RECOVERY_WORKSPACE','Invalid original recovery review identity.');
    const bytes=await readConfig(join(directory,'inputs',preview.id+'.recovery.json'));
    need(hash(bytes)===preview.configSha256,'ACCOUNTING_RECOVERY_SOURCE_CHANGED','A saved original recovery request changed.');
    let config;try{config=JSON.parse(bytes.toString('utf8'));}catch{fail('ACCOUNTING_RECOVERY_JSON','Invalid original recovery request.');}
    need(object(config)&&config.schema==='stellar-forge.merchant-recovery-request.v1','ACCOUNTING_RECOVERY_WORKSPACE','Expected the original recovery request format.');
    for(const path of [config.outcomeFile,config.requestFile,config.termsFile,...(config.response?[config.response.file]:[])]){
      beneath(root,path);if(!roots.some(r=>inside(r.path,path)))paths.add(path);
    }
  }
  return [...paths].sort().map(path=>({name:hash(path),path}));
}
async function inventory(roots,extras,root,{missing=false,signal,exclude=new Set()}={}){
  const result=[];let files=0,bytes=0;
  async function walk(path,depth){
    aborted(signal);if(exclude.has(path))return;
    need(depth<=16&&result.length<MAX_FILES,'ACCOUNTING_RECOVERY_LIMIT','Operating state exceeds the original recovery entry or nesting limit.');
    const st=await info(path);if(!st&&missing)return;
    need(st&&!st.isSymbolicLink()&&(st.isDirectory()||regular(st)),'ACCOUNTING_RECOVERY_FILE','Operating state contains a missing, linked or unsupported source.');
    result.push({path,kind:st.isDirectory()?'directory':'file',version:version(st)});
    if(st.isDirectory())for(const name of (await readdir(path)).sort()){
      need(name!=='.'&&name!=='..'&&!name.includes('\\'),'ACCOUNTING_RECOVERY_FILE','Unsupported operating filename.');await walk(join(path,name),depth+1);
    }else{files++;bytes+=Number(st.size);need(bytes<=MAX_BYTES,'ACCOUNTING_RECOVERY_LIMIT','Operating state exceeds the original four GiB limit.');}
  }
  for(const item of roots){const parents=await directories(root,dirname(item.path));if(!parents&&missing)continue;
    need(parents,'ACCOUNTING_RECOVERY_FILE','A source parent is missing.');const st=await info(item.path);
    if(st)need(item.kind==='directory'?st.isDirectory():regular(st),'ACCOUNTING_RECOVERY_FILE','Original source type changed.');await walk(item.path,0);}
  for(const item of extras){const parents=await directories(root,dirname(item.path));if(!parents&&missing)continue;need(parents,'ACCOUNTING_RECOVERY_FILE','A recovery input parent is missing.');await walk(item.path,0);}
  return {entries:result,files,bytes};
}
function passOptions({passEnv='STARFORGE_ACCOUNTING_BACKUP_PASSPHRASE',passphrase}={}){
  need(/^[A-Z][A-Z0-9_]{4,63}$/.test(passEnv),'ACCOUNTING_RECOVERY_PASSPHRASE','Choose an uppercase passphrase environment variable name.');
  const value=passphrase??process.env[passEnv];need(typeof value==='string'&&Buffer.byteLength(value)>=16&&Buffer.byteLength(value)<=65536,'ACCOUNTING_RECOVERY_PASSPHRASE','Set a private passphrase of 16 to 65,536 bytes in the selected environment variable.');return {passEnv,value};
}
async function engine(command,options,credentials,signal){
  aborted(signal);const args=[ENGINE,command];for(const [key,value] of Object.entries(options)){args.push('--'+key);if(value!==true)args.push(value);}args.push('--pass-env',credentials.passEnv);
  return await new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{stdio:['ignore','pipe','pipe'],env:{...process.env,[credentials.passEnv]:credentials.value}});
    let output='',errorText='',failure,killTimer;
    const stop=()=>{failure??=Object.assign(new Error('Accounting recovery was cancelled. Resume the same restore if necessary.'),{code:'ACCOUNTING_RECOVERY_CANCELLED'});child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),2000);};
    const timeout=setTimeout(()=>{failure=Object.assign(new Error('The original recovery engine exceeded 30 minutes.'),{code:'ACCOUNTING_RECOVERY_TIMEOUT'});stop();},30*60_000);
    signal?.addEventListener('abort',stop,{once:true});if(signal?.aborted)stop();
    child.stdout.on('data',part=>{if(output.length+part.length>16_000){failure=new Error('Unexpected original recovery output.');stop();}else output+=part;});
    child.stderr.on('data',part=>{if(errorText.length<4000)errorText+=part.toString().slice(0,4000-errorText.length);});
    child.once('error',error=>{failure=error;});
    child.once('close',code=>{clearTimeout(timeout);clearTimeout(killTimer);signal?.removeEventListener('abort',stop);
      if(failure)return reject(failure);if(code!==0)return reject(Object.assign(new Error(errorText.trim()||'The original recovery engine did not complete.'),{code:'ACCOUNTING_RECOVERY_ENGINE'}));
      try{resolve(JSON.parse(output));}catch{reject(new Error('Invalid original recovery result.'));}
    });
  });
}
export async function accountingRecoveryStatus({directory}={}){
  await privateRoot(directory);const path=join(directory,RESTORE_MARKER),st=await info(path);
  if(!st)return {status:'NO_RESTORE_IN_PROGRESS',directory};
  const marker=await readJSON(path,16_000);need(marker.schema===RESTORE&&hex(marker.manifestSha256),'ACCOUNTING_RECOVERY_MARKER','The retained restore marker is invalid.');
  return {status:'RESTORE_IN_PROGRESS',directory,manifestSha256:marker.manifestSha256,startedAt:marker.startedAt,nextOperation:'Resume restore with the same authenticated backup and original paths.'};
}
async function retainedSources(directory,stateRoot,signal,hostSources){
  need(!(await info(join(directory,RESTORE_MARKER))),'ACCOUNTING_RECOVERY_INCOMPLETE','Complete the retained restore before taking another backup.');
  const stateBytes=await readBytes(join(directory,'workspace.json'),32_000_000),state=JSON.parse(stateBytes),roots=rootsFor(state,stateRoot,directory);
  const {profile,readVersions}=await resolveLiveHostSources(hostSources,stateRoot,signal),hostRoots=additionalHostRoots(profile,roots);
  const extras=await extrasFor(state,stateRoot,directory,[...roots,...hostRoots],path=>readBytes(path,200_000));
  const before=await inventory([...roots,...hostRoots],extras,stateRoot,{signal});
  const indexed=new Map(before.entries.map(item=>[item.path,item]));
  for(const [path,readVersion] of readVersions)need(indexed.get(path)?.kind==='file'&&indexed.get(path).version===readVersion,
    'ACCOUNTING_RECOVERY_SOURCE_CHANGED','A resolved host profile file changed or is absent from its declared operating inventory.');
  return {stateBytes,state,roots,hostRoots,profile,extras,before};
}
function sourceReview({directory,stateRoot,stateBytes,state,roots,profile,extras,before}){
  const workspaceSha256=hash(stateBytes),reviewId=hash(json({directory,stateRoot,workspaceSha256,inventory:before,...(profile?{hostProfile:profile}:{})}));
  const describe=item=>{const files=before.entries.filter(entry=>entry.kind==='file'&&inside(item.path,entry.path));return {...item,
    files:files.length,bytes:files.reduce((total,entry)=>total+Number(entry.version.split(':')[4]),0)};};
  return {status:'ACCOUNTING_SOURCES_REVIEWED',reviewId,directory,stateRoot,revision:state.revision,workspaceSha256,
    operatingFiles:before.files,operatingBytes:before.bytes,roots:[...roots,...(profile?.roots??[])].map(describe),auxiliaryInputs:extras.length,
    ...(profile?{hostSources:hostSummary(profile,before)}:{}),
    additionalSources:extras.map(item=>describe({...item,kind:'file'}))};
}
export async function reviewAccountingWorkspace({directory,stateRoot,quiesced=false,signal,hostSources}={}){
  need(quiesced===true,'ACCOUNTING_RECOVERY_QUIESCE','Pause the workspace and stop its original input writers before reviewing a backup.');
  await privateRoot(stateRoot);beneath(stateRoot,directory);await privateRoot(directory);
  const lease=await acquireStateLease(directory);
  try{const sources=await retainedSources(directory,stateRoot,signal,hostSources);aborted(signal);lease.assertHeld();return sourceReview({directory,stateRoot,...sources});}
  finally{await lease.close();}
}
export async function snapshotAccountingWorkspace({directory,stateRoot,output,quiesced=false,expectedReviewId,signal,hostSources,...password}={}){
  need(quiesced===true,'ACCOUNTING_RECOVERY_QUIESCE','Stop the workspace and all original input writers, then pass --quiesced.');
  need(expectedReviewId===undefined||hex(expectedReviewId),'ACCOUNTING_RECOVERY_REVIEW','Select an exact retained source review.');
  await privateRoot(stateRoot);beneath(stateRoot,directory);await privateRoot(directory);absolute(output);const credentials=passOptions(password);
  const lease=await acquireStateLease(directory);let temporary,created=false;
  try{
    const sources=await retainedSources(directory,stateRoot,signal,hostSources),{stateBytes,state,roots,hostRoots,profile,extras,before}=sources;
    const review=sourceReview({directory,stateRoot,...sources});
    need(!expectedReviewId||review.reviewId===expectedReviewId,'ACCOUNTING_RECOVERY_REVIEW_CHANGED','An original operating source changed after review. Review the paused source closure again before capturing it.');
    for(const item of [...roots,...hostRoots,...extras])need(!inside(item.path,output)&&!inside(output,item.path),'ACCOUNTING_RECOVERY_OVERLAP','Keep the new backup outside every captured operating source.');
    await privateRoot(dirname(output));temporary=await mkdtemp(join(dirname(output),'.accounting-snapshot-'));
    const hostEntries=await stageHostSources(temporary,hostRoots,before,signal);
    const mapping={schema:MAPPING,createdAt:new Date().toISOString(),directory,stateRoot,revision:state.revision,stateSha256:hash(stateBytes),sources:state.sources,roots,extras,
      ...(profile?{hostProfile:profile,hostEntries}:{})};
    const mappingBytes=Buffer.from(json(mapping));need(mappingBytes.length<=16*1024**2,'ACCOUNTING_RECOVERY_LIMIT','The encrypted source mapping exceeds 16 MiB.');
    await writeNew(join(temporary,'recovery.json'),mappingBytes);
    const plan={schema:'stellar-forge.merchant-recovery-plan.v1',roots:roots.map(({name,path})=>({name,path}))};
    if(extras.length){const auxiliary=join(temporary,'auxiliary');await mkdir(auxiliary,{mode:0o700});for(const item of extras){aborted(signal);await copyFile(item.path,join(auxiliary,item.name),constants.COPYFILE_EXCL);}plan.roots.push({name:'Auxiliary',path:auxiliary});}
    if(hostEntries.length)plan.roots.push({name:'Host',path:join(temporary,'host')});
    plan.roots.push({name:'Recovery',path:join(temporary,'recovery.json')});await writeNew(join(temporary,'plan.json'),json(plan));
    await mkdir(output,{mode:0o700});created=true;
    const result=await engine('snapshot',{plan:join(temporary,'plan.json'),out:join(output,'encrypted'),quiesced:true},credentials,signal);
    const after=await inventory([...roots,...hostRoots],extras,stateRoot,{signal});lease.assertHeld();
    need(JSON.stringify(before)===JSON.stringify(after),'ACCOUNTING_RECOVERY_SOURCE_CHANGED','An original source changed during backup. Stop its writer and retry into a new backup directory.');
    const manifestSha256=hash(await readBytes(join(output,'encrypted','manifest.json'),12*1024**2));
    const receipt={schema:BACKUP,createdAt:mapping.createdAt,manifestSha256,files:result.files,bytes:result.bytes,
      ...(profile?{hostSources:hostSummary(profile,before)}:{})};
    await writeNew(join(output,'backup.json'),json(receipt));await syncDirectory(join(output,'encrypted'));await syncDirectory(output);await syncDirectory(dirname(output));
    return {...receipt,status:'ACCOUNTING_BACKUP_CREATED',output,revision:state.revision,workspaceSha256:mapping.stateSha256,operatingFiles:before.files,operatingBytes:before.bytes,auxiliaryInputs:extras.length,reviewId:review.reviewId};
  }catch(error){if(created)await rm(output,{recursive:true,force:true});throw error;}
  finally{try{if(temporary)await rm(temporary,{recursive:true,force:true});}finally{await lease.close();}}
}
export async function inspectAccountingBackup({bundle,expectedSha256}={}){
  need(expectedSha256===undefined||hex(expectedSha256),'ACCOUNTING_RECOVERY_BACKUP','Supply the exact SHA256 of the selected encrypted manifest.');
  await privateRoot(bundle);const receipt=await readJSON(join(bundle,'backup.json'),65536);
  need(receipt.schema===BACKUP&&hex(receipt.manifestSha256)&&Number.isSafeInteger(receipt.files)&&Number.isSafeInteger(receipt.bytes),'ACCOUNTING_RECOVERY_BACKUP','This is not a completed accounting operating backup.');
  need(receipt.hostSources===undefined||validHostSummary(receipt.hostSources),'ACCOUNTING_RECOVERY_BACKUP','The retained host source summary is invalid.');
  const manifestBytes=await readBytes(join(bundle,'encrypted','manifest.json'),12*1024**2),manifestSha256=hash(manifestBytes);
  need(manifestSha256===receipt.manifestSha256&&(!expectedSha256||expectedSha256===manifestSha256),'ACCOUNTING_RECOVERY_BACKUP_CHANGED','The selected backup does not match its retained manifest identity.');
  return {status:'ENCRYPTED_BACKUP_PRESENT',bundle,manifestSha256,createdAt:receipt.createdAt,files:receipt.files,bytes:receipt.bytes,...(receipt.hostSources?{hostSources:receipt.hostSources}:{})};
}
export async function verifyAccountingBackup({bundle,expectedSha256,signal,...password}={}){
  const receipt=await inspectAccountingBackup({bundle,expectedSha256});
  const result=await engine('verify',{bundle:join(bundle,'encrypted')},passOptions(password),signal);
  await inspectAccountingBackup({bundle,expectedSha256:receipt.manifestSha256});
  need(result.files===receipt.files&&result.bytes===receipt.bytes,'ACCOUNTING_RECOVERY_BACKUP_CHANGED','The completed backup counts changed.');
  return {...receipt,status:'ACCOUNTING_BACKUP_VERIFIED'};
}
async function restoredMapping(stage,manifest,{directory,stateRoot,hostSources}){
  const mapping=await readJSON(join(stage,'Recovery'),16*1024**2);
  need(mapping.schema===MAPPING&&mapping.directory===directory&&mapping.stateRoot===stateRoot&&hex(mapping.stateSha256)&&Array.isArray(mapping.roots)&&Array.isArray(mapping.extras),
    'ACCOUNTING_RECOVERY_DESTINATION','Restore requires the original workspace path and private state root.');
  const stateBytes=await readBytes(join(stage,'Accounting','workspace.json'),32_000_000),state=JSON.parse(stateBytes),roots=rootsFor(state,stateRoot,directory);
  const profile=mapping.hostProfile===undefined?null:hostProfile(mapping.hostProfile,stateRoot);
  need(profile||mapping.hostEntries===undefined,'ACCOUNTING_RECOVERY_HOST_MAPPING','An authenticated host inventory requires its original source profile.');
  const hostRoots=additionalHostRoots(profile,roots),hostEntries=profile?retainedHostEntries(mapping.hostEntries,hostRoots,stateRoot):new Map();
  const stagedEntries=new Map(manifest.entries.map(item=>[item.path,item]));
  const readStaged=async(path,max)=>{
    beneath(stateRoot,path);let logical;
    const original=roots.find(root=>inside(root.path,path));
    if(original)logical=[original.name,...relative(original.path,path).split(sep).filter(Boolean)].join('/');
    else if(hostEntries.get(path)?.kind==='file')logical='Host/'+hostEntries.get(path).name;
    const entry=stagedEntries.get(logical);
    need(entry?.kind==='file','ACCOUNTING_RECOVERY_HOST_MAPPING','Read only original file entries in this authenticated recovery stage.');
    const bytes=await readBytes(join(stage,...logical.split('/')),max);
    need(bytes.length===entry.size&&hash(bytes)===entry.sha256,'ACCOUNTING_RECOVERY_SOURCE_CHANGED','An authenticated staging source changed.');
    return bytes;
  };
  if(profile){
    need(typeof hostSources==='function','ACCOUNTING_RECOVERY_HOST_PROFILE_REQUIRED',
      'Open recovery with the original configured host source profile before restoring its authorization files.');
    const selected=hostProfile(await hostSources({readFile:readStaged}),stateRoot);
    need(json(selected)===json(profile),'ACCOUNTING_RECOVERY_HOST_PROFILE_CHANGED',
      'The current host configuration, directory environment references or reviewed company pin differ from this authenticated backup.');
  }
  const extras=await extrasFor(state,stateRoot,directory,[...roots,...hostRoots],path=>readStaged(path,200_000));
  need(mapping.stateSha256===hash(stateBytes)&&mapping.revision===state.revision&&JSON.stringify(mapping.sources)===JSON.stringify(state.sources)&&
    JSON.stringify(mapping.roots)===JSON.stringify(roots)&&JSON.stringify(mapping.extras)===JSON.stringify(extras),
    'ACCOUNTING_RECOVERY_MAPPING','The authenticated mapping does not match the original accounting sources.');
  const byName=new Map(roots.map(r=>[r.name,r])),auxiliary=new Map(extras.map(r=>[r.name,r]));
  const hosts=new Map([...hostEntries.values()].map(item=>[item.name,item])),seenHosts=new Set();
  const expectedRoots=[...roots.map(({name,kind})=>({name,kind})),...(extras.length?[{name:'Auxiliary',kind:'directory'}]:[]),
    ...(hostEntries.size?[{name:'Host',kind:'directory'}]:[]),{name:'Recovery',kind:'file'}];
  need(JSON.stringify(manifest.roots)===JSON.stringify(expectedRoots),'ACCOUNTING_RECOVERY_MAPPING','The encrypted roots do not match the original operating closure.');
  const entries=[];
  for(const item of manifest.entries){
    const [name,...parts]=item.path.split('/');if(name==='Recovery')continue;
    let destination;
    if(name==='Auxiliary'){
      if(!parts.length)continue;
      need(parts.length===1&&auxiliary.has(parts[0])&&item.kind==='file','ACCOUNTING_RECOVERY_MAPPING','Unexpected auxiliary recovery input.');
      destination=auxiliary.get(parts[0]).path;
    }else if(name==='Host'){
      if(!parts.length){need(item.kind==='directory','ACCOUNTING_RECOVERY_HOST_MAPPING','The host staging root is invalid.');continue;}
      const original=hosts.get(parts[0]);
      need(parts.length===1&&original&&item.kind===original.kind&&!seenHosts.has(original.name)&&
        (item.kind!=='file'||item.size===original.size&&item.sha256===original.sha256),
        'ACCOUNTING_RECOVERY_HOST_MAPPING','An encrypted host entry differs from its original path, type or bytes.');
      destination=original.path;seenHosts.add(original.name);
    }else{
      const root=byName.get(name);need(root,'ACCOUNTING_RECOVERY_MAPPING','Unexpected encrypted operating root.');
      destination=join(root.path,...parts);
    }
    beneath(stateRoot,destination);entries.push({...item,destination,source:join(stage,...item.path.split('/'))});
  }
  need(seenHosts.size===hostEntries.size,'ACCOUNTING_RECOVERY_HOST_MAPPING','An authenticated host source entry is missing.');
  need(entries.length&&new Set(entries.map(e=>e.destination)).size===entries.length,'ACCOUNTING_RECOVERY_MAPPING','Duplicate operating destination.');
  return {mapping,roots:[...roots,...hostRoots],profile,extras,entries};
}
function partialPath(item,identity){return join(dirname(item.destination),'.accounting-restore-'+identity+'-'+hash(item.destination)+'.pending');}
async function installFile(item,identity,root,signal){
  aborted(signal);await directories(root,dirname(item.destination),{create:true});
  const temporary=partialPath(item,identity);await copyFile(item.source,temporary,constants.COPYFILE_EXCL);
  try{
    const actual=await digest(temporary,signal);need(actual.sha256===item.sha256&&actual.bytes===item.size,'ACCOUNTING_RECOVERY_SOURCE_CHANGED','A restored staging file changed before publication.');
    const fd=await open(temporary,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{await fd.sync();}finally{await fd.close();}
    await link(temporary,item.destination);
  }finally{await unlink(temporary);}
  await syncDirectory(dirname(item.destination));return version(await info(item.destination));
}
export async function restoreAccountingWorkspace({bundle,expectedSha256,directory,stateRoot,quiesced=false,signal,hostSources,...password}={}){
  need(quiesced===true,'ACCOUNTING_RECOVERY_QUIESCE','Stop the workspace and all original input writers, then pass --quiesced.');
  await privateRoot(stateRoot);beneath(stateRoot,directory);const credentials=passOptions(password),receipt=await inspectAccountingBackup({bundle,expectedSha256});
  const temporary=await mkdtemp(join(stateRoot,'.accounting-restore-'));let lease;
  try{
    const stage=join(temporary,'verified'),restored=await engine('restore',{bundle:join(bundle,'encrypted'),out:stage},credentials,signal);
    need(restored.files===receipt.files&&restored.bytes===receipt.bytes,'ACCOUNTING_RECOVERY_BACKUP_CHANGED','The completed backup counts changed.');
    await inspectAccountingBackup({bundle,expectedSha256:receipt.manifestSha256});
    const manifestBytes=await readBytes(join(bundle,'encrypted','manifest.json'),12*1024**2);
    need(hash(manifestBytes)===receipt.manifestSha256,'ACCOUNTING_RECOVERY_BACKUP_CHANGED','The authenticated manifest changed before restore.');
    const manifest=JSON.parse(manifestBytes);
    const {mapping,roots,profile,extras,entries}=await restoredMapping(stage,manifest,{directory,stateRoot,hostSources});
    for(const item of [...roots,...extras])need(!inside(item.path,bundle)&&!inside(bundle,item.path)&&!inside(item.path,temporary),'ACCOUNTING_RECOVERY_OVERLAP','Keep the authenticated backup separate from restored operating paths.');
    await directories(stateRoot,directory,{create:true});await privateRoot(directory);lease=await acquireStateLease(directory);
    const markerPath=join(directory,RESTORE_MARKER),markerInfo=await info(markerPath),identity=receipt.manifestSha256;
    if(markerInfo){const marker=await readJSON(markerPath,16_000);need(marker.schema===RESTORE&&marker.manifestSha256===identity&&marker.directory===directory&&marker.stateRoot===stateRoot,'ACCOUNTING_RECOVERY_OTHER_RESTORE','Resume the backup recorded by this workspace before selecting another restore.');
      for(const item of entries.filter(e=>e.kind==='file')){if(!(await directories(stateRoot,dirname(item.destination))))continue;
        const path=partialPath(item,identity),st=await info(path);if(st){need(regular(st)&&(st.mode&0o077n)===0n,'ACCOUNTING_RECOVERY_PARTIAL','An unfinished restore file is unsafe.');await unlink(path);}}
    }
    const expected=new Map(entries.map(item=>[item.destination,item])),exclude=new Set([markerPath]),versions=new Map();
    const existing=await inventory(roots,extras,stateRoot,{missing:true,signal,exclude});
    for(const entry of existing.entries){const item=expected.get(entry.path);need(item&&item.kind===entry.kind,'ACCOUNTING_RECOVERY_DESTINATION_CHANGED','An existing operating path is absent from the selected backup. Existing data was preserved.');
      if(item.kind==='file'){const actual=await digest(entry.path,signal);need(actual.sha256===item.sha256&&actual.bytes===item.size,'ACCOUNTING_RECOVERY_DESTINATION_CHANGED','An existing operating file differs from the selected backup. Existing data was preserved.');versions.set(entry.path,actual.version);}}
    aborted(signal);lease.assertHeld();
    if(!markerInfo){await writeNew(markerPath,json({schema:RESTORE,manifestSha256:identity,directory,stateRoot,startedAt:new Date().toISOString()}));await syncDirectory(directory);}
    let restoredFiles=0,createdDirectories=0;const reusedFiles=versions.size;
    for(const item of entries.filter(e=>e.kind==='directory').sort((a,b)=>a.destination.length-b.destination.length)){
      if(!(await info(item.destination))){await directories(stateRoot,item.destination,{create:true});createdDirectories++;}
    }
    const statePath=join(directory,'workspace.json');
    for(const item of entries.filter(e=>e.kind==='file').sort((a,b)=>Number(a.destination===statePath)-Number(b.destination===statePath))){
      if(versions.has(item.destination))continue;
      versions.set(item.destination,await installFile(item,identity,stateRoot,signal));restoredFiles++;
    }
    const final=await inventory(roots,extras,stateRoot,{signal,exclude});
    need(final.entries.length===entries.length,'ACCOUNTING_RECOVERY_DESTINATION_CHANGED','Operating paths changed during restore. Resume after stopping their writers.');
    for(const entry of final.entries){const item=expected.get(entry.path);need(item?.kind===entry.kind&&(entry.kind==='directory'||versions.get(entry.path)===entry.version),'ACCOUNTING_RECOVERY_DESTINATION_CHANGED','An operating file changed during restore. Resume after stopping its writer.');}
    aborted(signal);lease.assertHeld();await unlink(markerPath);await syncDirectory(directory);
    return {status:'ACCOUNTING_WORKSPACE_RESTORED',manifestSha256:identity,directory,revision:mapping.revision,workspaceSha256:mapping.stateSha256,restoredFiles,reusedFiles,createdDirectories,operatingFiles:final.files,operatingBytes:final.bytes,
      hostSourcesRestored:Boolean(profile),...(profile?{hostSources:hostSummary(profile,final)}:{})};
  }finally{await lease?.close();await rm(temporary,{recursive:true,force:true});}
}
