// MIT. Actual OpenSSH around the existing native Redis topology and product journey.
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, connect } from 'node:net';
import { mkdir, readFile, writeFile, readdir, stat, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, isAbsolute, delimiter } from 'node:path';
import { userInfo, tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { startNativeRedisTopology } from '../native-topology.mjs';
import { resolveRedisConnectionProfile } from '../connection-profile.mjs';
import { compileRedisSshDeployment } from './ssh-profile.mjs';
import { openRedisSshDeployment, runRedisSshApplication } from './ssh.mjs';

const execute=promisify(execFile),sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';
const quote=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
async function binary(name,fallback) {
  const selected=name??fallback;
  const candidates=isAbsolute(selected)?[selected]:(process.env.PATH??'').split(delimiter).map(p=>join(p,selected));
  for(const candidate of candidates)try{await access(candidate,constants.X_OK);return candidate;}catch{}
  throw new Error('REDIS_SSH_NATIVE_EXECUTABLE_UNAVAILABLE:'+selected);
}
async function waitFor(check,description,timeout=20000) {
  const deadline=Date.now()+timeout;
  while(Date.now()<deadline){const value=await check();if(value)return value;await sleep(50);}
  throw new Error(description);
}
async function reservePort(used) {
  for(;;){
    const server=createServer();
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
    const port=server.address().port;
    await new Promise(resolve=>server.close(resolve));
    if(!used.has(port)){used.add(port);return port;}
  }
}
function alive(pid) {
  try{process.kill(pid,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}
}
function signalGroup(record,signal) {
  try{process.kill(-record.child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}
}
async function stopServer(record) {
  if(!record?.child.pid)return;
  signalGroup(record,'SIGTERM');
  const until=Date.now()+2000;
  while(Date.now()<until){
    try{process.kill(-record.child.pid,0);}catch(error){if(error.code==='ESRCH')break;throw error;}
    await sleep(25);
  }
  try{process.kill(-record.child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  await record.exited;
}
async function startServer(executable,configuration) {
  const child=spawn(executable,['-D','-e','-f',configuration],{detached:true,stdio:['ignore','pipe','pipe']});
  const record={child,log:'',outcome:null};
  record.exited=new Promise(resolve=>{
    const done=value=>{if(!record.outcome){record.outcome=value;resolve(value);}};
    child.once('error',error=>done({error:error.message}));
    child.once('close',(code,signal)=>done({code,signal}));
  });
  for(const stream of [child.stdout,child.stderr])stream.on('data',bytes=>{record.log=(record.log+bytes).slice(-16384);});
  return record;
}

export async function startNativeRedisSshTopology(options) {
  if(process.env.SF30_REDIS_JOURNEY_TLS==='1')
    throw new Error('REDIS_SSH_JOURNEY_SELECTS_SSH_WITH_REMOTE_LOOPBACK');
  const ssh=await binary(process.env.SF30_SSH_JOURNEY_SSH,'ssh');
  const keygen=await binary(process.env.SF30_SSH_JOURNEY_KEYGEN,'ssh-keygen');
  const sshd=await binary(process.env.SF30_SSH_JOURNEY_SSHD,'/usr/sbin/sshd');
  const directory=options.directory,topologyRoot=join(directory,'redis'),sshRoot=join(directory,'ssh');
  const runtimeDirectory=process.env.SF30_SSH_JOURNEY_RUNTIME_DIRECTORY??tmpdir();
  await mkdir(sshRoot,{recursive:true,mode:0o700});
  const original=await startNativeRedisTopology({...options,directory:topologyRoot});
  let server,tunnels,closing,lastQueries,ownershipResult;
  const identityEnvironment='SF30_REDIS_SSH_JOURNEY_IDENTITY_FILE';
  const knownEnvironment='SF30_REDIS_SSH_JOURNEY_KNOWN_HOSTS_FILE';
  const prior=new Map([identityEnvironment,knownEnvironment].map(name=>[name,process.env[name]]));
  const restore=()=>{for(const[name,value]of prior){if(value===undefined)delete process.env[name];else process.env[name]=value;}};
  async function close() {
    if(closing)return closing;
    closing=(async()=>{
      try{await tunnels?.close();await stopServer(server);}
      finally{try{await original.close();}finally{restore();}}
    })();return closing;
  }
  try{
    const used=new Set(),sshPort=await reservePort(used),hostKey=join(sshRoot,'host-ed25519'),identity=join(sshRoot,'client-ed25519');
    for(const path of [hostKey,identity])
      await execute(keygen,['-q','-t','ed25519','-N','','-C','native-redis-ssh-journey','-f',path],{timeout:20000,maxBuffer:16384});
    const publicIdentity=await readFile(identity+'.pub','utf8');
    const publicHost=(await readFile(hostKey+'.pub','utf8')).trim().split(/\s+/).slice(0,2).join(' ');
    const authorized=join(sshRoot,'authorized_keys'),known=join(sshRoot,'known_hosts');
    const knownBytes=Buffer.from('[127.0.0.1]:'+sshPort+' '+publicHost+'\n');
    await writeFile(authorized,publicIdentity,{mode:0o600});
    await writeFile(known,knownBytes,{mode:0o600});
    const login=process.env.SF30_SSH_JOURNEY_USER??userInfo().username;
    if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(login))throw new Error('REDIS_SSH_NATIVE_USER_INVALID');
    const observed=[];
    for(const entry of await readdir(topologyRoot,{withFileTypes:true})){
      if(!entry.isDirectory()||!/^data-\d+$|^sentinel-\d+$/.test(entry.name))continue;
      const configuration=await readFile(join(topologyRoot,entry.name,'redis.conf'),'utf8');
      const port=Number(configuration.match(/^port ([0-9]+)$/m)?.[1]);
      if(!port)throw new Error('REDIS_SSH_NATIVE_NODE_PORT_UNAVAILABLE:'+entry.name);
      observed.push({id:entry.name,role:entry.name.startsWith('sentinel-')?'sentinel':'data',port});
    }
    observed.sort((a,b)=>a.id.localeCompare(b.id));
    assert.equal(observed.length,options.topology==='cluster'?3:5);
    const serverConfiguration=join(sshRoot,'sshd.conf');
    const settings=[
      'ListenAddress 127.0.0.1','Port '+sshPort,'HostKey '+quote(hostKey),
      'PidFile '+quote(join(sshRoot,'sshd.pid')),'AuthorizedKeysFile '+quote(authorized),
      'AuthenticationMethods publickey','PubkeyAuthentication yes','PasswordAuthentication no',
      'KbdInteractiveAuthentication no','UsePAM no','PermitRootLogin prohibit-password',
      'StrictModes no','AllowUsers '+login,'AllowTcpForwarding local','GatewayPorts no',
      'PermitOpen '+observed.map(node=>'127.0.0.1:'+node.port).join(' '),
      'X11Forwarding no','AllowAgentForwarding no','PermitTTY no','LogLevel VERBOSE',
    ];
    await writeFile(serverConfiguration,settings.join('\n')+'\n',{mode:0o600});
    await execute(sshd,['-t','-f',serverConfiguration],{timeout:10000,maxBuffer:16384});
    server=await startServer(sshd,serverConfiguration);
    await waitFor(async()=>{
      if(server.outcome)throw new Error('REDIS_SSH_NATIVE_SERVER_EXIT:'+JSON.stringify(server.outcome)+':'+server.log);
      return new Promise(resolve=>{
        const socket=connect({host:'127.0.0.1',port:sshPort});
        socket.setTimeout(250);socket.once('connect',()=>{socket.destroy();resolve(true);});
        socket.once('error',()=>resolve(false));socket.once('timeout',()=>{socket.destroy();resolve(false);});
      });
    },'REDIS_SSH_NATIVE_SERVER_NOT_READY');
    process.env[identityEnvironment]=identity;process.env[knownEnvironment]=known;
    const logical={...original.profile};
    for(const key of ['host','port','rootNodes','sentinelRootNodes','nodeAddressMap','tls','caFile','sentinelTls','sentinelCaFile'])
      delete logical[key];
    async function deployment(id) {
      const nodes=[];
      for(const observedNode of observed)nodes.push({
        id:observedNode.id,role:observedNode.role,
        aliases:[{host:'127.0.0.1',port:observedNode.port}],
        localPort:await reservePort(used),remoteHost:'127.0.0.1',remotePort:observedNode.port,
        ssh:{host:'127.0.0.1',port:sshPort,user:login,
          identityFileEnv:identityEnvironment,knownHostsFileEnv:knownEnvironment},
      });
      return {schema:'stellar-forge.redis-ssh-deployment.v1',id,connection:logical,nodes,
        seeds:nodes.filter(node=>node.role===(options.topology==='sentinel'?'sentinel':'data')).map(node=>node.id),
        connectTimeoutMs:3000,startupTimeoutMs:30000,closeTimeoutMs:1500,keepAliveSeconds:1,maxMissedKeepAlives:2};
    }
    const selected=await deployment('native-redis-ssh-'+options.topology);
    const compiled=compileRedisSshDeployment(selected);
    tunnels=await openRedisSshDeployment({deployment:selected,expectedSha256:compiled.deploymentSha256,
      runtimeDirectory,binary:ssh});
    const connection=await resolveRedisConnectionProfile(compiled.connection);
    const badConnection=()=>options.topology==='cluster'
      ?{...connection,defaults:{...connection.defaults,password:'wrong'}}
      :{...connection,sentinelClientOptions:{...connection.sentinelClientOptions,password:'wrong'}};
    async function exercise(args) {
      lastQueries=args.queries;
      const topologyResult=await original.exercise(args),state=tunnels.status();
      assert.equal(state.status,'READY');
      assert.equal(state.nodes.length,observed.length);
      assert.ok(state.nodes.every(node=>node.status==='READY'));
      return {...topologyResult,access:{transport:'OpenSSH',authenticatedForwards:state.nodes.length,
        deploymentSha256:compiled.deploymentSha256,knownHostsSha256:sha(knownBytes),
        dataAndMonitorDiscovery:'original-nodeAddressMap'}};
    }
    async function accessExercise() {
      if(ownershipResult)return ownershipResult;
      assert.ok(lastQueries?.availability,'The original full data journey must run first.');
      const second=await deployment('native-redis-ssh-application-lifetime');
      const reviewed=compileRedisSshDeployment(second);
      const sourcePath=join(sshRoot,'application-source.json'),marker=join(sshRoot,'application-ready.json'),
        childPath=join(sshRoot,'application.mjs');
      await writeFile(sourcePath,encode({connection:reviewed.connection,queries:{availability:lastQueries.availability}}),{mode:0o600});
      const program=[
        "import fs from 'node:fs';",
        "import {spawn} from 'node:child_process';",
        "import {createRedisQuerySource} from "+JSON.stringify(new URL('../source.mjs',import.meta.url).href)+";",
        "import {resolveRedisConnectionProfile} from "+JSON.stringify(new URL('../connection-profile.mjs',import.meta.url).href)+";",
        "const input=JSON.parse(fs.readFileSync("+JSON.stringify(sourcePath)+",'utf8'));",
        "const source=await createRedisQuerySource({connection:await resolveRedisConnectionProfile(input.connection),queries:input.queries});",
        "const result=await source.query('availability',{});",
        "const child=spawn(process.execPath,['-e','process.on(\"SIGTERM\",()=>{});setInterval(()=>{},1000);'],{stdio:'ignore'});",
        "fs.writeFileSync("+JSON.stringify(marker)+",JSON.stringify({pid:process.pid,descendant:child.pid,result}),{mode:0o600});",
        "const timer=setInterval(()=>{},1000);",
        "process.once('SIGTERM',async()=>{clearInterval(timer);await source.close();child.kill('SIGTERM');process.exit(0);});",
      ].join('\n')+'\n';
      await writeFile(childPath,program,{mode:0o600});
      const running=runRedisSshApplication({deployment:second,expectedSha256:reviewed.deploymentSha256,
        command:[process.execPath,childPath],runtimeDirectory,binary:ssh,stdio:'capture'});
      let ended;running.then(result=>{ended={result};},error=>{ended={error};});
      const ready=await waitFor(async()=>{
        if(ended?.error)throw ended.error;
        if(ended)throw new Error('REDIS_SSH_NATIVE_APPLICATION_EARLY_EXIT:'+JSON.stringify(ended.result));
        try{return JSON.parse(await readFile(marker,'utf8'));}catch(error){if(error.code==='ENOENT')return false;throw error;}
      },'REDIS_SSH_NATIVE_APPLICATION_NOT_READY',30000);
      assert.equal(ready.result.rowCount,1);
      await stopServer(server);
      const result=await running;
      assert.equal(result.status,'TUNNEL_FAILED');
      assert.equal(result.deployment.status,'CLOSED');
      assert.deepEqual(result.deployment.cleanupErrors,[]);
      await waitFor(()=>!alive(ready.pid)&&!alive(ready.descendant),'REDIS_SSH_NATIVE_APPLICATION_GROUP_REMAINED',5000);
      await tunnels.closed;
      ownershipResult={result:'PASS',transport:'OpenSSH',applicationReadBeforeDisconnect:true,
        originalApplicationClosed:true,descendantClosed:true,allForwardsClosed:true,
        status:result.status,deploymentSha256:reviewed.deploymentSha256,
        knownHostsSha256:sha(knownBytes),authenticatedForwards:observed.length,
        nativeSshVersion:(await execute(ssh,['-V'],{timeout:10000,maxBuffer:16384})).stderr.trim()};
      return ownershipResult;
    }
    return {...original,connection,profile:compiled.connection,badConnection,exercise,accessExercise,close};
  }catch(error){await close();throw error;}
}
