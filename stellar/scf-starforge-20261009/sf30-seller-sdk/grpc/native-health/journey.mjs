#!/usr/bin/env node
// MIT. One retained native service-health, merchant-agent, editor and customer operation.
import assert from 'node:assert/strict';
import {readFile, writeFile, open, link, unlink, mkdir, readdir, lstat, realpath, rename, symlink, access} from 'node:fs/promises';
import {join, resolve, dirname, relative, sep} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID, randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {setTimeout as pause} from 'node:timers/promises';

const OPERATION='SCF-GRPC-SERVICE-HEALTH-20261012-9B23';
const flags=new Map();
for(let i=2;i<process.argv.length;i+=2){
  assert(process.argv[i]?.startsWith('--')&&process.argv[i+1]&&!flags.has(process.argv[i]),'Use unique --name value arguments.');
  flags.set(process.argv[i],process.argv[i+1]);
}
const need=name=>resolve(assertValue(flags.get(name),'Missing '+name));
function assertValue(value,message){assert(value,message);return value;}
const sourceRoot=need('--source'),selectionPath=need('--selection'),workRoot=need('--work-root');
const modules=need('--node-modules'),chrome=need('--chrome'),playwrightPath=need('--playwright');
const mode=flags.get('--phase')??'all';assert(['all','core','browser'].includes(mode));
const PREFIX='stellar/scf-starforge-20261009/',GRPC=PREFIX+'sf30-seller-sdk/grpc/',MCP='stellar-forge/mcp-merchant-operator/';
const SUMMARY='/stellarforge.analytics.v1.Analytics/Summary';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const blob=bytes=>createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):
  Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const pretty=value=>JSON.stringify(value,null,2)+'\n',now=()=>new Date().toISOString();
const load=path=>import(pathToFileURL(join(sourceRoot,path)).href);
const exists=async path=>access(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const json=async path=>JSON.parse(await readFile(path,'utf8'));
async function syncDirectory(path){
  const handle=await open(path,'r');try{await handle.sync();}finally{await handle.close();}
}
async function save(path,value){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temp=path+'.'+randomUUID()+'.part',handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(Buffer.isBuffer(value)?value:pretty(value));await handle.sync();}
  finally{await handle.close();}
  await rename(temp,path);await syncDirectory(dirname(path));return path;
}
async function retainOriginal(path,bytes){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(await exists(path)){assert.deepEqual(await readFile(path),bytes,'Retain the first original bytes: '+path);return;}
  const temp=path+'.'+randomUUID()+'.part',handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  try{await link(temp,path);}
  catch(issue){if(issue.code!=='EEXIST')throw issue;assert.deepEqual(await readFile(path),bytes);}
  finally{await unlink(temp);}
  await syncDirectory(dirname(path));
}
await mkdir(workRoot,{recursive:true,mode:0o700});
const resultPath=join(workRoot,'result.json');
let result=await exists(resultPath)?await json(resultPath):{
  schema:'stellar-forge.grpc-service-health-native-journey.v1',operation:OPERATION,
  runId:randomUUID(),startedAt:now(),state:'STARTED',phases:{},refs:{},calls:{},sessions:[],
};
assert.equal(result.operation,OPERATION);
if(result.state==='COMPLETE'){
  if(process.env.SWARM_NATIVE_RECORD&&result.nativeCheckpoint?.state!=='complete'){
    result.nativeCheckpoint=await originalCheckpoint('health-complete-receiving');
    await save(join(workRoot,'checkpoint-receipt.json'),result.nativeCheckpoint);await save(resultPath,result);
  }
  console.log(pretty(result));process.exit(0);
}
if(mode==='browser')assert(result.coreComplete,'Complete the existing core phases before the browser-only continuation.');
const session={id:randomUUID(),startedAt:now(),phase:mode,counts:null,closed:{}};
result.sessions.push(session);result.state='STARTED';delete result.error;
const checkpoint=()=>save(resultPath,result);
const id=name=>result.refs[name]??=(randomUUID());
async function step(name,fn){
  if(result.phases[name]?.state==='COMPLETE')return result.phases[name].value;
  result.phases[name]={state:'STARTED',startedAt:now()};await checkpoint();
  const value=await fn();
  result.phases[name]={...result.phases[name],state:'COMPLETE',finishedAt:now(),value};
  await checkpoint();console.log(JSON.stringify({phase:name,...value}));return value;
}
async function child(command,args,options={}){
  return new Promise((done,reject)=>{
    const running=spawn(command,args,{stdio:['ignore','pipe','pipe'],...options});
    let stdout='',stderr='';const timer=setTimeout(()=>running.kill('SIGTERM'),120000);
    running.stdout.on('data',bytes=>{stdout+=bytes;if(stdout.length>32*1024*1024)running.kill('SIGTERM');});
    running.stderr.on('data',bytes=>{stderr=(stderr+bytes).slice(-65536);});
    running.once('error',error=>{clearTimeout(timer);reject(error);});
    running.once('close',(code,signal)=>{clearTimeout(timer);code===0?done({stdout,stderr}):
      reject(Object.assign(Error('Native child ended: '+String(code??signal)+' '+stderr),{code:'NATIVE_CHILD_FAILED'}));});
  });
}
async function originalCheckpoint(label){
  if(!process.env.SWARM_NATIVE_RECORD||!process.env.SWARM_NATIVE_HOST_ROOT)return null;
  const names=['result.json','executed-source.json'];
  for(const name of ['inputs','workspace','downloads','captures','operator'])if(await exists(join(workRoot,name)))names.push(name);
  const code='import json,os,sys\nfrom pathlib import Path\nsys.path.insert(0,os.environ["SWARM_NATIVE_HOST_ROOT"])\nfrom native_artifact_checkpoints import capture\nprint(json.dumps(capture(Path(os.environ["SWARM_NATIVE_RECORD"]),sys.argv[1],json.loads(sys.argv[2]),label=sys.argv[3])))\n';
  const value=await child('python3',['-B','-c',code,label+'-'+randomUUID(),JSON.stringify(names),label],{cwd:workRoot});
  const receipt=JSON.parse(value.stdout.trim().split('\n').at(-1));assert.equal(receipt.state,'complete');return receipt;
}

