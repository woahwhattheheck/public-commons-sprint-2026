#!/usr/bin/env node
// MIT. Own the complete SSH-forward and customer-application process lifetime.
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, stat, open, link, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { compileRedisSshDeployment, prepareRedisSshCommissioning } from './ssh-profile.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => JSON.stringify(value,null,2)+'\n';
const issue = (code,message,details) => Object.assign(new Error(message),{code,...(details?{details}:{})});
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
function cancelled(signal) {
  if (signal?.aborted) throw signal.reason ?? issue('REDIS_SSH_CANCELLED','Deployment cancelled.');
}
function pathFromEnvironment(environment,name,label) {
  if (name === undefined) return undefined;
  const value=environment[name];
  if (typeof value!=='string' || !isAbsolute(value) || !value.length || value.length>4096 ||
      /[\x00-\x1f\x7f]/.test(value) || value.includes('$'+'{'))
    throw issue('REDIS_SSH_PATH_ENVIRONMENT_REQUIRED',
      label+' must reference an absolute path in '+name+'.',{name});
  return value;
}
function configurationPath(value) {
  // OpenSSH parses -o values, then expands its percent tokens. No shell runs.
  return '"'+value.replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
}
async function regularFile(path,label,{maxBytes=1048576}={}) {
  const info=await stat(path);
  if(!info.isFile()||info.size<1||info.size>maxBytes)
    throw issue('REDIS_SSH_FILE_INVALID',label+' must be a nonempty regular file.',{maxBytes});
  return info;
}
async function credentials(node,environment) {
  const knownHosts=pathFromEnvironment(environment,node.ssh.knownHostsFileEnv,'Known-hosts file');
  const identity=pathFromEnvironment(environment,node.ssh.identityFileEnv,'SSH identity file');
  const agent=pathFromEnvironment(environment,node.ssh.agentSocketEnv,'SSH agent socket');
  await regularFile(knownHosts,'Known-hosts file');
  if(identity) await regularFile(identity,'SSH identity file');
  if(agent && !(await stat(agent)).isSocket())
    throw issue('REDIS_SSH_AGENT_INVALID','The selected SSH agent path must be a socket.');
  const knownHostsBytes=await readFile(knownHosts);
  return {knownHosts,identity,agent,knownHostsBytes,knownHostsSha256:sha(knownHostsBytes)};
}
function ownedChild(executable,args,{cwd,environment,stdio='capture'}={}) {
  const record={child:null,outcome:null,log:'',ready:false};
  record.exited=new Promise(resolve => {record.resolve=resolve;});
  const settle=value=>{if(!record.outcome){record.outcome=value;record.resolve(value);}};
  const child=spawn(executable,args,{cwd,env:environment,detached:true,
    stdio:stdio==='inherit'?'inherit':['ignore','pipe','pipe'],windowsHide:true});
  record.child=child;
  child.once('error',error=>settle({code:null,signal:null,error:{code:error.code,message:error.message}}));
  child.once('close',(code,signal)=>settle({code,signal}));
  if(stdio!=='inherit') for(const stream of [child.stdout,child.stderr])
    stream?.on('data',bytes=>{record.log=(record.log+bytes.toString('utf8')).slice(-8192);});
  return record;
}
function groupExists(record) {
  if(!record.child.pid)return false;
  try{process.kill(-record.child.pid,0);return true;}
  catch(error){if(error.code==='ESRCH')return false;throw error;}
}
function signalGroup(record,signal) {
  if(!record.child.pid)return;
  try{process.kill(-record.child.pid,signal);}
  catch(error){if(error.code!=='ESRCH')throw error;}
}
async function stopOwned(record,timeoutMs) {
  if(!record?.child)return;
  signalGroup(record,'SIGTERM');
  const until=Date.now()+timeoutMs;
  while(groupExists(record)&&Date.now()<until)await sleep(25);
  if(groupExists(record))signalGroup(record,'SIGKILL');
  await record.exited;
}
function commonSshArguments(node,credential,compiled,socket) {
  const limits=compiled.limits;
  const options=[
    'BatchMode=yes','PreferredAuthentications=publickey','PasswordAuthentication=no',
    'KbdInteractiveAuthentication=no','NumberOfPasswordPrompts=0',
    'StrictHostKeyChecking=yes','UpdateHostKeys=no','VerifyHostKeyDNS=no',
    'GlobalKnownHostsFile=/dev/null','UserKnownHostsFile='+configurationPath(credential.knownHosts),
    'ForwardAgent=no','ForwardX11=no','PermitLocalCommand=no','RequestTTY=no',
    'ProxyCommand=none','ProxyJump=none','CanonicalizeHostname=no','ConnectionAttempts=1',
    'ConnectTimeout='+Math.ceil(limits.connectTimeoutMs/1000),
    'ServerAliveInterval='+limits.keepAliveSeconds,
    'ServerAliveCountMax='+limits.maxMissedKeepAlives,
    'ExitOnForwardFailure=yes','ControlMaster=yes','ControlPersist=no',
    'IdentitiesOnly='+(credential.identity?'yes':'no'),
    'IdentityAgent='+(credential.agent?configurationPath(credential.agent):'none'),
    'LogLevel=ERROR',
  ];
  const args=['-F','none','-N','-T','-n','-S',socket.replaceAll('%','%%'),
    '-p',String(node.ssh.port),'-l',node.ssh.user];
  for(const option of options)args.push('-o',option);
  if(credential.identity)args.push('-i',credential.identity.replaceAll('%','%%'));
  const remote=node.remoteHost.includes(':')?'['+node.remoteHost+']':node.remoteHost;
  args.push('-L','127.0.0.1:'+node.localPort+':'+remote+':'+node.remotePort,node.ssh.host);
  return args;
}
async function controlReady(record,{binary,environment,socket,node,deadline,signal,controls,closeTimeoutMs}) {
  while(Date.now()<deadline) {
    cancelled(signal);
    if(record.outcome)
      throw issue('REDIS_SSH_AUTHENTICATION_FAILED','SSH did not open the selected forward.',
        {nodeId:node.id,outcome:record.outcome,diagnostic:record.log});
    let socketReady=false;
    try{socketReady=(await stat(socket)).isSocket();}catch(error){if(error.code!=='ENOENT')throw error;}
    if(socketReady) {
      const check=ownedChild(binary,['-F','none','-S',socket.replaceAll('%','%%'),'-O','check',
        '-p',String(node.ssh.port),'-l',node.ssh.user,node.ssh.host],{environment});
      controls.add(check);
      try {
        const outcome=await Promise.race([check.exited,sleep(Math.min(1000,Math.max(1,deadline-Date.now()))).then(()=>null)]);
        cancelled(signal);
        if(outcome?.code===0){record.ready=true;return;}
      } finally {
        await stopOwned(check,closeTimeoutMs);controls.delete(check);
      }
    }
    await sleep(50);
  }
  throw issue('REDIS_SSH_START_TIMEOUT','SSH authentication and local forwarding did not complete before the reviewed deadline.',{nodeId:node.id});
}

