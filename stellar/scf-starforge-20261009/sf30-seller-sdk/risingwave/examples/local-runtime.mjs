// MIT. Operate one retained local RisingWave 3.1.0 instance.
import { open, readFile, lstat, mkdir, statfs, readlink, readdir, chmod, link, unlink, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve, join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { availableParallelism, hostname } from 'node:os';
import { createServer, createConnection } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { privateDirectory, readBytes, optionalJson, atomicJson, createFile, writeAll,
  syncDirectory, fileInfo, bytes, identity, fail, errorValue } from '../common.mjs';

const exec=promisify(execFile);
const VERSION='3.1.0';
const RELEASE=Object.freeze({
  version:VERSION,sourceCommit:'45baf6460ea942e4ff57a5aa057d5b8db7f3b563',
  url:'https://github.com/risingwavelabs/risingwave/releases/download/v3.1.0/risingwave-v3.1.0-x86_64-unknown-linux.tar.gz',
  bytes:201363854,sha256:'3e42052148bcd5cf9df076f983005f7164a8ee77d83128ab51e02489c9a7e629'
});
const INTERNAL_PORTS=[5690,5691,5688,6660],GiB=1073741824,MiB=1048576;
const PROFILE='stellar-forge.risingwave-local-runtime.v1';
const HASH=/^[a-f0-9]{64}$/,need=(v,c,m=c,d={})=>{if(!v)throw fail(c,m,d);};
const currentTime=()=>new Date().toISOString();
const jsonPath=(directory,name)=>join(directory,name+'.json');
const decimal=value=>/^(0|[1-9][0-9]*)$/.test(String(value??''))?BigInt(value):null;
const safeInteger=(v,minimum,maximum,code)=>{
  need(typeof v==='number'&&Number.isSafeInteger(v)&&v>=minimum&&v<=maximum,code);return v;
};
async function optionalText(path){
  try{return(await readFile(path,'utf8')).trim();}
  catch(issue){if(['ENOENT','ENOTDIR'].includes(issue.code))return null;throw issue;}
}
async function regular(path,{executable=false,privateFile=false}={}){
  const st=await lstat(path);
  need(st.isFile()&&!st.isSymbolicLink()&&(!privateFile||!(st.mode&0o077))&&
    (!executable||!!(st.mode&0o111)),'RUNTIME_REGULAR_FILE_REQUIRED','Use the original regular file.',{path});
  return st;
}
async function writeOnce(path,value){
  const body=bytes(value);
  try{await createFile(path,body);await syncDirectory(dirname(path));}
  catch(issue){if(issue.code!=='EEXIST')throw issue;
    need((await readBytes(path,8388608,true)).equals(body),'RUNTIME_RETAINED_FILE_CHANGED','Keep the original retained file.',{path});}
}
function absolutePath(value){
  need(typeof value==='string'&&value===resolve(value)&&!value.includes('\0'),'RUNTIME_ABSOLUTE_PATH_REQUIRED');return value;
}
function below(parent,path){const r=relative(parent,path);return r===''||(!r.startsWith('../')&&r!=='..'&&!isAbsolute(r));}
function listenAddress(value){
  const m=/^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value??'');
  need(m&&Number(m[1])<=65535&&!INTERNAL_PORTS.includes(Number(m[1])),'RUNTIME_LISTEN_ADDRESS_REQUIRED',
    'Select an unused 127.0.0.1 frontend port separate from the fixed internal ports.');
  return {host:'127.0.0.1',port:Number(m[1]),value};
}
export function localRuntimeArguments(profile){
  listenAddress(profile.listenAddress);
  safeInteger(profile.memoryBytes,1,Number.MAX_SAFE_INTEGER,'RUNTIME_MEMORY_BYTES_REQUIRED');
  safeInteger(profile.reserveBytes,0,Number.MAX_SAFE_INTEGER,'RUNTIME_RESERVE_BYTES_REQUIRED');
  safeInteger(profile.parallelism,1,65536,'RUNTIME_PARALLELISM_REQUIRED');
  safeInteger(profile.compactionThreads,1,65536,'RUNTIME_COMPACTION_THREADS_REQUIRED');
  absolutePath(profile.storeDirectory);
  const nodeShare=profile.memoryBytes<=16*GiB?Math.floor(profile.memoryBytes/8):Math.floor((profile.memoryBytes-16*GiB)/16)+2*GiB;
  const compute=profile.memoryBytes-nodeShare*2;
  need(compute>512*MiB,'RUNTIME_COMPUTE_MEMORY_TOO_SMALL',
    'The pinned single-node split must leave compute above its 512 MiB system reserve.',
    {frontend:nodeShare,compactor:nodeShare,compute});
  return ['--store-directory',profile.storeDirectory,'--listen-addr',profile.listenAddress,
    '--total-memory-bytes',String(profile.memoryBytes),'--parallelism',String(profile.parallelism),
    '--compaction-worker-threads-number',String(profile.compactionThreads)];
}
function cleanRuntimeEnvironment(environment){
  // The selected local store must not be redirected by inherited RW_* options.
  return Object.fromEntries(Object.entries(environment).filter(([name,value])=>!name.startsWith('RW_')&&typeof value==='string'));
}
function unescapeMount(value){return value.replace(/\\([0-7]{3})/g,(_,v)=>String.fromCharCode(parseInt(v,8)));}
export function cgroupLocations(mountInfo,cgroup){
  const memberships=cgroup.trim().split('\n').map(line=>{
    const i=line.indexOf(':'),j=line.indexOf(':',i+1);
    return {controllers:line.slice(i+1,j).split(',').filter(Boolean),path:line.slice(j+1)};
  });
  const locations=[];
  for(const line of mountInfo.trim().split('\n')){
    const [left,right]=line.split(' - ');if(!right)continue;
    const fields=left.split(' '),[type,,options]=right.split(' ');
    if(type!=='cgroup2'&&type!=='cgroup')continue;
    const root=unescapeMount(fields[3]),mount=unescapeMount(fields[4]);
    const controllers=(options??'').split(',');
    for(const member of memberships){
      const kind=type==='cgroup2'&&member.controllers.length===0?'v2':
        type==='cgroup'&&member.controllers.some(x=>x==='memory'&&controllers.includes(x))?'memory':
        type==='cgroup'&&member.controllers.some(x=>x==='cpu'&&controllers.includes(x))?'cpu':null;
      if(!kind)continue;
      // In a cgroup namespace the membership is relative to the visible mount root.
      const selected=member.path===root?mount:below(root,member.path)?
        join(mount,relative(root,member.path)):root!=='/'?join(mount,member.path.replace(/^\/+/,'')):null;
      if(!selected||!below(mount,selected))continue;
      let path=selected;
      for(;;){locations.push({kind,path});if(path===mount)break;const parent=dirname(path);if(parent===path)break;path=parent;}
    }
  }
  return [...new Map(locations.map(v=>[v.kind+':'+v.path,v])).values()];
}
export async function inspectLocalRuntimeCapacity(directory){
  need(process.platform==='linux','RUNTIME_LINUX_REQUIRED');
  const [memoryText,cpuText,mountInfo,cgroupText]=await Promise.all([
    readFile('/proc/meminfo','utf8'),readFile('/proc/cpuinfo','utf8'),
    readFile('/proc/self/mountinfo','utf8'),readFile('/proc/self/cgroup','utf8')]);
  const available=/^MemAvailable:\s+([0-9]+)\s+kB$/m.exec(memoryText);
  need(available,'RUNTIME_MEMORY_AVAILABILITY_UNREADABLE');
  const systemAvailable=BigInt(available[1])*1024n,locations=cgroupLocations(mountInfo,cgroupText),memory=[],cpu=[];
  for(const location of locations){
    if(location.kind==='v2'||location.kind==='memory'){
      const max=await optionalText(join(location.path,location.kind==='v2'?'memory.max':'memory.limit_in_bytes'));
      const use=await optionalText(join(location.path,location.kind==='v2'?'memory.current':'memory.usage_in_bytes'));
      const limit=decimal(max),used=decimal(use),statText=await optionalText(join(location.path,'memory.stat'));
      const stat=Object.fromEntries((statText??'').split('\n').map(line=>line.trim().split(/\s+/)).filter(row=>row.length===2));
      const inactive=decimal(location.kind==='v2'?stat.inactive_file:stat.total_inactive_file)??0n;
      const file=decimal(location.kind==='v2'?stat.file:stat.total_cache)??0n;
      const shmem=decimal(location.kind==='v2'?stat.shmem:stat.total_shmem)??file;
      const diskFile=file>shmem?file-shmem:0n,reclaimableFile=inactive<diskFile?inactive:diskFile;
      if(used!==null&&(limit!==null||max==='max')){
        const raw=limit===null?null:limit>used?limit-used:0n;
        const estimate=raw===null?null:raw+reclaimableFile>limit?limit:raw+reclaimableFile;
        memory.push({path:location.path,kind:location.kind,limit:limit===null?null:String(limit),current:String(used),
          rawHeadroom:raw===null?null:String(raw),reclaimableInactiveFile:String(reclaimableFile),
          available:estimate===null?null:String(estimate)});
      }
    }
    if(location.kind==='v2'||location.kind==='cpu'){
      const raw=location.kind==='v2'?await optionalText(join(location.path,'cpu.max')):null;
      const [quotaText,periodText]=raw?raw.split(/\s+/):[
        await optionalText(join(location.path,'cpu.cfs_quota_us')),await optionalText(join(location.path,'cpu.cfs_period_us'))];
      const quota=decimal(quotaText),period=decimal(periodText);
      if(quota!==null&&period!==null&&period>0n)cpu.push({path:location.path,quota:String(quota),period:String(period),cpus:Number(quota)/Number(period)});
    }
  }
  const memoryHeadroom=memory.reduce((minimum,item)=>item.available!==null&&BigInt(item.available)<minimum?BigInt(item.available):minimum,systemAvailable);
  const affinity=availableParallelism(),cpuCapacity=Math.min(affinity,...cpu.map(v=>v.cpus));
  const fs=await statfs(directory,{bigint:true});
  return {observedAt:currentTime(),host:hostname(),platform:process.platform,architecture:process.arch,
    avx2:/^flags\s*:.*\bavx2\b/m.test(cpuText),node:process.version,
    memory:{systemAvailable:String(systemAvailable),available:String(memoryHeadroom),cgroups:memory},
    cpu:{affinity,capacity:cpuCapacity,cgroups:cpu},
    filesystem:{directory,available:String(fs.bavail*fs.bsize),blockSize:String(fs.bsize),type:String(fs.type)}};
}
export function localRuntimeAdmission(profile,capacity){
  const issues=[];
  if(capacity.platform!=='linux'||capacity.architecture!=='x64'||!capacity.avx2)issues.push('Pinned archive needs Linux x86_64 with AVX2.');
  if(BigInt(profile.memoryBytes)+BigInt(profile.reserveBytes)>BigInt(capacity.memory.available))
    issues.push('Selected runtime memory plus receiving reserve exceeds current host/cgroup headroom.');
  if(profile.parallelism>Math.max(1,Math.ceil(capacity.cpu.capacity))||profile.compactionThreads>Math.max(1,Math.ceil(capacity.cpu.capacity)))
    issues.push('Selected compute or compaction parallelism exceeds current CPU affinity/quota.');
  if(BigInt(capacity.filesystem.available)<BigInt(profile.minimumFreeBytes))
    issues.push('Original state filesystem is below the selected free-byte reserve.');
  return {admitted:issues.length===0,issues,requested:{memoryBytes:profile.memoryBytes,reserveBytes:profile.reserveBytes,
    parallelism:profile.parallelism,compactionThreads:profile.compactionThreads,minimumFreeBytes:profile.minimumFreeBytes},capacity};
}
async function lock(directory){
  const handle=await open(join(directory,'local-runtime.lock'),constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try{
    const st=await handle.stat();need(st.isFile()&&st.nlink===1&&!(st.mode&0o077),'RUNTIME_PRIVATE_LOCK_REQUIRED');
    await new Promise((done,reject)=>{
      const child=spawn('flock',['--exclusive','--nonblock','--conflict-exit-code','75','3'],
        {shell:false,stdio:['ignore','ignore','ignore',handle.fd]});
      const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
      child.once('error',issue=>{clearTimeout(timer);reject(fail('RUNTIME_FLOCK_UNAVAILABLE',issue.message));});
      child.once('exit',code=>{clearTimeout(timer);code===0?done():reject(fail(code===75?'RUNTIME_ALREADY_OWNED':'RUNTIME_FLOCK_FAILED'));});
    });
    return handle;
  }catch(issue){await handle.close();throw issue;}
}
async function privateEnvironment(path,name,listen,environment){
  absolutePath(path);need(/^[A-Za-z_][A-Za-z0-9_]*$/.test(name),'RUNTIME_ENVIRONMENT_NAME_INVALID');
  let raw;try{raw=await readBytes(path,1048576,true);}
  catch(issue){
    if(issue.code!=='ENOENT')throw issue;
    need(typeof environment[name]==='string'&&environment[name],'RUNTIME_CONNECTION_ENVIRONMENT_REQUIRED',
      'Provide the original private environment file or set its named connection value.',{environment:name});
    await privateDirectory(dirname(path),false);await createFile(path,bytes({[name]:environment[name]}));await syncDirectory(dirname(path));
    raw=await readBytes(path,1048576,true);
  }
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{throw fail('RUNTIME_PRIVATE_ENVIRONMENT_INVALID','Read the original private environment JSON.');}
  need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.values(value).every(x=>typeof x==='string')&&value[name],
    'RUNTIME_PRIVATE_ENVIRONMENT_INVALID');
  let url;try{url=new URL(value[name]);}catch{throw fail('RUNTIME_CONNECTION_URL_INVALID');}
  const endpoint=listenAddress(listen),port=Number(url.port||4566);
  need(['postgres:','postgresql:'].includes(url.protocol)&&!url.search&&!url.hash&&
    ['localhost','127.0.0.1'].includes(url.hostname)&&port===endpoint.port&&url.username&&url.pathname.length>1,
    'RUNTIME_CONNECTION_TARGET_MISMATCH','Bind the original local database URL to this frontend port.');
  return {path,name,sha256:createHash('sha256').update(raw).digest('hex'),values:value,
    endpoint:{host:endpoint.host,port,user:decodeURIComponent(url.username),database:decodeURIComponent(url.pathname.slice(1))}};
}
async function verifyArchive(path){
  const found=await fileInfo(path);
  need(found.bytes===RELEASE.bytes&&found.sha256===RELEASE.sha256,'RUNTIME_ARCHIVE_IDENTITY_MISMATCH',
    'Use the complete pinned RisingWave 3.1.0 archive.',{path,bytes:found.bytes,sha256:found.sha256});
  return {...found,url:RELEASE.url,release:VERSION};
}
async function ownedPartial(path){
  try{await regular(path,{privateFile:true});return(await lstat(path)).size;}
  catch(issue){if(issue.code==='ENOENT')return 0;throw issue;}
}
async function publishOwnedFile(part,target){
  try{await link(part,target);await syncDirectory(dirname(target));}
  catch(issue){
    if(issue.code!=='EEXIST')throw issue;
    const [a,b]=await Promise.all([fileInfo(part),fileInfo(target)]);
    need(a.sha256===b.sha256&&a.bytes===b.bytes,'RUNTIME_DESTINATION_CHANGED','Preserve the existing file.',{target});
  }
  await unlink(part);await syncDirectory(dirname(part));
}
async function downloadArchive(directory,onEvent,signal,retry=0){
  const target=join(directory,'risingwave-'+VERSION+'.tar.gz'),part=target+'.partial';
  try{return await verifyArchive(target);}catch(issue){if(issue.code!=='ENOENT')throw issue;}
  const retained=await ownedPartial(part);need(retained<=RELEASE.bytes,'RUNTIME_DOWNLOAD_LENGTH_INVALID');
  const capacity=await inspectLocalRuntimeCapacity(directory);
  need(BigInt(capacity.filesystem.available)>=BigInt(RELEASE.bytes-retained),'RUNTIME_ARCHIVE_SPACE_REQUIRED');
  if(retained<RELEASE.bytes){
    const response=await fetch(RELEASE.url,{headers:retained?{Range:'bytes='+retained+'-'}:{},
      signal:signal??AbortSignal.timeout(900000)});
    need(response.status===200||response.status===206,'RUNTIME_ARCHIVE_DOWNLOAD_FAILED',
      'The original archive request did not return its bytes.',{status:response.status});
    let start=0;
    if(response.status===206){
      const range=/^bytes ([0-9]+)-([0-9]+)\/([0-9]+)$/.exec(response.headers.get('content-range')??'');
      need(range&&Number(range[1])===retained&&Number(range[2])===RELEASE.bytes-1&&Number(range[3])===RELEASE.bytes,
        'RUNTIME_ARCHIVE_RANGE_MISMATCH');start=retained;
    }
    need(response.body,'RUNTIME_ARCHIVE_BODY_REQUIRED');
    const handle=await open(part,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
    let offset=start,progress=offset;
    try{
      const st=await handle.stat();need(st.isFile()&&st.nlink===1&&!(st.mode&0o077),'RUNTIME_PRIVATE_PARTIAL_REQUIRED');
      if(start===0)await handle.truncate(0);
      for await(const chunk of response.body){
        need(offset+chunk.length<=RELEASE.bytes,'RUNTIME_ARCHIVE_LENGTH_EXCEEDED');
        let written=0;while(written<chunk.length){
          const r=await handle.write(chunk,written,chunk.length-written,offset+written);
          need(r.bytesWritten>0,'RUNTIME_ARCHIVE_WRITE_INCOMPLETE');written+=r.bytesWritten;
        }offset+=chunk.length;
        if(offset-progress>=16*MiB){await handle.sync();progress=offset;await onEvent({event:'archive-progress',bytes:offset,total:RELEASE.bytes});}
      }
      await handle.sync();need(offset===RELEASE.bytes,'RUNTIME_ARCHIVE_DOWNLOAD_INCOMPLETE');
    }finally{await handle.close();}
  }
  try{await verifyArchive(part);}
  catch(issue){
    if(issue.code!=='RUNTIME_ARCHIVE_IDENTITY_MISMATCH')throw issue;
    const rejected=await fileInfo(part),quarantine=target+'.rejected-'+rejected.sha256;
    await publishOwnedFile(part,quarantine);
    await onEvent({event:'archive-partial-recovered',path:quarantine,bytes:rejected.bytes,sha256:rejected.sha256});
    if(retry===0)return downloadArchive(directory,onEvent,signal,1);
    throw issue;
  }
  await publishOwnedFile(part,target);
  await onEvent({event:'archive-retained',path:target,bytes:RELEASE.bytes,sha256:RELEASE.sha256});
  return verifyArchive(target);
}
async function extractBinary(directory,archive,onEvent,minimumFreeBytes){
  const target=join(directory,'risingwave-'+VERSION),provenance=jsonPath(directory,'binary');
  const saved=await optionalJson(provenance);
  if(saved){
    need(saved.archive.sha256===archive.sha256&&saved.binary.path===target,'RUNTIME_BINARY_PROVENANCE_CHANGED');
    await regular(target,{executable:true,privateFile:true});const found=await fileInfo(target);
    need(found.sha256===saved.binary.sha256&&found.bytes===saved.binary.bytes,'RUNTIME_BINARY_CHANGED');return saved.binary;
  }
  const listing=await exec('tar',['--list','--gzip','--file',archive.path],{maxBuffer:1048576,timeout:180000});
  const members=listing.stdout.split('\n').filter(x=>x==='risingwave'||x.endsWith('/risingwave'));
  need(members.length===1&&!members[0].startsWith('/')&&members[0].split('/').every(x=>x!==''&&x!=='..'),
    'RUNTIME_ARCHIVE_BINARY_MEMBER_REQUIRED');
  const member=members[0],part=target+'.partial';
  const verbose=await exec('tar',['--list','--verbose','--numeric-owner','--gzip','--file',archive.path,'--',member],
    {maxBuffer:1048576,timeout:180000});
  const rows=verbose.stdout.trim().split('\n'),size=rows.length===1?/^-\S+\s+\S+\s+([0-9]+)\s+/.exec(rows[0]):null;
  need(size,'RUNTIME_ARCHIVE_REGULAR_BINARY_REQUIRED');
  const expectedBytes=Number(size[1]);safeInteger(expectedBytes,1,2*GiB,'RUNTIME_BINARY_LENGTH_INVALID');
  let retained=null;
  try{await regular(target,{executable:true,privateFile:true});retained=await fileInfo(target);}
  catch(issue){if(issue.code!=='ENOENT')throw issue;}
  const priorPartial=retained?0:await ownedPartial(part),capacity=await inspectLocalRuntimeCapacity(directory);
  need(retained||BigInt(capacity.filesystem.available)+BigInt(priorPartial)>=BigInt(expectedBytes)+BigInt(minimumFreeBytes),
    'RUNTIME_BINARY_SPACE_REQUIRED','The original executable and selected free-byte reserve must fit together.',
    {expectedBytes,minimumFreeBytes,available:capacity.filesystem.available,reusablePartialBytes:priorPartial});
  let handle=null,child=null,exit=null,binary;
  try{
    if(!retained){
      handle=await open(part,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
      const st=await handle.stat();need(st.isFile()&&st.nlink===1&&!(st.mode&0o077),'RUNTIME_PRIVATE_PARTIAL_REQUIRED');
      await handle.truncate(0);
    }
    child=spawn('tar',['--extract','--to-stdout','--gzip','--file',archive.path,'--',member],
      {shell:false,stdio:['ignore','pipe','pipe']});
    exit=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>done({code,signal}));});
    exit.catch(()=>{});
    let stderr='';child.stderr.on('data',chunk=>{if(stderr.length<4096)stderr+=chunk.toString('utf8').slice(0,4096-stderr.length);});
    let total=0;const digest=createHash('sha256');
    for await(const chunk of child.stdout){
      total+=chunk.length;need(total<=expectedBytes,'RUNTIME_BINARY_LENGTH_EXCEEDED');
      digest.update(chunk);if(handle)await writeAll(handle,chunk);
    }
    const result=await exit;
    need(result.code===0&&total===expectedBytes,'RUNTIME_BINARY_EXTRACTION_FAILED',stderr||'Read the original archive extraction result.',result);
    binary={path:target,bytes:total,sha256:digest.digest('hex')};
    if(retained)need(binary.bytes===retained.bytes&&binary.sha256===retained.sha256,'RUNTIME_DESTINATION_CHANGED',
      'The existing executable differs from the original pinned archive.',{target});
    else await handle.sync();
  }catch(issue){child?.kill('SIGTERM');await exit?.catch(()=>{});throw issue;}
  finally{await handle?.close();}
  if(!retained){await chmod(part,0o700);await publishOwnedFile(part,target);}
  await writeOnce(provenance,{schema:'stellar-forge.risingwave-local-binary.v1',archive,member,binary});
  await onEvent({event:'binary-retained',...binary});return binary;
}
async function inspectBinary(binary,environment){
  await regular(binary.path,{executable:true});const found=await fileInfo(binary.path);
  need(found.bytes===binary.bytes&&found.sha256===binary.sha256,'RUNTIME_BINARY_CHANGED');
  const options={timeout:15000,maxBuffer:1048576,env:cleanRuntimeEnvironment(environment)};
  const [version,help]=await Promise.all([exec(binary.path,['--version'],options),exec(binary.path,['--help'],options)]);
  need(/(?:^|[^0-9])3\.1\.0(?:[^0-9]|$)/.test(version.stdout+version.stderr),'RUNTIME_BINARY_VERSION_MISMATCH');
  const text=help.stdout+help.stderr;
  for(const flag of ['store-directory','listen-addr','total-memory-bytes','parallelism','compaction-worker-threads-number'])
    need(new RegExp('(?:^|\\s)--'+flag+'(?:\\s|=|$)').test(text),'RUNTIME_BINARY_ARGUMENT_MISSING',flag);
  return {version:(version.stdout+version.stderr).trim(),helpSha256:createHash('sha256').update(text).digest('hex')};
}
function validateProfile(profile,directory){
  need(profile?.schema===PROFILE&&profile.directory===directory&&typeof profile.operationId==='string'&&profile.operationId,
    'RUNTIME_PROFILE_INVALID');localRuntimeArguments(profile);
  need(HASH.test(profile.binary?.sha256??'')&&HASH.test(profile.environment?.sha256??''),'RUNTIME_PROFILE_IDENTITY_INVALID');
  safeInteger(profile.minimumFreeBytes,0,Number.MAX_SAFE_INTEGER,'RUNTIME_DISK_RESERVE_REQUIRED');
  return profile;
}
async function readProfile(directory){await privateDirectory(directory,false);return validateProfile(await optionalJson(jsonPath(directory,'runtime')),directory);}
export async function prepareLocalRisingWaveRuntime(options={}){
  const {directory,operationId,storeDirectory,listenAddress:listen,memoryBytes,reserveBytes,parallelism,
    compactionThreads,minimumFreeBytes,environmentFile,connectionEnv='RISINGWAVE_URL',
    binaryPath,binarySha256,archivePath,download=false,environment=process.env,onEvent=()=>{},signal}=options;
  absolutePath(directory);absolutePath(storeDirectory);absolutePath(environmentFile);
  need(typeof operationId==='string'&&operationId.length>0&&operationId.length<=256,'RUNTIME_OPERATION_ID_REQUIRED');
  need([!!binaryPath,!!archivePath,download===true].filter(Boolean).length===1,'RUNTIME_ONE_EXECUTABLE_SOURCE_REQUIRED');
  const request={directory,operationId,storeDirectory,listenAddress:listen,memoryBytes,reserveBytes,parallelism,compactionThreads,minimumFreeBytes};
  localRuntimeArguments(request);safeInteger(minimumFreeBytes,0,Number.MAX_SAFE_INTEGER,'RUNTIME_DISK_RESERVE_REQUIRED');
  await privateDirectory(directory,true);await privateDirectory(storeDirectory,true);
  const current=await optionalJson(jsonPath(directory,'runtime'));
  if(current){
    validateProfile(current,directory);
    need(current.operationId===operationId&&current.storeDirectory===storeDirectory,'RUNTIME_ORIGINAL_OPERATION_REQUIRED');
    const live=await liveInstance(current);
    if(live){
      need(Object.entries(request).every(([key,value])=>current[key]===value)&&current.environment.path===environmentFile&&
        current.environment.name===connectionEnv&&
        (binaryPath?current.binary.path===binaryPath&&current.binary.sha256===binarySha256:current.archive?.sha256===RELEASE.sha256),
        'RUNTIME_ACTIVE_CONFIGURATION_CHANGED','Continue with the original live instance and its current configuration.');
      const result={event:'runtime-existing',directory,operationId,configurationSha256:identity(current),process:live.process,
        binary:current.binary,storeDirectory,environmentFile,listenAddress:listen};
      await onEvent(result);return result;
    }
  }
  const held=await lock(directory);
  try{
    const capacity=await inspectLocalRuntimeCapacity(directory);
    need(capacity.architecture==='x64'&&capacity.avx2,'RUNTIME_PINNED_ARCHITECTURE_REQUIRED');
    const env=await privateEnvironment(environmentFile,connectionEnv,listen,environment);
    let binary,archive=null;
    if(binaryPath){
      absolutePath(binaryPath);need(HASH.test(binarySha256??''),'RUNTIME_SELECTED_BINARY_DIGEST_REQUIRED');
      await regular(binaryPath,{executable:true});binary=await fileInfo(binaryPath);
      need(binary.sha256===binarySha256,'RUNTIME_SELECTED_BINARY_MISMATCH');
    }else{
      archive=archivePath?await verifyArchive(absolutePath(archivePath)):await downloadArchive(directory,onEvent,signal);
      binary=await extractBinary(directory,archive,onEvent,minimumFreeBytes);
    }
    const inspected=await inspectBinary(binary,environment);
    const profile={schema:PROFILE,...request,release:RELEASE,binary,archive,inspected,
      environment:{path:environmentFile,name:connectionEnv,sha256:env.sha256,endpoint:env.endpoint}};
    const configurationSha256=identity(profile);
    await privateDirectory(join(directory,'configurations'),true);
    await writeOnce(join(directory,'configurations',configurationSha256+'.json'),profile);
    await atomicJson(jsonPath(directory,'runtime'),profile);
    const result={event:'runtime-prepared',directory,configurationSha256,operationId,binary,
      storeDirectory,environmentFile,listenAddress:listen,admission:localRuntimeAdmission(profile,await inspectLocalRuntimeCapacity(storeDirectory))};
    await onEvent(result);return result;
  }finally{await held.close();}
}
function parseProcessStat(text){
  const end=text.lastIndexOf(')');need(end>=0,'RUNTIME_PROCESS_STAT_INVALID');
  const fields=text.slice(end+2).trim().split(/\s+/);
  need(fields.length>=20&&/^[0-9]+$/.test(fields[19]),'RUNTIME_PROCESS_STAT_INVALID');
  return {state:fields[0],parentPid:Number(fields[1]),startTicks:fields[19]};
}
async function processIdentity(pid){
  safeInteger(pid,1,2147483647,'RUNTIME_PID_INVALID');
  try{
    const base='/proc/'+pid,stat1=parseProcessStat(await readFile(join(base,'stat'),'utf8'));
    const [exe,cmd,boot]=await Promise.all([readlink(join(base,'exe')),readFile(join(base,'cmdline')),
      readFile('/proc/sys/kernel/random/boot_id','utf8')]);
    const st=await lstat(base),stat2=parseProcessStat(await readFile(join(base,'stat'),'utf8'));
    need(stat1.startTicks===stat2.startTicks,'RUNTIME_PROCESS_IDENTITY_CHANGED');
    if(stat2.state==='Z'||stat2.state==='X')return null;
    return {pid,startTicks:stat2.startTicks,bootId:boot.trim(),uid:st.uid,executable:exe,
      argv:cmd.toString('utf8').split('\0').filter(Boolean),parentPid:stat2.parentPid};
  }catch(issue){if(['ENOENT','ESRCH'].includes(issue.code))return null;throw issue;}
}
export function canonicalRuntimeArgs(input){
  const args=[...input];if(args[0]==='single')args.shift();
  const expected=new Set(['--store-directory','--listen-addr','--total-memory-bytes','--parallelism','--compaction-worker-threads-number']);
  const found={};
  for(let i=0;i<args.length;i++){
    const eq=args[i].indexOf('='),name=eq<0?args[i]:args[i].slice(0,eq),value=eq<0?args[++i]:args[i].slice(eq+1);
    if(!expected.has(name)||Object.hasOwn(found,name)||typeof value!=='string'||!value||value.startsWith('--'))return null;
    found[name]=value;
  }
  return Object.keys(found).length===expected.size?JSON.stringify(Object.entries(found).sort(([a],[b])=>a.localeCompare(b))):null;
}
async function matchesProfile(processValue,profile){
  if(!processValue||processValue.uid!==process.getuid())return false;
  const executable=await realpath(profile.binary.path);
  if(processValue.executable!==executable)return false;
  return canonicalRuntimeArgs(processValue.argv.slice(1))===canonicalRuntimeArgs(localRuntimeArguments(profile));
}
async function liveInstance(profile){
  const saved=await optionalJson(jsonPath(profile.directory,'process'));
  if(saved){
    const actual=await processIdentity(saved.process.pid);
    if(actual&&actual.startTicks===saved.process.startTicks&&actual.bootId===saved.process.bootId&&await matchesProfile(actual,profile))
      return {saved,process:actual,recovered:false};
  }
  // Recover the spawn/write window only for this exact executable and private store.
  const candidates=[];
  for(const name of await readdir('/proc')){
    if(!/^[1-9][0-9]*$/.test(name))continue;
    try{
      const cmd=await readFile('/proc/'+name+'/cmdline');
      if(!cmd.includes(Buffer.from(profile.storeDirectory)))continue;
      const value=await processIdentity(Number(name));if(await matchesProfile(value,profile))candidates.push(value);
    }catch(issue){if(['ENOENT','ESRCH','EACCES','EPERM'].includes(issue.code))continue;throw issue;}
  }
  need(candidates.length<=1,'RUNTIME_MULTIPLE_ORIGINAL_PROCESSES','Reconcile the original process owners before a launch.',{pids:candidates.map(v=>v.pid)});
  return candidates.length?{saved:null,process:candidates[0],recovered:true}:null;
}
async function portAvailable(port){
  return new Promise(resolvePromise=>{
    const server=createServer();server.once('error',issue=>resolvePromise({port,available:false,code:issue.code}));
    server.listen({host:'127.0.0.1',port,exclusive:true},()=>server.close(()=>resolvePromise({port,available:true})));
  });
}
async function connects(port){
  return new Promise(done=>{
    const socket=createConnection({host:'127.0.0.1',port});
    const finish=value=>{socket.removeAllListeners();socket.destroy();done(value);};
    socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.setTimeout(1000,()=>finish(false));
  });
}
export async function inspectLocalRisingWaveRuntime({directory,connect=false,environment=process.env}={}){
  absolutePath(directory);const profile=await readProfile(directory),capacity=await inspectLocalRuntimeCapacity(profile.storeDirectory);
  const existing=await liveInstance(profile),endpoint=listenAddress(profile.listenAddress);
  const status={schema:'stellar-forge.risingwave-local-status.v1',observedAt:currentTime(),operationId:profile.operationId,
    directory,configurationSha256:identity(profile),binary:profile.binary,storeDirectory:profile.storeDirectory,
    environmentFile:profile.environment.path,listenAddress:profile.listenAddress,
    process:existing?.process??null,recovered:existing?.recovered??false,
    listening:existing?await connects(endpoint.port):false,admission:localRuntimeAdmission(profile,capacity)};
  if(connect){
    need(existing,'RUNTIME_ORIGINAL_PROCESS_REQUIRED');
    const env=await privateEnvironment(profile.environment.path,profile.environment.name,profile.listenAddress,environment);
    need(env.sha256===profile.environment.sha256,'RUNTIME_PRIVATE_ENVIRONMENT_CHANGED');
    const {connectRisingWave}=await import('../transport.mjs');
    const connection=await connectRisingWave({connectionStringEnv:profile.environment.name,tls:'disable',allowLocal:true,queryTimeoutMs:10000},{env:env.values});
    try{status.connection=connection.identity;}finally{await connection.close();}
  }
  return status;
}
export async function serveLocalRisingWaveRuntime({directory,environment=process.env,onEvent=()=>{},signal,startupTimeoutMs=180000}={}){
  absolutePath(directory);safeInteger(startupTimeoutMs,1000,900000,'RUNTIME_STARTUP_TIMEOUT_INVALID');
  const profile=await readProfile(directory),existing=await liveInstance(profile);
  if(existing){
    const result={event:'runtime-existing',operationId:profile.operationId,directory,process:existing.process,
      listening:await connects(listenAddress(profile.listenAddress).port),storeDirectory:profile.storeDirectory};
    await onEvent(result);return result;
  }
  const held=await lock(directory);
  let child=null,closed=null,record=null;
  try{
    // Check again after owning the original kernel lock.
    const afterLock=await liveInstance(profile);
    if(afterLock){const result={event:'runtime-existing',process:afterLock.process,directory,operationId:profile.operationId};await onEvent(result);return result;}
    const env=await privateEnvironment(profile.environment.path,profile.environment.name,profile.listenAddress,environment);
    need(env.sha256===profile.environment.sha256,'RUNTIME_PRIVATE_ENVIRONMENT_CHANGED');
    await inspectBinary(profile.binary,environment);
    const capacity=await inspectLocalRuntimeCapacity(profile.storeDirectory),admission=localRuntimeAdmission(profile,capacity);
    need(admission.admitted,'RUNTIME_CAPACITY_UNAVAILABLE',admission.issues.join(' '),admission);
    const ports=await Promise.all([...INTERNAL_PORTS,listenAddress(profile.listenAddress).port].map(portAvailable));
    need(ports.every(v=>v.available),'RUNTIME_PORTS_IN_USE','Use the same original instance or reconcile its selected ports.',{ports});
    if(signal?.aborted)throw fail('RUNTIME_START_CANCELLED');
    const attempt=randomUUID(),startedAt=currentTime(),logPath=join(directory,'risingwave.log');
    await privateDirectory(join(directory,'attempts'),true);
    const intent={schema:'stellar-forge.risingwave-local-start.v1',attempt,startedAt,configurationSha256:identity(profile),
      operationId:profile.operationId,directory,admission,args:localRuntimeArguments(profile),log:logPath};
    await writeOnce(join(directory,'attempts',attempt+'-start.json'),intent);
    const log=await open(logPath,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
    try{
      const st=await log.stat();need(st.isFile()&&st.nlink===1&&!(st.mode&0o077),'RUNTIME_PRIVATE_LOG_REQUIRED');
      // fd 3 carries the same kernel flock into the database process.
      child=spawn(profile.binary.path,intent.args,{cwd:directory,shell:false,
        env:cleanRuntimeEnvironment(environment),stdio:['ignore',log.fd,log.fd,held.fd]});
      closed=new Promise((done,reject)=>{child.once('error',reject);child.once('close',(code,exitSignal)=>done({code,signal:exitSignal}));});
      closed.catch(()=>{});
      await new Promise((done,reject)=>{child.once('spawn',done);child.once('error',reject);});
    }finally{await log.close();}
    const actual=await processIdentity(child.pid);need(actual,'RUNTIME_PROCESS_EXITED_DURING_START');
    record={schema:'stellar-forge.risingwave-local-process.v1',...intent,process:actual,phase:'STARTING'};
    await atomicJson(jsonPath(directory,'process'),record);
    const forward=()=>{if(child&&child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');};
    process.once('SIGTERM',forward);process.once('SIGINT',forward);signal?.addEventListener('abort',forward,{once:true});
    try{
      const deadline=Date.now()+startupTimeoutMs,port=listenAddress(profile.listenAddress).port;
      while(child.exitCode===null&&child.signalCode===null){
        if(await connects(port)){
          record={...record,phase:'LISTENING',listeningAt:currentTime()};await atomicJson(jsonPath(directory,'process'),record);
          await onEvent({event:'runtime-listening',operationId:profile.operationId,directory,process:actual,
            storeDirectory:profile.storeDirectory,listenAddress:profile.listenAddress,environmentFile:profile.environment.path,log:logPath});break;
        }
        if(Date.now()>=deadline){
          await onEvent({event:'runtime-still-starting',operationId:profile.operationId,directory,process:actual,log:logPath});break;
        }
        await delay(500);
      }
      const outcome=await closed;
      record={...record,phase:'EXITED',finishedAt:currentTime(),outcome};
      await atomicJson(jsonPath(directory,'process'),record);await writeOnce(join(directory,'attempts',attempt+'-result.json'),record);
      await onEvent({event:'runtime-exited',operationId:profile.operationId,directory,outcome,log:logPath});
      need(outcome.code===0||outcome.signal==='SIGTERM'||outcome.signal==='SIGINT','RUNTIME_PROCESS_FAILED',
        'Read the complete original RisingWave log and resume this same directory.',{outcome,log:logPath});
      return record;
    }finally{process.removeListener('SIGTERM',forward);process.removeListener('SIGINT',forward);signal?.removeEventListener('abort',forward);}
  }catch(issue){
    // A started database remains with its original process/state if its console or
    // journal transport fails. Its inherited kernel lock prevents a duplicate.
    if(child&&child.exitCode===null&&child.signalCode===null){
      child.unref();try{await onEvent({event:'runtime-retained',directory,pid:child.pid,log:join(directory,'risingwave.log')});}catch{}
    }
    throw issue;
  }finally{await held.close();}
}
const HELP=[
  'RisingWave 3.1.0 retained local runtime — Linux x86_64/AVX2, Node 22.16+, tar, util-linux flock',
  '',
  'node local-runtime.mjs prepare --directory PRIVATE_RUNTIME --operation-id ORIGINAL_OPERATION',
  '  --store-directory ORIGINAL_STATE --listen-address 127.0.0.1:PORT',
  '  --memory-bytes BYTES --reserve-bytes BYTES --parallelism COUNT --compaction-threads COUNT',
  '  --minimum-free-bytes BYTES --environment-file ORIGINAL_PRIVATE_ENVIRONMENT_JSON',
  '  [--connection-env RISINGWAVE_URL]',
  '  (--archive ORIGINAL_TAR_GZ | --download | --binary ORIGINAL_EXECUTABLE --binary-sha256 SHA256)',
  '',
  'node local-runtime.mjs inspect --directory PRIVATE_RUNTIME [--connect]',
  'node local-runtime.mjs serve --directory PRIVATE_RUNTIME [--startup-timeout-ms MILLISECONDS]',
  '',
  'prepare retains the original archive/executable and a versioned configuration.',
  'Use the same private runtime, state and environment across native and managed receiving.',
  'serve keeps one foreground database alive; normal termination reaches that owned child.',
  'An already running exact instance is reused. inspect --connect uses the installed original pg driver.',
  'Full database output stays in private risingwave.log. Stdout reports progress and paths.'
].join('\n');
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.length===1&&argv[0]==='--help'){process.stdout.write(HELP+'\n');return;}
  const [action,...args]=argv,options={},boolean=new Set(['--download','--connect']);
  const names={'--directory':'directory','--operation-id':'operationId','--store-directory':'storeDirectory',
    '--listen-address':'listenAddress','--memory-bytes':'memoryBytes','--reserve-bytes':'reserveBytes',
    '--parallelism':'parallelism','--compaction-threads':'compactionThreads','--minimum-free-bytes':'minimumFreeBytes',
    '--environment-file':'environmentFile','--connection-env':'connectionEnv','--archive':'archivePath',
    '--binary':'binaryPath','--binary-sha256':'binarySha256','--startup-timeout-ms':'startupTimeoutMs'};
  const numberNames=new Set(['memoryBytes','reserveBytes','parallelism','compactionThreads','minimumFreeBytes','startupTimeoutMs']);
  for(let i=0;i<args.length;i++){
    const flag=args[i],name=boolean.has(flag)?flag.slice(2):names[flag];
    need(name&&!Object.hasOwn(options,name),'RUNTIME_CLI_ARGUMENT_INVALID',HELP);
    if(boolean.has(flag))options[name]=true;
    else{need(i+1<args.length&&!args[i+1].startsWith('--'),'RUNTIME_CLI_VALUE_REQUIRED',HELP);
      const value=args[++i];if(numberNames.has(name))need(/^(0|[1-9][0-9]*)$/.test(value),'RUNTIME_CLI_INTEGER_REQUIRED');
      options[name]=numberNames.has(name)?Number(value):value;}
  }
  const allowed=action==='prepare'?new Set(['directory','operationId','storeDirectory','listenAddress','memoryBytes','reserveBytes',
    'parallelism','compactionThreads','minimumFreeBytes','environmentFile','connectionEnv','archivePath','binaryPath','binarySha256','download']):
    action==='inspect'?new Set(['directory','connect']):action==='serve'?new Set(['directory','startupTimeoutMs']):null;
  need(allowed&&Object.keys(options).every(x=>allowed.has(x)),'RUNTIME_CLI_ARGUMENT_INVALID',HELP);
  const onEvent=entry=>{process.stdout.write(JSON.stringify(entry)+'\n');};
  if(action==='prepare')return prepareLocalRisingWaveRuntime({...options,onEvent});
  if(action==='serve')return serveLocalRisingWaveRuntime({...options,onEvent});
  const result=await inspectLocalRisingWaveRuntime(options);onEvent(result);return result;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(issue=>{process.stderr.write(JSON.stringify(errorValue(issue))+'\n');process.exitCode=1;});