let upstream,workspace,merchant,client,browser,context,error;
let base,source,healthMain,downloadGrpcExport,downloadGrpcHealthExport,observeGrpcHealth,createGrpcWorkspace;
const environment={...process.env};
const privateFile=async(name,value)=>save(join(workRoot,name),value);
const model=()=>workspace.model;
const mcp=(name,args={})=>client.call('merchant_grpc_'+name,{workspace:'health',...args},{timeoutMs:60000});
const observationsPath=join(workRoot,'operator','native-calls.json');
let observations=[],observationWrite=Promise.resolve();
async function observeNative(entry){
  const pending=observationWrite.then(async()=>{
    const next=[...observations,{...entry,id:randomUUID(),sessionId:session.id,runId:result.runId}];
    await save(observationsPath,{schema:'stellar-forge.grpc-health-native-calls.v1',operation:OPERATION,
      runId:result.runId,calls:next});observations=next;
  });
  observationWrite=pending.catch(()=>{});return pending;
}
const observed=method=>observations.filter(row=>row.method===method);
async function full(value,name){
  if(value.state!=='COMPLETE_RESULT_RETAINED')return value;
  const d=value.delivery;
  const saved=await downloadGrpcExport({client,exportId:d.exportId,expectedManifestSha256:d.manifestFile.sha256,
    directory:join(workRoot,'downloads',name+'-'+d.exportId)});
  return json(join(saved.directory,'grpc-result.json'));
}
async function healthRead(operationId,section='summary',args={}){
  return full(await mcp('health_read',{operationId,section,...args}),'health-'+operationId);
}
async function startHealth(name,request){
  const operationId=id('health-'+name);await checkpoint();
  let earlier;
  try{earlier=await model().healthRead({id:operationId,section:'summary'});}catch(issue){if(issue.code!=='ENOENT')throw issue;}
  if(earlier){
    assert.equal(earlier.operation.revision,base.id);
    assert.equal(earlier.request.kind,request.kind);
    return earlier;
  }
  return full(await mcp('health_start',{operationId,revision:base.id,request}),'started-'+name);
}
async function until(operationId,predicate,ms=20000){
  const deadline=Date.now()+ms;
  for(;;){
    const value=await healthRead(operationId);
    if(predicate(value))return value;
    assert(Date.now()<deadline,'The original observation did not reach the selected native state: '+operationId);
    await pause(20);
  }
}
async function finished(operationId){
  return until(operationId,value=>!value.operation.runningHere&&!['PREPARED','RUNNING'].includes(value.operation.phase));
}
async function allEvents(operationId){
  let after=0,through,snapshot,rows=[];
  for(;;){
    const page=await healthRead(operationId,'events',{afterSequence:after,limit:25,
      ...(through===undefined?{}:{throughSequence:through,expectedSnapshot:snapshot})});
    through??=page.page.throughSequence;snapshot??=page.page.snapshot;rows.push(...page.events);
    if(page.page.nextAfterSequence===null)return rows;after=page.page.nextAfterSequence;
  }
}
async function cancelHealth(operationId){
  for(;;){
    try{return full(await mcp('health_stop',{operationId}),'stopped-'+operationId);}
    catch(issue){if(issue.code!=='GRPC_HEALTH_START_IN_PROGRESS')throw issue;await pause(10);}
  }
}
async function openWorkspace(){
  const {startGrpcWorkspace}=await load(GRPC+'workspace/server.mjs');
  workspace=await startGrpcWorkspace({stateDirectory:join(workRoot,'workspace'),port:0,sellerPort:0,
    operationsPort:0,releaseRuntime:{port:0},env:environment});
  await privateFile('operator/console-url.txt',Buffer.from(workspace.url+'\n'));
}
async function credentials(){
  const directory=join(workRoot,'operator','credentials');await mkdir(directory,{recursive:true,mode:0o700});
  const valuesPath=join(directory,'local-values.json');
  let values;
  if(await exists(valuesPath))values=await json(valuesPath);
  else{values={authorization:randomBytes(24).toString('hex'),mcpToken:randomBytes(32).toString('hex')};await save(valuesPath,values);}
  const openssl=async args=>child('openssl',args,{cwd:directory});
  const ready=join(directory,'complete.json');
  if(!await exists(ready)){
    await openssl(['req','-x509','-newkey','rsa:2048','-nodes','-keyout','ca.key','-out','ca.pem',
      '-days','2','-subj','/CN=Starforge local health root']);
    await openssl(['req','-newkey','rsa:2048','-nodes','-keyout','server.key','-out','server.csr','-subj','/CN=localhost']);
    await save(join(directory,'server.ext'),Buffer.from('subjectAltName=DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n'));
    await openssl(['x509','-req','-in','server.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial',
      '-out','server.pem','-days','2','-extfile','server.ext']);
    await openssl(['req','-newkey','rsa:2048','-nodes','-keyout','client.key','-out','client.csr','-subj','/CN=Starforge health operator']);
    await save(join(directory,'client.ext'),Buffer.from('extendedKeyUsage=clientAuth\n'));
    await openssl(['x509','-req','-in','client.csr','-CA','ca.pem','-CAkey','ca.key','-CAcreateserial',
      '-out','client.pem','-days','2','-extfile','client.ext']);
    await save(ready,{runId:result.runId,caSha256:hash(await readFile(join(directory,'ca.pem')))});
  }
  const ca=await readFile(join(directory,'ca.pem')),certificate=await readFile(join(directory,'server.pem')),key=await readFile(join(directory,'server.key'));
  Object.assign(environment,{GRPC_HEALTH_DEMO_AUTHORIZATION:values.authorization,GRPC_HEALTH_MCP_TOKEN:values.mcpToken,
    GRPC_HEALTH_CA:ca.toString(),GRPC_HEALTH_CERTIFICATE:await readFile(join(directory,'client.pem'),'utf8'),
    GRPC_HEALTH_PRIVATE_KEY:await readFile(join(directory,'client.key'),'utf8')});
  return {ca,certificate,key};
}
async function privateSummary(name,value){
  const copy=structuredClone(value);await privateFile(name,copy);return copy;
}
try{
  process.umask(0o077);
  for(const name of ['inputs','downloads','captures','operator'])await mkdir(join(workRoot,name),{recursive:true,mode:0o700});
  if(await exists(observationsPath)){
    const old=await json(observationsPath);assert.equal(old.operation,OPERATION);assert.equal(old.runId,result.runId);
    observations=old.calls;
  }
  const selection=await json(selectionPath);assert.equal(selection.operation,OPERATION);
  const files=Array.isArray(selection.files)?selection.files:Object.entries(selection.files).map(([path,sha])=>({path,sha}));
  assert(/^[a-f0-9]{40}$/.test(selection.commit));
  const inventory=[];
  for(const row of files.sort((a,b)=>a.path.localeCompare(b.path))){
    assert(!row.path.startsWith('/')&&!row.path.split('/').includes('..')&&!row.path.includes('\\'));
    const path=join(sourceRoot,row.path),stat=await lstat(path);assert(stat.isFile()&&!stat.isSymbolicLink());
    const bytes=await readFile(path);assert.equal(blob(bytes),row.sha,row.path);
    inventory.push({path:row.path,sha:row.sha,bytes:bytes.length,sha256:hash(bytes)});
  }
  const nodeModules=join(sourceRoot,'node_modules');
  if(await exists(nodeModules))assert.equal(await realpath(nodeModules),await realpath(modules));
  else await symlink(modules,nodeModules,'dir');
  result.source={commit:selection.commit,files:inventory.length,bytes:inventory.reduce((sum,row)=>sum+row.bytes,0),
    scope:selection.scope??'original-native-runtime-import-closure',sha256:hash(canonical(inventory))};
  await privateFile('executed-source.json',{...result.source,files:inventory});await checkpoint();
  const [{startHealthExample},health,cli,config,serve,receiver,download,healthDownload,workspaceModule]=await Promise.all([
    load(GRPC+'examples/health-server.mjs'),load(GRPC+'health.mjs'),load(GRPC+'health-cli.mjs'),
    load(MCP+'config.mjs'),load(MCP+'serve.mjs'),load(MCP+'retained-download.mjs'),
    load(MCP+'grpc-workspace-download.mjs'),load(MCP+'grpc-health-download.mjs'),load(GRPC+'workspace/model.mjs')]);
  ({healthMain}=cli);({observeGrpcHealth}=health);({downloadGrpcExport}=download);
  ({downloadGrpcHealthExport}=healthDownload);({createGrpcWorkspace}=workspaceModule);
  const nativeCredentials=await credentials();
  upstream=await startHealthExample({port:result.refs.servicePort??0,authorization:environment.GRPC_HEALTH_DEMO_AUTHORIZATION,
    credentials:nativeCredentials,observeCall:observeNative});
  result.refs.servicePort=Number(upstream.target.split(':').at(-1));await checkpoint();
  source={schema:'stellar-forge.grpc-source.v1',target:upstream.target,
    transport:{mode:'tls',caEnv:'GRPC_HEALTH_CA',certificateEnv:'GRPC_HEALTH_CERTIFICATE',
      privateKeyEnv:'GRPC_HEALTH_PRIVATE_KEY',serverName:'localhost'},
    metadata:[{name:'authorization',valueEnv:'GRPC_HEALTH_DEMO_AUTHORIZATION'}],
    limits:{timeoutMs:5000,readyTimeoutMs:2000,maxInFlight:4,
      stream:{maxBytes:1048576,maxRecords:1000,idleTimeoutMs:1000}}};
  const plan=await json(join(sourceRoot,GRPC+'examples/merchant-plan.json'));
  await privateFile('inputs/source.json',source);await privateFile('inputs/plan.json',plan);
  await openWorkspace();
  if(!result.refs.base){
    const state=await model().state(),current=state.currentRevision??state.current?.revision;
    if(current)base=await model().open({revision:current});
    else base=await model().capture({directory:join(sourceRoot,GRPC+'examples/proto'),entrypoints:['analytics.proto'],
      source,plan,baseRevision:null,title:'Native service health and merchant receiving'});
    result.refs.base=base.id;await checkpoint();
  }
  base=await model().open({revision:result.refs.base});assert.equal(base.protoSource.sha256,upstream.applicationSource.sha256);
  assert.equal(base.source.target,source.target);assert.equal(base.source.transport.mode,'tls');
  const current=await model().state();
  if((current.currentRevision??current.current?.revision)!==base.id)
    await model().checkout({revision:base.id,baseRevision:current.currentRevision??current.current?.revision});
  const connectionPath=join(workRoot,'operator','connection.json');
  if(!await exists(connectionPath))await privateFile('operator/connection.json',{
    schema:'stellar-forge.grpc-workspace-connection.v1',workspaces:{health:{consoleUrlFile:join(workRoot,'operator','console-url.txt')}}});
  const configPath=join(workRoot,'operator','merchant-agent','merchant-mcp.json');
  if(!await exists(configPath))await config.initializeGrpcWorkspaceMerchant({directory:join(workRoot,'operator','merchant-agent'),connection:connectionPath});
  merchant=await serve.startMerchantMcp({configPath,port:0,tokenEnv:'GRPC_HEALTH_MCP_TOKEN',environment});
  client=await receiver.openMerchantFileClient({url:merchant.url,tokenEnv:'GRPC_HEALTH_MCP_TOKEN',environment});
  if(mode!=='browser'){
    await step('saved-mtls-check-list-and-original-failures',async()=>{
      const outcomes={};
      for(const [name,request,phase,status] of [
        ['check',{kind:'check',service:'ready.'+result.runId,timeoutMs:5000},'COMPLETED','SERVING'],
        ['unknown',{kind:'check',service:'unknown.'+result.runId,timeoutMs:5000},'COMPLETED','UNKNOWN'],
        ['missing',{kind:'check',service:'missing.'+result.runId,timeoutMs:5000},'FAILED',null],
        ['unsupported',{kind:'check',service:'unsupported.'+result.runId,timeoutMs:5000},'UNSUPPORTED',null],
        ['list',{kind:'list',timeoutMs:5000},'COMPLETED',null],
      ]){
        const first=await startHealth(name,request),read=await finished(first.operation.id);
        assert.equal(read.operation.phase,phase,name);
        if(status)assert.equal(read.operation.reportedStatus,status);
        outcomes[name]={id:read.operation.id,phase:read.operation.phase,reportedStatus:read.operation.reportedStatus,
          terminal:read.operation.terminal};
      }
      const idList=outcomes.list.id;let after=0,through,snapshot,services=[];
      for(;;){
        const page=await healthRead(idList,'services',{afterSequence:after,limit:25,
          ...(through===undefined?{}:{throughSequence:through,expectedSnapshot:snapshot})});
        through??=page.page.throughSequence;snapshot??=page.page.snapshot;services.push(...page.services);
        if(page.page.nextAfterSequence===null)break;after=page.page.nextAfterSequence;
      }
      assert.equal(services.length,129);assert.equal(new Set(services.map(row=>row.service)).size,129);
      assert.equal(services.find(row=>row.service==='unknown').status.name,'UNKNOWN');
      assert.equal(services.find(row=>row.service==='__proto__').status.name,'NOT_SERVING');
      const filtered=await healthRead(idList,'services',{serviceFilter:'merchant.service.12',limit:25});
      assert.equal(filtered.services.length,5);assert.equal(filtered.atomic,false);
      const before=observations.length;
      await mcp('health_observations',{revision:base.id,limit:25});
      const cliResult=await child(process.execPath,[join(sourceRoot,GRPC+'health-cli.mjs'),'open',
        '--console-url-file',join(workRoot,'operator','console-url.txt'),'--id',idList,'--section','services',
        '--filter','merchant.service.12'],{env:environment});
      assert.equal(JSON.parse(cliResult.stdout).services.length,5);assert.equal(observations.length,before);
      return {outcomes,services:services.length,filteredServices:filtered.services.length,mutualTLS:true,
        savedEnvironmentReferences:base.source.transport,readOnlyAdditionalCalls:0};
    });
    await step('native-watch-transition-renewal-and-terminal',async()=>{
      const transition=await startHealth('transition',{kind:'watch',service:'transition.'+result.runId,
        timeoutMs:1000,durationMs:20000,maxEvents:100});
      await until(transition.operation.id,value=>value.operation.reportedStatus==='SERVING');
      await cancelHealth(transition.operation.id);
      const transitionEvents=await allEvents(transition.operation.id);
      const statuses=transitionEvents.filter(event=>event.kind==='native'&&event.data.type==='status').map(event=>event.data.status.name);
      assert.deepEqual(statuses.slice(0,2),['SERVICE_UNKNOWN','SERVING']);
      const quiet=await startHealth('quiet',{kind:'watch',service:'quiet.'+result.runId,
        timeoutMs:150,durationMs:20000,maxEvents:100});
      await until(quiet.operation.id,value=>value.operation.connections>=3&&value.operation.updates>=3);
      await cancelHealth(quiet.operation.id);const quietRead=await finished(quiet.operation.id);
      assert.equal(quietRead.operation.reportedStatus,'SERVING');assert(quietRead.operation.retries>=2);
      const renew=await startHealth('renew',{kind:'watch',service:'renew.'+result.runId,
        timeoutMs:1000,durationMs:20000,maxEvents:100});
      await until(renew.operation.id,value=>value.operation.connections>=2&&value.operation.updates>=2);
      await cancelHealth(renew.operation.id);
      const renewEvents=await allEvents(renew.operation.id);
      assert(renewEvents.some(event=>event.kind==='native'&&event.data.type==='terminal'&&event.data.grpcCode===0));
      const unsupported=await startHealth('watch-unsupported',{kind:'watch',service:'unsupported.'+result.runId,
        timeoutMs:1000,durationMs:5000,maxEvents:100});
      const unavailable=await finished(unsupported.operation.id);
      assert.equal(unavailable.operation.phase,'UNSUPPORTED');assert.equal(unavailable.operation.connections,1);
      const limited=await startHealth('event-limit',{kind:'watch',service:'quiet.limit.'+result.runId,
        timeoutMs:100,durationMs:5000,maxEvents:3});
      const limitedRead=await finished(limited.operation.id);
      assert.equal(limitedRead.operation.outcome.reason,'EVENT_LIMIT_REACHED');assert.equal(limitedRead.operation.nativeEvents,3);
      const duration=await startHealth('duration',{kind:'watch',service:'quiet.duration.'+result.runId,
        timeoutMs:1000,durationMs:500,maxEvents:100});
      const durationRead=await finished(duration.operation.id);
      assert.equal(durationRead.operation.outcome.reason,'DURATION_REACHED');
      assert.equal(durationRead.operation.reportedStatus,'SERVING');
      return {transition:{id:transition.operation.id,statuses},quiet:{id:quiet.operation.id,connections:quietRead.operation.connections,
        retries:quietRead.operation.retries,status:quietRead.operation.reportedStatus},okReconnect:renew.operation.id,
        unsupported:{id:unsupported.operation.id,connections:1},eventLimit:limitedRead.operation.nativeEvents,
        durationOutcome:durationRead.operation.outcome.reason};
    });
    await step('frozen-receiving-live-growth-and-original-resume',async()=>{
      const progress=result.refs.healthReceiving??={stages:{},resumeTargets:{}};
      const mark=async(name,run)=>{
        if(progress.stages[name]?.state==='COMPLETE')return progress.stages[name].value;
        progress.stages[name]??={state:'STARTED',startedAt:now()};await checkpoint();
        const value=await run();progress.stages[name]={state:'COMPLETE',finishedAt:now(),value};await checkpoint();return value;
      };
      let watch=await startHealth('receiving',{kind:'watch',service:'transition.receiving.'+result.runId,
        timeoutMs:500,durationMs:120000,maxEvents:500});
      const operationId=watch.operation.id;
      if(progress.originalDeadline)assert.equal(watch.operation.deadlineAt,progress.originalDeadline);
      else{progress.originalDeadline=watch.operation.deadlineAt;await checkpoint();}
      const resumeWithStatus=async(stage,requiredResume,requireLive=false)=>{
        for(;;){
          let current=await healthRead(operationId);
          if(progress.resumeTargets[stage]===undefined){
            progress.resumeTargets[stage]=current.operation.epochs+(requiredResume||!current.operation.runningHere?1:0);
            await checkpoint();
          }
          const targetEpoch=progress.resumeTargets[stage];
          if(current.operation.epochs<targetEpoch){
            assert(!current.operation.runningHere);
            await mcp('health_resume',{operationId,expectedVersion:current.operation.version});
            current=await healthRead(operationId);
          }
          const events=await allEvents(operationId);let epoch=0;
          const seen=events.some(event=>{
            if(event.kind==='lifecycle'&&event.data.phase==='RUNNING')epoch++;
            return epoch>=targetEpoch&&event.kind==='native'&&event.data.type==='status'&&event.data.status?.name==='SERVING';
          });
          if(seen&&(!requireLive||current.operation.runningHere))return current;
          if(current.operation.runningHere){
            await until(operationId,value=>value.operation.version>current.operation.version||!value.operation.runningHere);
            continue;
          }
          assert(Date.parse(current.operation.deadlineAt)>Date.now(),'The original retained Watch deadline elapsed before the selected continuation.');
          // An owner may end before a resumed Watch produces its first status.
          // Record the next original epoch before explicitly resuming it.
          progress.resumeTargets[stage]=current.operation.epochs+1;await checkpoint();
        }
      };
      const first=await mark('first-prefix-receiving',async()=>{
        if(!progress.exportIntent){
          await resumeWithStatus('capture',false);
          const current=await healthRead(operationId);
          progress.exportIntent={throughSequence:current.operation.version,expectedSnapshot:current.operation.snapshot};
          await checkpoint();
        }
        if(!progress.exportDescriptor){
          progress.exportDescriptor=await mcp('health_export',{operationId,...progress.exportIntent});await checkpoint();
        }
        const exported=progress.exportDescriptor;
        const received=await downloadGrpcHealthExport({client,exportId:exported.exportId,
          expectedManifestSha256:exported.manifestFile.sha256,directory:join(workRoot,'downloads','health-first'),chunkSize:196608});
        const bytes=await readFile(received.healthFile);
        return {snapshotSha256:received.snapshotSha256,fileSha256:hash(bytes),version:received.operation.version};
      });
      await mark('repeat-original-prefix-after-growth',async()=>{
        await until(operationId,value=>value.operation.version>first.version);
        const exported=progress.exportDescriptor;
        const received=await downloadGrpcHealthExport({client,exportId:exported.exportId,
          expectedManifestSha256:exported.manifestFile.sha256,directory:join(workRoot,'downloads','health-first'),chunkSize:196608});
        assert.equal(received.snapshotSha256,first.snapshotSha256);
        assert.equal(hash(await readFile(received.healthFile)),first.fileSha256);
        return {originalExportId:exported.exportId,repeatReceivingExact:true};
      });
      const file=join(workRoot,'downloads','health-cli.json');
      const cliPrefix=await mark('cli-prefix-receiving',async()=>{
        await healthMain(['export','--console-url-file',join(workRoot,'operator','console-url.txt'),
          '--id',operationId,'--out',file],{stdout:{write(){}}});
        return {sha256:hash(await readFile(file))};
      });
      await mark('operator-stop',async()=>{
        let current=await healthRead(operationId);
        if(current.operation.phase!=='CANCELLED'||current.operation.reason!=='operator_cancelled'){
          if(!current.operation.runningHere)current=await resumeWithStatus('first-stop',false,true);
          await cancelHealth(operationId);current=await finished(operationId);
        }
        assert.equal(current.operation.phase,'CANCELLED');assert.equal(current.operation.reason,'operator_cancelled');
        return {epoch:current.operation.epochs,version:current.operation.version};
      });
      await healthMain(['export','--console-url-file',join(workRoot,'operator','console-url.txt'),
        '--id',operationId,'--out',file],{stdout:{write(){}}});
      assert.equal(hash(await readFile(file)),cliPrefix.sha256);
      await mark('resume-before-workspace-close',async()=>{
        const current=await resumeWithStatus('close',true);
        return {epoch:progress.resumeTargets.close,version:current.operation.version};
      });
      const closed=await mark('workspace-close-and-reopen',async()=>{
        let current=await healthRead(operationId);
        if(current.operation.phase!=='INTERRUPTED'||current.operation.reason!=='workspace_closed'){
          // An ended prior owner is a different observed transition. Resume the
          // original UUID inside its remaining budget before the intended close.
          if(!current.operation.runningHere)current=await resumeWithStatus('close-owned',false,true);
          await workspace.close();workspace=null;await openWorkspace();current=await healthRead(operationId);
        }
        assert.equal(current.operation.phase,'INTERRUPTED');assert.equal(current.operation.reason,'workspace_closed');
        assert.equal(current.operation.deadlineAt,progress.originalDeadline);
        return {epoch:current.operation.epochs,version:current.operation.version,reason:current.operation.reason};
      });
      await mark('resume-after-workspace-reopen',async()=>{
        const current=await resumeWithStatus('final',true);
        return {epoch:progress.resumeTargets.final,version:current.operation.version};
      });
      const stopped=await mark('final-original-stop',async()=>{
        let current=await healthRead(operationId);
        if(current.operation.phase!=='CANCELLED'||current.operation.reason!=='operator_cancelled'){
          if(!current.operation.runningHere)current=await resumeWithStatus('final-stop',false,true);
          await cancelHealth(operationId);current=await finished(operationId);
        }
        assert.equal(current.operation.phase,'CANCELLED');assert.equal(current.operation.reason,'operator_cancelled');
        assert.equal(current.operation.deadlineAt,progress.originalDeadline);
        return {epoch:current.operation.epochs,version:current.operation.version};
      });
      const inspect=await healthMain(['inspect','--file',file,'--section','summary'],{stdout:{write(){}}});
      assert.equal(inspect.operation.id,operationId);
      return {operationId,originalDeadline:progress.originalDeadline,epochs:stopped.epoch,workspaceClosedEpoch:closed.epoch,
        prefixSnapshotSha256:first.snapshotSha256,prefixFileSha256:first.fileSha256,cliPrefixSha256:cliPrefix.sha256,
        originalExportId:progress.exportDescriptor.exportId,liveGrowthPreserved:true,repeatReceivingExact:true};
    });
    await step('durable-unary-control-and-publication-window-recovery',async()=>{
      const {createGrpcHealthWorkspace}=await load(GRPC+'workspace/health.mjs');
      const {acquireStateLease}=await load(PREFIX+'merchant-fleet-gateway/state-lease.mjs');
      const cases=[
        ['successful-status',id('health-check'),event=>event.kind==='native'&&event.data.type==='status','COMPLETED','COMPLETED'],
        ['not-found-terminal',id('health-missing'),event=>event.kind==='native'&&event.data.type==='terminal','FAILED','NATIVE_ERROR'],
        ['unsupported-terminal',id('health-unsupported'),event=>event.kind==='native'&&event.data.type==='terminal','UNSUPPORTED','UNIMPLEMENTED'],
        ['stop-before-terminal',id('health-transition'),event=>event.kind==='control'&&event.data.action==='stop','CANCELLED','operator_cancelled'],
        ['close-before-terminal',id('health-receiving'),event=>event.kind==='control'&&event.data.action==='workspace_close','INTERRUPTED','workspace_closed'],
        ['resumed-owner-ended',id('health-receiving'),event=>event.kind==='lifecycle'&&event.data.reason==='operator_resumed','INTERRUPTED','previous_workspace_owner_ended'],
        ['stop-before-native-registration',id('health-check'),event=>event.kind==='lifecycle'&&event.data.phase==='RUNNING','INTERRUPTED','previous_workspace_owner_ended'],
      ];
      const before=observations.length,answers=[];
      for(const [name,operationId,at,phase,reason] of cases){
        const original=await model().healthExport({id:operationId});
        const through=original.events.findIndex(at)+1;assert(through>0,name);
        const directory=join(workRoot,'operator','recovery',name);
        await mkdir(directory,{recursive:true,mode:0o700});
        await retainOriginal(join(directory,'original-snapshot.json'),Buffer.from(pretty(original)));
        const nativeDirectory=join(directory,'health'),root=join(nativeDirectory,operationId);
        await mkdir(root,{recursive:true,mode:0o700});
        if(!await exists(join(root,'operation.json')))await save(join(root,'operation.json'),original.operation);
        if(!await exists(join(root,'events.ndjson')))await save(join(root,'events.ndjson'),
          Buffer.from(original.events.slice(0,through).map(event=>JSON.stringify(event)+'\n').join('')));
        const lease=await acquireStateLease(directory);
        const retained=createGrpcHealthWorkspace({directory:nativeDirectory,loadRevision:async revision=>{
          assert.equal(revision,base.id);return base;},selection:()=>({revision:base.id}),assertHeld:()=>lease.assertHeld(),env:environment});
        try{
          if(name==='stop-before-native-registration'&&!await exists(join(directory,'case.json')))
            await assert.rejects(()=>retained.cancel({id:operationId}),issue=>issue.code==='GRPC_HEALTH_START_IN_PROGRESS'&&issue.status===409);
          await retained.initialize();
          const read=await retained.read({id:operationId,section:'summary'});
          assert.equal(read.operation.phase,phase,name);assert.equal(read.operation.reason,reason,name);
          assert.equal(read.operation.nativeEvents,original.events.slice(0,through).filter(event=>event.kind==='native').length);
          const value={name,operationId,originalSnapshotSha256:original.snapshotSha256,through,
            phase:read.operation.phase,reason:read.operation.reason,nativeEvents:read.operation.nativeEvents};
          await save(join(directory,'case.json'),value);answers.push(value);
        }finally{await retained.close();await lease.close();}
      }
      assert.equal(observations.length,before);
      return {cases:answers,additionalNativeCalls:0};
    });
    await step('native-event-sink-failure-closes-owned-watch',async()=>{
      const sinkPath=join(workRoot,'operator','failed-sink.json');
      const resultPath=join(workRoot,'operator','failed-sink-result.json');
      if(await exists(resultPath))return json(resultPath);
      const marker=Object.assign(new Error('ORIGINAL_HEALTH_EVENT_SINK_FAILURE'),{code:'ORIGINAL_HEALTH_EVENT_SINK_FAILURE'});
      await assert.rejects(()=>observeGrpcHealth(source,{kind:'watch',service:'quiet.sink.'+result.runId,
        timeoutMs:1000,durationMs:5000,maxEvents:100},{env:environment,onEvent:async event=>{
          if(event.type==='status'){await save(sinkPath,{operation:OPERATION,runId:result.runId,event});throw marker;}
        }}),issue=>issue===marker);
      const deadline=Date.now()+5000;
      while(upstream.counts().activeWatches&&Date.now()<deadline)await pause(10);
      assert.equal(upstream.counts().activeWatches,0);
      const value={savedStatusSha256:hash(await readFile(sinkPath)),ownedWatchClosed:true};
      await save(resultPath,value);return value;
    });
    await step('original-merchant-call-customer-client-and-release',async()=>{
      const operationId=id('merchant-summary');await checkpoint();
      let attempt=await model().readAttempt({id:operationId});
      if(!attempt){
        assert.equal(observed('Summary').length,0,'Reopen an observed original merchant attempt before any new call.');
        attempt=await full(await mcp('call',{revision:base.id,operationId,method:SUMMARY,
          input:base.plan.routes[0].example}),'original-summary');
      }
      assert.equal(attempt.phase,'COMPLETED');
      const review=await full(await mcp('review',{revision:base.id}),'merchant-review');
      assert(Array.isArray(review.health)&&review.health.length>0);
      const preparation=id('preparation-base');await checkpoint();
      await mcp('prepare',{revision:base.id,operationId:preparation});
      const exported=await mcp('export',{kind:'customer',preparation});
      const options={client,exportId:exported.exportId,expectedManifestSha256:exported.manifestFile.sha256,
        directory:join(workRoot,'downloads','customer-base'),chunkSize:196608};
      const received=await downloadGrpcExport(options),again=await downloadGrpcExport(options);
      assert.equal(received.exportId,again.exportId);assert.equal(received.nativeFiles.length,7);
      const sdk=await import(pathToFileURL(join(received.customerDirectory,'seller-client.mjs')).href);
      const route=base.plan.routes[0],request=sdk.buildRequest(route.id,{body:route.example},
        {intentId:id('sdk-intent'),maxAtomic:'25000'});
      const before=observed('Summary').length,runtime=await mcp('run',{preparation});
      const response=await fetch(new URL(runtime.active.url).origin+new URL(request.url).pathname,{
        method:request.method,headers:request.headers,body:request.body,redirect:'error',signal:AbortSignal.timeout(10000)});
      await response.arrayBuffer();assert.equal(response.status,402);await mcp('stop');
      assert.equal(observed('Summary').length,before);
      const release='health-original';
      await mcp('stage',{preparation,releaseId:release});
      // A second retained release of the same reviewed merchant exercises the
      // real receiving/activation/rollback boundary without changing its terms.
      await mcp('stage',{preparation,releaseId:'health-reviewed'});
      const {readReleaseState}=await load(PREFIX+'sf82-seller-pilot/releases.mjs');
      const store=join(workRoot,'workspace','merchant-releases');await mcp('release_open');
      let selected=await readReleaseState(store);
      if(selected.active!==release){
        await mcp('release_activate',{id:release,expectedGeneration:selected.generation,reason:'Original merchant with retained health'});
        selected=await readReleaseState(store);
      }
      await mcp('release_activate',{id:'health-reviewed',expectedGeneration:selected.generation,reason:'Receive the reviewed native merchant'});
      selected=await readReleaseState(store);
      await mcp('release_rollback',{expectedGeneration:selected.generation,reason:'Return to original merchant release'});
      selected=await readReleaseState(store);assert.equal(selected.active,release);await mcp('release_close');
      return {operationId,responseSha256:attempt.responseSha256,preparation,customerFiles:received.nativeFiles,
        SDKRequest:true,previewStatus:402,reviewedHealth:review.health.length,releaseGeneration:selected.generation,active:selected.active};
    });
    result.coreComplete=true;await checkpoint();
  }
  if(mode!=='core')await step('industrial-health-editor-and-mobile-receiving',async()=>{
    const playwright=await import(pathToFileURL(join(playwrightPath,'index.mjs')).href);
    browser=await playwright.chromium.launch({executablePath:chrome,headless:true,
      args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu'],env:{...environment,TMPDIR:join(workRoot,'captures')}});
    context=await browser.newContext({viewport:{width:1440,height:1050},acceptDownloads:true});
    const page=await context.newPage(),pageErrors=[];page.on('pageerror',issue=>pageErrors.push(issue.message));
    let pending;
    for(const kind of ['list','watch']){
      const operationId=result.refs['browser-'+kind];
      if(!operationId)continue;
      try{await model().healthRead({id:operationId,section:'summary'});}
      catch(issue){
        if(issue.code!=='ENOENT')throw issue;
        const input=result.refs['browser-input-'+kind];assert(input);
        assert(!pending,'Keep one original unpublished browser intent.');
        pending={id:operationId,key:JSON.stringify(input),input};
      }
    }
    if(pending)await page.addInitScript(value=>{
      sessionStorage.setItem('stellar-forge.grpc-workspace:'+location.origin+':health-pending',JSON.stringify(value));
    },pending);
    await page.route('**/api/health-start',async route=>{
      const body=route.request().postDataJSON(),kind=body.request.kind,key='browser-'+kind;
      if(result.refs[key])assert.equal(body.id,result.refs[key],'Resume the original browser operation ID.');
      result.refs[key]=body.id;result.refs['browser-input-'+kind]={revision:body.revision,request:body.request};
      await checkpoint();await route.continue();
    });
    const openBrowser=async kind=>{
      const operationId=result.refs['browser-'+kind];
      let existsHere=false;
      if(operationId)try{await model().healthRead({id:operationId,section:'summary'});existsHere=true;}
      catch(issue){if(issue.code!=='ENOENT')throw issue;}
      if(existsHere){
        await page.locator('#health-history-refresh').click();
        await page.locator('#health-history [data-operation-id="'+operationId+'"] button').click();
      }else await page.locator('#health-start').click();
    };
    page.on('dialog',dialog=>dialog.accept());await page.goto(workspace.url,{waitUntil:'networkidle'});
    await page.locator('[data-view="health"]').click();
    await page.locator('#health-kind').selectOption('list');
    await openBrowser('list');
    await page.waitForFunction(()=>document.querySelector('#health-services-page')?.textContent.includes('129'));
    assert.equal(await page.locator('#health-services tr').count(),50);
    await page.locator('#health-services-next').click();assert.equal(await page.locator('#health-services tr').count(),50);
    await page.locator('#health-service-filter').fill('merchant.service.12');await page.locator('#health-service-filter').press('Tab');
    await page.waitForFunction(()=>document.querySelectorAll('#health-services tr').length===5);
    await page.locator('#health-kind').selectOption('watch');
    await page.locator('#health-service').fill('transition.browser.'+result.runId);
    await page.locator('#health-timeout').fill('1000');await page.locator('#health-duration').fill('120000');
    await openBrowser('watch');
    const browserId=result.refs['browser-watch'];assert(browserId);
    await page.waitForFunction(()=>document.querySelector('#health-summary')?.textContent.includes('SERVING'));
    let browserState=await healthRead(browserId);
    if(browserState.operation.runningHere){
      await page.locator('#health-stop').click();
      await page.waitForFunction(()=>document.querySelector('#health-summary')?.textContent.includes('CANCELLED'));
      browserState=await healthRead(browserId);
    }
    if(browserState.operation.epochs<2){
      await page.locator('#health-resume').click();
      await page.waitForFunction(()=>!document.querySelector('#health-stop')?.disabled);
      await page.locator('#health-stop').click();
      await page.waitForFunction(()=>document.querySelector('#health-summary')?.textContent.includes('CANCELLED'));
    }
    const promised=page.waitForEvent('download');await page.locator('#health-export').click();
    const downloaded=await promised;const downloadPath=join(workRoot,'captures','browser-health.json');await downloaded.saveAs(downloadPath);
    const {parseGrpcHealthSnapshot}=await load(GRPC+'health-record.mjs');
    const snapshot=parseGrpcHealthSnapshot(await readFile(downloadPath));
    assert.equal(snapshot.operation.request.service,'transition.browser.'+result.runId);assert.equal(snapshot.summary.epochs,2);
    await page.screenshot({path:join(workRoot,'captures','health-editor-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    await page.screenshot({path:join(workRoot,'captures','health-editor-mobile.png'),fullPage:true});
    const dimensions=await page.evaluate(()=>({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
    assert(dimensions.scroll<=dimensions.width+1);assert.deepEqual(pageErrors,[]);
    await context.close();context=null;await browser.close();browser=null;
    return {operationId:snapshot.operation.id,epochs:snapshot.summary.epochs,snapshotSha256:snapshot.snapshotSha256,
      services:129,filteredServices:5,desktop:[1440,1050],mobile:[390,844],pageErrors};
  });
  client=null;
  await merchant.close();merchant=null;session.closed.merchant=true;
  await workspace.close();workspace=null;session.closed.workspace=true;
  await step('original-offline-reopen-and-portable-history',async()=>{
    const state=await createGrpcWorkspace({stateDirectory:join(workRoot,'workspace'),env:environment});
    try{
      const list=await state.healthList({revision:base.id,limit:50});assert(list.total>=12);
      const returned=await state.healthRead({id:id('health-check'),section:'summary'});
      assert.equal(returned.operation.phase,'COMPLETED');
      const portable=await healthMain(['inspect','--file',join(workRoot,'downloads','health-cli.json'),'--section','events','--limit','25'],{stdout:{write(){}}});
      const bytes=await readFile(join(workRoot,'downloads','health-first','grpc-health.json'));
      const {parseGrpcHealthSnapshot}=await load(GRPC+'health-record.mjs');const snapshot=parseGrpcHealthSnapshot(bytes);
      return {operations:list.total,originalCheck:returned.operation.id,prefixSnapshotSha256:snapshot.snapshotSha256,
        offlineInspection:true};
    }finally{await state.close();}
  });
  await observationWrite;session.counts=upstream.counts();await upstream.close();session.closed.upstream=true;
  assert.equal(upstream.counts().activeWatches,0);assert.equal(observed('Summary').length,1);
  result.nativeCalls={health:observations.filter(row=>row.method!=='Summary').length,merchant:observed('Summary').length,
    journalSha256:hash(await readFile(observationsPath))};
  result.state=result.phases['industrial-health-editor-and-mobile-receiving']?.state==='COMPLETE'?'COMPLETE':'CORE_COMPLETE_BROWSER_PENDING';
  result.finishedAt=now();
}catch(issue){
  error=issue;result.state='INTERRUPTED';
  const redact=value=>Object.values(environment).filter(value=>typeof value==='string'&&value.length>20)
    .reduce((text,secret)=>text.split(secret).join('<private>'),String(value)).replace(/#[a-f0-9]{64}/g,'#<private>');
  result.error={code:issue.code??issue.name,message:redact(issue.message),stack:redact(issue.stack??'').slice(0,10000)};
}finally{
  for(const [name,get] of [['browser',()=>browser],['merchant',()=>merchant],['workspace',()=>workspace],['upstream',()=>upstream]]){
    const resource=get();if(!resource)continue;
    try{if(name==='upstream')session.counts=resource.counts();await resource.close();session.closed[name]=true;}
    catch(issue){session.closed[name]=false;result.closeErrors??=[];result.closeErrors.push({name,code:issue.code??issue.message});error??=issue;}
  }
  session.finishedAt=now();if(error&&result.state==='COMPLETE')result.state='INTERRUPTED';await checkpoint();
  try{
    const receipt=await originalCheckpoint(result.state==='COMPLETE'?'health-complete':'health-continuation');
    if(receipt){result.nativeCheckpoint=receipt;await privateFile('checkpoint-receipt.json',receipt);await checkpoint();}
  }catch(issue){result.checkpointError={code:issue.code??issue.message};result.state='INTERRUPTED';error??=issue;await checkpoint();}
}
console.log(JSON.stringify({operation:OPERATION,runId:result.runId,state:result.state,source:result.source,
  nativeCalls:result.nativeCalls,phases:Object.fromEntries(Object.entries(result.phases).map(([name,value])=>[name,value.state])),
  closed:session.closed,error:result.error,checkpoint:result.nativeCheckpoint?.state}));
if(error)process.exitCode=1;