/**
 * The returned signal aborts on any lost SSH process. A caller that owns an
 * application process should use runRedisSshApplication so both process groups
 * close together. No key or password values enter the saved deployment.
 */
export async function openRedisSshDeployment({
  deployment,expectedSha256,environment=process.env,signal,
  runtimeDirectory=tmpdir(),binary='ssh',
}={}) {
  if(process.platform==='win32')
    throw issue('REDIS_SSH_POSIX_REQUIRED','Use this process-group deployment on a POSIX application host.');
  const compiled=compileRedisSshDeployment(deployment);
  if(typeof expectedSha256!=='string'||expectedSha256!==compiled.deploymentSha256)
    throw issue('REDIS_SSH_REVIEW_CHANGED','Run the exact reviewed deployment SHA256.',
      {deploymentSha256:compiled.deploymentSha256});
  if(typeof runtimeDirectory!=='string'||!isAbsolute(runtimeDirectory)||/[\x00-\x1f\x7f]/.test(runtimeDirectory)||
      runtimeDirectory.includes('$'+'{'))
    throw issue('REDIS_SSH_RUNTIME_PATH_INVALID','Select an absolute local runtime directory.');
  cancelled(signal);
  const resolved=await Promise.all(compiled.nodes.map(node=>credentials(node,environment)));
  cancelled(signal);
  await mkdir(runtimeDirectory,{recursive:true,mode:0o700});
  const ownedDirectory=await mkdtemp(join(runtimeDirectory,'redis-ssh-'));
  const records=[],controls=new Set(),controller=new AbortController();
  let phase='STARTING',failure=null,closing;
  let resolveClosed;const closed=new Promise(resolve=>{resolveClosed=resolve;});
  const startedAt=new Date().toISOString();
  const status=()=>({
    id:compiled.id,deploymentSha256:compiled.deploymentSha256,status:phase,startedAt,
    ...compiled.review,
    nodes:records.map(record=>({id:record.node.id,localPort:record.node.localPort,
      status:record.outcome?'CLOSED':record.ready?'READY':'STARTING',
      knownHostsSha256:record.knownHostsSha256})),
    failure:failure?{code:failure.code??'REDIS_SSH_FAILED',message:failure.message,details:failure.details??null}:null,
  });
  async function close(reason) {
    if(closing)return closing;
    closing=(async()=>{
      phase='CLOSING';
      if(!controller.signal.aborted)controller.abort(reason??issue('REDIS_SSH_CLOSED','Deployment closed.'));
      signal?.removeEventListener('abort',externalAbort);
      const stopped=await Promise.allSettled([...controls,...records].map(record=>stopOwned(record,compiled.limits.closeTimeoutMs)));
      const cleanupErrors=stopped.flatMap(result=>result.status==='rejected'?[String(result.reason?.message??result.reason)]:[]);
      try{await rm(ownedDirectory,{recursive:true,force:true});}catch(error){cleanupErrors.push(error.message);}
      phase='CLOSED';const result={...status(),cleanupErrors};resolveClosed(result);return result;
    })();
    return closing;
  }
  function externalAbort() {
    failure=signal.reason??issue('REDIS_SSH_CANCELLED','Deployment cancelled.');
    if(!controller.signal.aborted)controller.abort(failure);
    if(phase==='READY')void close(failure);
  }
  signal?.addEventListener('abort',externalAbort,{once:true});
  if(signal?.aborted)externalAbort();
  try {
    // The exact public host-key bytes hashed above are the bytes SSH reads.
    for(let i=0;i<resolved.length;i++){
      const pinned=join(ownedDirectory,'known-hosts-'+i);
      await retainExact(pinned,resolved[i].knownHostsBytes);resolved[i].knownHosts=pinned;
      delete resolved[i].knownHostsBytes;
    }
    const deadline=Date.now()+compiled.limits.startupTimeoutMs;
    let next=0;
    const start=async()=>{
      for(;;) {
        cancelled(controller.signal);
        const index=next++;
        if(index>=compiled.nodes.length)return;
        const node=compiled.nodes[index],credential=resolved[index],socket=join(ownedDirectory,String(index));
        if(Buffer.byteLength(socket)>96)
          throw issue('REDIS_SSH_RUNTIME_PATH_TOO_LONG','Choose a shorter private runtime directory.');
        const record=ownedChild(binary,commonSshArguments(node,credential,compiled,socket),
          {environment:{...environment,SSH_ASKPASS_REQUIRE:'never'}});
        Object.assign(record,{node,socket,knownHostsSha256:credential.knownHostsSha256});
        records.push(record);
        record.exited.then(outcome=>{
          if(closing)return;
          failure=issue('REDIS_SSH_CONNECTION_LOST','An owned SSH connection ended.',
            {nodeId:node.id,outcome,diagnostic:record.log});
          if(!controller.signal.aborted)controller.abort(failure);
          if(phase==='READY')void close(failure);
        });
        await controlReady(record,{binary,environment,socket,node,deadline,signal:controller.signal,
          controls,closeTimeoutMs:compiled.limits.closeTimeoutMs});
      }
    };
    const starters=await Promise.allSettled(Array.from({length:Math.min(4,compiled.nodes.length)},start));
    const rejected=starters.find(result=>result.status==='rejected');
    if(rejected)throw rejected.reason;
    cancelled(controller.signal);phase='READY';
    return Object.freeze({
      connection:structuredClone(compiled.connection),review:structuredClone(compiled.review),
      deploymentSha256:compiled.deploymentSha256,signal:controller.signal,closed,status,close,
    });
  }catch(error){failure??=error;await close(error);throw error;}
}

export async function runRedisSshApplication({
  deployment,expectedSha256,command,cwd,environment=process.env,signal,
  runtimeDirectory,binary='ssh',stdio='inherit',
}={}) {
  if(!Array.isArray(command)||!command.length||command.length>512||
      command.some(value=>typeof value!=='string'||value.includes('\0'))||!command[0]||
      command.reduce((size,value)=>size+Buffer.byteLength(value),0)>131072)
    throw issue('REDIS_SSH_COMMAND_INVALID','Pass the application executable and its original arguments as an array.');
  const tunnels=await openRedisSshDeployment({deployment,expectedSha256,environment,signal,runtimeDirectory,binary});
  let application,stopping;
  const stopApplication=()=>{
    if(application&&!stopping)stopping=stopOwned(application,compileRedisSshDeployment(deployment).limits.closeTimeoutMs);
    return stopping??Promise.resolve();
  };
  const onTunnelEnd=()=>{void stopApplication().catch(()=>{});};
  let outcome,networkFailure,cleanup;
  try {
    cancelled(tunnels.signal);
    application=ownedChild(command[0],command.slice(1),{cwd,environment,stdio});
    tunnels.signal.addEventListener('abort',onTunnelEnd,{once:true});
    if(tunnels.signal.aborted)await stopApplication();
    outcome=await application.exited;
    networkFailure=tunnels.status().failure;
  }finally{
    tunnels.signal.removeEventListener('abort',onTunnelEnd);
    await stopApplication();
    cleanup=await tunnels.close();
  }
  const status=networkFailure?'TUNNEL_FAILED':cleanup.cleanupErrors.length?'CLEANUP_FAILED':
    outcome?.code===0?'COMPLETE':'APPLICATION_FAILED';
  return {schema:'stellar-forge.redis-ssh-application-result.v1',status,
    deploymentSha256:tunnels.deploymentSha256,application:outcome,
    ...(stdio==='capture'?{applicationOutput:application.log}:{}),deployment:cleanup};
}

async function readJson(path) {
  const handle=await open(path,'r');
  try {
    const before=await handle.stat();
    if(!before.isFile()||before.size>3145728)throw issue('REDIS_SSH_INPUT_INVALID','Select a regular JSON input within 3 MiB.');
    const bytes=await handle.readFile(),after=await handle.stat();
    if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs)
      throw issue('REDIS_SSH_INPUT_CHANGED','The selected input changed while it was read.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  }finally{await handle.close();}
}
async function retainExact(path,bytes) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.incoming-'+randomUUID();
  const file=await open(temporary,'wx',0o600);
  try{
    try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
    try{await link(temporary,path);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      if(!(await readFile(path)).equals(bytes))
        throw issue('REDIS_SSH_OUTPUT_CHANGED','The existing customer input has different bytes. Choose a new explicit output path.');
    }
  }finally{await rm(temporary,{force:true});}
  return {path:resolve(path),bytes:bytes.length,sha256:sha(bytes)};
}
export async function redisSshCli(args=process.argv.slice(2),{signal}={}) {
  const [command,...tail]=args,index=tail.indexOf('--');
  const flags=index===-1?tail:tail.slice(0,index),application=index===-1?[]:tail.slice(index+1);
  const values={};
  for(let i=0;i<flags.length;i+=2){
    if(!['--deployment','--sha256','--input','--output','--runtime-dir','--cwd'].includes(flags[i])||
        !flags[i+1]||Object.hasOwn(values,flags[i]))
      throw issue('REDIS_SSH_ARGUMENTS_INVALID','Use profile, prepare or run with their complete named arguments.');
    values[flags[i]]=flags[i+1];
  }
  if(!['profile','prepare','run'].includes(command)||!values['--deployment'])
    throw issue('REDIS_SSH_ARGUMENTS_INVALID','Use profile|prepare|run --deployment <file>.');
  const allowed=command==='profile'?['--deployment']:command==='prepare'
    ?['--deployment','--input','--output']:['--deployment','--sha256','--runtime-dir','--cwd'];
  if(Object.keys(values).some(key=>!allowed.includes(key))||command!=='run'&&application.length)
    throw issue('REDIS_SSH_ARGUMENTS_INVALID','Use the arguments belonging to the selected command.');
  const deployment=await readJson(values['--deployment']);
  if(command==='profile'){
    const selected=compileRedisSshDeployment(deployment);
    return {schema:selected.schema,id:selected.id,deploymentSha256:selected.deploymentSha256,
      connection:selected.connection,requiredEnvironment:selected.requiredEnvironment,review:selected.review};
  }
  if(command==='prepare'){
    if(!values['--input']||!values['--output'])
      throw issue('REDIS_SSH_ARGUMENTS_INVALID','Prepare needs --input and --output for the original commissioning JSON.');
    const selected=prepareRedisSshCommissioning({input:await readJson(values['--input']),deployment});
    const retained=await retainExact(resolve(values['--output']),Buffer.from(encode(selected.input)));
    return {status:'PREPARED',...retained,deploymentSha256:selected.deploymentSha256,
      requiredEnvironment:selected.requiredEnvironment,review:selected.review};
  }
  if(!values['--sha256']||!application.length)
    throw issue('REDIS_SSH_ARGUMENTS_INVALID','Run needs the reviewed --sha256 and -- followed by the original application command.');
  return runRedisSshApplication({deployment,expectedSha256:values['--sha256'],command:application,
    cwd:values['--cwd'],runtimeDirectory:values['--runtime-dir'],signal});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const controller=new AbortController();
  const stop=signal=>{if(!controller.signal.aborted)controller.abort(issue('REDIS_SSH_CANCELLED','Received '+signal+'.'));};
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
  try{
    const result=await redisSshCli(process.argv.slice(2),{signal:controller.signal});
    process.stdout.write(encode(result));
    if(result.status&&!['PREPARED','COMPLETE'].includes(result.status))process.exitCode=2;
  }catch(error){
    process.stderr.write(encode({error:{code:error.code??'REDIS_SSH_FAILED',
      message:error.message,details:error.details??null}}));process.exitCode=1;
  }finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);}
}
