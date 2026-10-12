// MIT. Complete original Redis -> Valkey application receiving on two owned native engines.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createServer as tcpServer, createConnection } from 'node:net';
import { spawn } from 'node:child_process';
import { createReadStream, constants } from 'node:fs';
import { access, chmod, copyFile, lstat, mkdir, open, readFile, realpath, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { createClient } from '@redis/client';
import { redisCutoverTemplate, receiveRedisCutover, compareRedisCutoverRows } from './cutover.mjs';
import { openRedisAuthoringWorkspace } from './model.mjs';
import { runCustomerExport, inspectCustomerExport } from './customer-export.mjs';
import { inspectSellerClientExport } from '../../developer/client-export.mjs';
import { X402BuyerClient } from '../../../sf31-buyer-client/buyer.mjs';
import { prepareBuyerResponseFile } from '../../../sf31-buyer-client/response-file.mjs';
import { startReleaseConsole } from '../../../sf82-seller-pilot/release-console.mjs';

const SCHEMA='stellar-forge.redis-valkey-native-cutover.v1';
const require=createRequire(import.meta.url);
const encode=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const clone=value=>structuredClone(value);
const binary=Buffer.from([255,0,239,187,191]);
const scalar=value=>Buffer.isBuffer(value)?{base64:value.toString('base64')}:value;
const listValues=['9007199254740993',binary,'repeated','repeated','','λ'];
const setValues=['9007199254740993',binary,'',...Array.from({length:129},(_,i)=>'member-'+i)];
const rows={
  availability:[{availability:scalar(binary)}],
  catalog:[{itemId:'SKU-001',title:'Bearing',priceAtomic:'9007199254740993'}],
  leaderboard:[{itemId:'first',score:'1.25'},{itemId:'second',score:'2.5'},{itemId:'third',score:'3.75'}],
  events:[{id:'1-0',eventType:'updated',itemId:'SKU-001',quantity:'3'},
    {id:'2-0',eventType:'sold',itemId:'SKU-002',quantity:null},
    {id:'3-0',eventType:'restocked',itemId:'SKU-003',quantity:'7'}],
  list_feed:listValues.map((value,i)=>({index:String(i),value:scalar(value)})),
  member_catalog:setValues.map(member=>({member:scalar(member)})),
};
const columns={availability:['availability'],catalog:['itemId','title','priceAtomic'],
  leaderboard:['itemId','score'],events:['id','eventType','itemId','quantity'],
  list_feed:['index','value'],member_catalog:['member']};
const envNames={baseline:'SF30_CUTOVER_BASELINE_PASSWORD',candidate:'SF30_CUTOVER_CANDIDATE_PASSWORD'};
const errorView=error=>({code:error.code??'NATIVE_CUTOVER_FAILED',message:error.message});
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function check(condition,message){if(!condition)throw new Error(message);}
async function save(path,value){await writeFile(path,encode(value),{mode:0o600});}
async function fileIdentity(path){
  const hash=createHash('sha256');let bytes=0;
  for await(const part of createReadStream(path)){bytes+=part.length;hash.update(part);}
  return {path,bytes,sha256:hash.digest('hex')};
}
async function executable(value){
  check(typeof value==='string'&&value&&!/[\0\r\n]/.test(value),'Choose the actual installed engine executable.');
  const candidates=isAbsolute(value)?[value]:(process.env.PATH??'').split(':').filter(Boolean).map(path=>join(path,value));
  for(const path of candidates)try{await access(path,constants.X_OK);return realpath(path);}catch(error){if(!['ENOENT','EACCES'].includes(error.code))throw error;}
  throw new Error('Native executable is unavailable: '+value);
}
async function freePort(){
  const server=tcpServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  const port=server.address().port;await new Promise((yes,no)=>server.close(error=>error?no(error):yes()));return port;
}
async function tcpReady(port,process,spawnError){
  const deadline=Date.now()+10000;
  while(Date.now()<deadline){
    if(spawnError?.())throw spawnError();
    if(process.exitCode!==null||process.signalCode!==null)throw new Error('Owned native engine exited during startup.');
    const ready=await new Promise(resolve=>{
      const socket=createConnection({host:'127.0.0.1',port});let done=false;
      const finish=value=>{if(done)return;done=true;socket.destroy();resolve(value);};
      socket.setTimeout(250);socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));socket.once('timeout',()=>finish(false));
    });
    if(ready)return;await delay(30);
  }
  throw new Error('Owned native engine did not open its configured loopback port.');
}
async function stopEngine(engine){
  if(!engine||engine.closed)return engine?.closure??null;
  if(engine.client?.isOpen)engine.client.destroy();
  const child=engine.process;
  if(child?.pid&&child.exitCode===null&&child.signalCode===null){
    child.kill('SIGTERM');let deadline=Date.now()+8000;
    while(child.exitCode===null&&child.signalCode===null&&Date.now()<deadline)await delay(25);
    if(child.exitCode===null&&child.signalCode===null){
      child.kill('SIGKILL');deadline=Date.now()+3000;
      while(child.exitCode===null&&child.signalCode===null&&Date.now()<deadline)await delay(25);
    }
    check(child.exitCode!==null||child.signalCode!==null,'Join the original owned native process before completing.');
  }
  await rm(engine.configuration,{force:true});
  engine.closed=true;
  return engine.closure={pid:child?.pid??null,exitCode:child?.exitCode??null,signal:child?.signalCode??null,closed:true};
}
async function startEngine({directory,binary,port,adminPassword,rdb}){
  await mkdir(directory,{mode:0o700});await chmod(directory,0o700);
  if(rdb)await copyFile(rdb,join(directory,'dump.rdb'));
  const configuration=join(directory,'server.conf');
  await writeFile(configuration,[
    'bind 127.0.0.1','port '+port,'protected-mode yes','daemonize no','save ""','appendonly no',
    'databases 4','maxmemory 64mb','maxmemory-policy noeviction','dir '+JSON.stringify(directory),
    'dbfilename dump.rdb','requirepass '+JSON.stringify(adminPassword),'logfile ""',
  ].join('\n')+'\n',{mode:0o600});
  const output=await open(join(directory,'engine.log'),'wx',0o600);
  let child;
  try{child=spawn(binary,[configuration],{stdio:['ignore',output.fd,output.fd]});}
  finally{await output.close();}
  const engine={directory,binary,configuration,process:child,port,client:null,closed:false};
  let spawnError;child.on('error',error=>{spawnError=error;});
  try{
    await tcpReady(port,child,()=>spawnError);if(spawnError)throw spawnError;
    const client=createClient({username:'default',password:adminPassword,database:2,disableClientInfo:true,
      socket:{host:'127.0.0.1',port,connectTimeout:3000,reconnectStrategy:false}});
    client.on('error',()=>{});engine.client=client;await client.connect();
    const raw=await client.sendCommand(['INFO','server']);
    const info=Object.fromEntries(String(raw).split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{
      const index=line.indexOf(':');return [line.slice(0,index),line.slice(index+1)];
    }));
    engine.identity={...await fileIdentity(binary),port,database:2,
      serverName:info.server_name??'redis',redisCompatibilityVersion:info.redis_version??null,
      valkeyVersion:info.valkey_version??null,processId:info.process_id??null};
    await save(join(directory,'identity.json'),engine.identity);
    await writeFile(join(directory,'server-info.txt'),raw,{mode:0o600});
    return engine;
  }catch(error){await stopEngine(engine).catch(()=>{});throw error;}
}
async function reader(engine,password){
  await engine.client.sendCommand(['ACL','SETUSER','cutover_reader','reset','on','>'+password,'~merchant:*',
    '+ping','+eval_ro','+strlen','+get','+hstrlen','+hmget','+zrange','+xrange','+lrange','+llen','+sscan','+select']);
}
async function seed(database){
  await database.sendCommand(['SET','merchant:availability:catalog',binary]);
  await database.sendCommand(['HSET','merchant:catalog:north','product_id','SKU-001','name','Bearing','price_atomic','9007199254740993']);
  await database.sendCommand(['ZADD','merchant:rankings:daily','1.25','first','2.5','second','3.75','third']);
  await database.sendCommand(['XADD','merchant:events','1-0','event_type','created','event_type','updated','product_id','SKU-001','quantity','3']);
  await database.sendCommand(['XADD','merchant:events','2-0','event_type','sold','product_id','SKU-002']);
  await database.sendCommand(['XADD','merchant:events','3-0','event_type','restocked','product_id','SKU-003','quantity','7']);
  await database.sendCommand(['RPUSH','merchant:collections:queue',...listValues]);
  await database.sendCommand(['SADD','merchant:collections:members',...setValues]);
  assert.equal(await database.dbSize(),6);
}
async function changeCandidate(database,corrected){
  await database.sendCommand(['HSET','merchant:catalog:north','price_atomic',corrected?'9007199254740993':'9007199254740995']);
  await database.sendCommand(['LSET','merchant:collections:queue','3',corrected?'repeated':'candidate-changed-duplicate']);
  await database.sendCommand(['SREM','merchant:collections:members',corrected?'candidate-extra-member':'member-7']);
  await database.sendCommand(['SADD','merchant:collections:members',corrected?'member-7':'candidate-extra-member']);
}
async function localFacilitator(){
  const counts={verified:0,settled:0};
  const server=createServer(async(request,response)=>{
    try{
      let total=0;for await(const chunk of request){total+=chunk.length;if(total>1048576)throw new Error('Fixture request exceeds its input limit.');}
      let result;
      if(request.url==='/supported')result={kinds:[{x402Version:2,scheme:'exact',network:'stellar:testnet'}]};
      else if(request.url==='/verify'){counts.verified++;result={isValid:true,payer:'local-native-cutover-buyer'};}
      else if(request.url==='/settle'){counts.settled++;result={success:true,transaction:counts.settled.toString(16).padStart(64,'0'),network:'stellar:testnet'};}
      else{response.writeHead(404);response.end();return;}
      response.writeHead(200,{'content-type':'application/json'});response.end(JSON.stringify(result));
    }catch{response.writeHead(400);response.end();}
  });
  await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',yes);});
  return {runtime:{port:0,allowLocalFacilitator:true,facilitator:'http://127.0.0.1:'+server.address().port},
    counts,close:()=>new Promise((yes,no)=>{server.closeIdleConnections();server.close(error=>error?no(error):yes());})};
}
async function selectedInput({operationId,engines,migration,runtime}){
  const input=await redisCutoverTemplate();input.operationId=operationId;
  input.consistency={mode:'immutable-edition',reference:'Original owned Redis SAVE snapshot SHA256 '+migration.sha256,
    approvedBy:'Original native Redis and Valkey receiving operator'};
  input.release={releaseId:'valkey-candidate',label:'Received native Valkey application',runtime};
  for(const side of ['baseline','candidate']){
    const value=input[side];value.operationId=operationId+'-'+side;value.requestId=operationId+'-'+side+'-create';
    value.setup.label='Original native '+(side==='baseline'?'Redis':'Valkey')+' application';
    value.setup.source.connection={topology:'standalone',host:'127.0.0.1',port:engines[side].port,database:2,
      username:'cutover_reader',passwordEnv:envNames[side],tls:'local-plaintext'};
    value.setup.source.maxConnections=2;value.setup.source.maxPending=8;
    value.setup.source.connectTimeoutMs=3000;value.setup.source.startupTimeoutMs=5000;
    value.setup.plan.publicOrigin='https://native-cutover.customer.example';
    const queries=value.setup.source.queries;
    queries.leaderboard.maxRows=2;queries.events.maxRows=2;queries.list_feed.maxRows=2;
    queries.member_catalog.scanCount=1;queries.member_catalog.maxRows=1000;
    for(const check of value.checks){
      check.allPages=['sorted-set','stream','list','set'].includes(queries[check.query].kind);
      check.maxPages=1000;check.maxRows=10000;
      check.expected=check.query==='member_catalog'
        ?{columns:columns[check.query],requiredRows:rows[check.query]}
        :{columns:columns[check.query],rows:rows[check.query],rowCount:rows[check.query].length};
    }
  }
  return input;
}
async function report(root,side){return JSON.parse(await readFile(join(root,side+'-receiving.json'),'utf8'));}
async function originals(root,side,environment){
  const received=await report(root,side),workspace=await openRedisAuthoringWorkspace(join(root,side),{environment,
    expectedWorkspaceId:received.workspace.workspaceId,expectedProfileSha256:received.workspace.profileSha256});
  try{
    const products={};
    for(const check of received.checks){
      const pages=check.pages.map(page=>{
        const operation=workspace.operation(page.requestId);
        assert.equal(operation.status,'COMPLETED');assert.equal(operation.kind,'preview');
        return {id:operation.id,input:operation.input.input,data:operation.result.data};
      });
      products[check.query]={columns:pages[0].data.columns,rows:pages.flatMap(page=>page.data.rows),pages};
    }
    const operationIds=[];let after='';
    do{const page=workspace.page('operations',{after,limit:100});operationIds.push(...page.items.map(value=>value.id));after=page.nextCursor;}while(after);
    return {received,products,operationIds};
  }finally{await workspace.close();}
}
async function customer(root,side,input,environment){
  const received=await report(root,side),workspaceRoot=join(root,side);
  const releaseId=side==='candidate'?input.release.releaseId:'redis-baseline';
  if(side==='baseline'){
    const workspace=await openRedisAuthoringWorkspace(workspaceRoot,{environment,
      expectedWorkspaceId:received.workspace.workspaceId,expectedProfileSha256:received.workspace.profileSha256});
    try{
      let stage=await workspace.stage({requestId:'native-valkey-baseline-customer-stage',packageId:received.package.requestId,
        releaseId,label:'Original received Redis application',runtime:input.release.runtime});
      if(stage.status==='INTERRUPTED')stage=await workspace.resume(stage.id);
      assert.equal(stage.status,'COMPLETED');
    }finally{await workspace.close();}
  }
  const releaseRoot=join(workspaceRoot,'releases');
  const operator=await startReleaseConsole(releaseRoot,{port:0,env:environment});let running;
  const call=async(path,value)=>{
    const response=await fetch(operator.url+path,{method:'POST',headers:{'x-release-token':operator.token,
      origin:operator.url,'content-type':'application/json'},body:JSON.stringify(value)});
    const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body;
  };
  try{
    await call('/api/activate',{id:releaseId,expectedGeneration:0,reason:'Original paired native application receiving'});
    running=await call('/api/run',{expectedGeneration:1});
    const clientDirectory=join(releaseRoot,'releases',releaseId,'redis','package','client');
    const inspected=await inspectSellerClientExport({directory:clientDirectory});assert.equal(inspected.state,'COMPLETE');
    const generated=await import(pathToFileURL(join(clientDirectory,'seller-client.mjs')));
    const buyer=new X402BuyerClient({fetchImpl:(url,options)=>{
      const target=new URL(url);return fetch(running.runtime.observed.listener+target.pathname+target.search,options);
    }});
    const selected=input[side];
    const plan={schema:'tjlabs.redis-customer-export.v1',operationId:'native-cutover-'+side+'-customer',
      budget:{maxCalls:1000,maxAtomic:'10000000'},response:{maxBytes:1048576,timeoutMs:30000},
      products:selected.setup.plan.routes.map(route=>({id:route.id,query:route.query,
        kind:selected.setup.source.queries[route.query].kind,input:clone(route.example??{}),
        maxAtomic:'10000',acceptIndex:0,paymentFlow:'authorization'}))};
    const directory=join(root,side+'-customer-responses');
    const delivered=await runCustomerExport({generated,clientManifest:inspected.manifest,buyer,
      approve:()=>true,sign:async({challenge,accepted})=>({x402Version:2,resource:challenge.resource,
        accepted,extensions:challenge.extensions,payload:{nativeRedisValkeyJourney:'LOCAL_PROTOCOL'}}),
      prepareBuyerResponseFile,plan,directory});
    assert.equal(delivered.status,'COMPLETE');assert.equal(delivered.products.length,6);
    const reopened=await inspectCustomerExport({directory});assert.equal(reopened.status,'COMPLETE');
    assert.equal(reopened.calls.length,delivered.calls.length);
    const data={};
    for(const product of delivered.products){
      const files=delivered.calls.filter(call=>call.product===product.id).map(call=>call.file);
      check(files.length>0,'Retain each actual customer product response.');
      const pages=await Promise.all(files.map(file=>readFile(join(directory,file.name)).then(bytes=>JSON.parse(bytes))));
      data[product.query]={columns:pages[0].columns,rows:pages.flatMap(page=>page.rows),
        pages:files.map((file,i)=>({file,input:delivered.calls.filter(call=>call.product===product.id)[i].input,
          nextInput:pages[i].nextInput??null,rows:pages[i].rowCount,scanCursor:pages[i].scanCursor??null}))};
    }
    await call('/api/stop',{instanceId:running.console.instanceId});running=null;
    return {directory,releaseId,source:delivered.source,budget:delivered.budget,
      files:delivered.calls.map(call=>call.file),products:delivered.products,data};
  }finally{
    if(running)await call('/api/stop',{instanceId:running.console.instanceId}).catch(()=>{});
    await operator.close();
  }
}
async function coldReceiving(root,input,environment){
  const compared=await receiveRedisCutover({input,directory:join(root,'corrected'),environment,mode:'compare'});
  assert.equal(compared.status,'RECEIVED');
  const mismatchInput=JSON.parse(await readFile(join(root,'mismatch-input.json'),'utf8'));
  const earlier=await receiveRedisCutover({input:mismatchInput,directory:join(root,'mismatch'),environment,mode:'compare'});
  assert.equal(earlier.status,'CONTRACT_MISMATCH');
  const customers={};
  for(const side of ['baseline','candidate']){
    const received=await inspectCustomerExport({directory:join(root,'corrected',side+'-customer-responses')});
    assert.equal(received.status,'COMPLETE');customers[side]={calls:received.calls.length,source:received.source,planSha256:received.planSha256};
  }
  return {status:'RECEIVED',compared:compared.comparisons,packages:compared.packages,
    workspaceBindings:compared.workspaceBindings,release:compared.release,
    earlierMismatch:earlier.comparisons.filter(value=>!value.matched||!value.expectationsMatch).map(value=>value.checkId),
    customers};
}
export async function inspectRedisValkeyCutoverJourney({directory}={}){
  const root=await realpath(resolve(directory));
  const initial=JSON.parse(await readFile(join(root,'native-cutover.json'),'utf8'));
  check(initial.schema===SCHEMA&&initial.result==='PASS','Choose the complete original native receiving directory.');
  const input=JSON.parse(await readFile(join(root,'corrected-input.json'),'utf8'));
  const received=await coldReceiving(root,input,process.env);
  return {schema:SCHEMA,result:'PASS',directory:root,engineIdentities:initial.engineIdentities,
    migration:initial.migration,receiving:received,closure:initial.closure};
}
export async function runRedisValkeyCutoverJourney({directory,redisServer=process.env.REDIS_SERVER??'redis-server',
  valkeyServer=process.env.VALKEY_SERVER??'valkey-server',onProgress=()=>{}}={}){
  check(typeof directory==='string'&&directory,'Choose a new private native receiving directory.');
  const root=resolve(directory);await mkdir(root,{mode:0o700});await chmod(root,0o700);
  const st=await lstat(root);check(st.isDirectory()&&!st.isSymbolicLink(),'Use an original regular native work directory.');
  const clientPackage=JSON.parse(await readFile(require.resolve('@redis/client/package.json'),'utf8'));
  assert.equal(clientPackage.version,'6.2.1','Use the maintained native Redis client edition.');
  const binaries={baseline:await executable(redisServer),candidate:await executable(valkeyServer)};
  check(binaries.baseline!==binaries.candidate,'Select two actual Redis and Valkey engine executables.');
  const environment={...process.env,[envNames.baseline]:randomBytes(24).toString('hex'),
    [envNames.candidate]:randomBytes(24).toString('hex')};
  const engines={},closure={};let facilitator;const phases=[];
  const phase=async(name,detail={})=>{phases.push({name,at:new Date().toISOString(),...detail});await onProgress(phases.at(-1));};
  try{
    engines.baseline=await startEngine({directory:join(root,'redis-data'),binary:binaries.baseline,
      port:await freePort(),adminPassword:randomBytes(24).toString('hex')});
    check(engines.baseline.identity.serverName==='redis'&&!engines.baseline.identity.valkeyVersion,
      'The baseline must identify as the actual Redis engine.');
    const version=engines.baseline.identity.redisCompatibilityVersion?.split('.').map(Number);
    check(version?.length>=2&&version[0]===7&&version[1]<=2,
      'This original RDB migration journey requires Redis OSS 7.0 through 7.2.');
    await seed(engines.baseline.client);await reader(engines.baseline,environment[envNames.baseline]);
    await engines.baseline.client.save();
    const originalRdb=join(root,'redis-data','dump.rdb'),migration=await fileIdentity(originalRdb);
    engines.candidate=await startEngine({directory:join(root,'valkey-data'),binary:binaries.candidate,
      port:await freePort(),adminPassword:randomBytes(24).toString('hex'),rdb:originalRdb});
    check(engines.candidate.identity.serverName==='valkey'&&engines.candidate.identity.valkeyVersion,
      'The candidate must identify itself with native server_name=valkey and valkey_version.');
    const receivedRdb=await fileIdentity(join(root,'valkey-data','dump.rdb'));
    assert.equal(receivedRdb.bytes,migration.bytes);assert.equal(receivedRdb.sha256,migration.sha256);
    assert.equal(await engines.candidate.client.dbSize(),6);
    await reader(engines.candidate,environment[envNames.candidate]);
    await phase('ACTUAL_REDIS_RDB_LOADED_BY_VALKEY',{baseline:engines.baseline.identity,candidate:engines.candidate.identity,
      migration:{bytes:migration.bytes,sha256:migration.sha256}});
    facilitator=await localFacilitator();
    const input=await selectedInput({operationId:'native-redis-valkey-corrected',engines,migration,runtime:facilitator.runtime});
    const mismatch=await selectedInput({operationId:'native-redis-valkey-mismatch',engines,migration,runtime:facilitator.runtime});
    await save(join(root,'corrected-input.json'),input);await save(join(root,'mismatch-input.json'),mismatch);
    await changeCandidate(engines.candidate.client,false);
    const difference=await receiveRedisCutover({input:mismatch,directory:join(root,'mismatch'),environment,mode:'receive'});
    assert.equal(difference.status,'CONTRACT_MISMATCH');assert.equal(difference.release,null);
    assert.deepEqual(difference.comparisons.filter(value=>!value.matched).map(value=>value.checkId).sort(),
      ['catalog','list_feed','member_catalog']);
    assert.ok(difference.packages.baseline);assert.equal(difference.packages.candidate,null);
    await phase('ORIGINAL_MISMATCH_RETAINED',{queries:difference.comparisons.filter(value=>!value.matched).map(value=>value.query),
      directory:difference.directory});
    await changeCandidate(engines.candidate.client,true);
    const corrected=await receiveRedisCutover({input,directory:join(root,'corrected'),environment,mode:'receive'});
    assert.equal(corrected.status,'RECEIVED');assert.equal(corrected.comparisons.length,6);
    assert.equal(corrected.release.releaseId,'valkey-candidate');
    const native={};
    for(const side of ['baseline','candidate']){
      native[side]=await originals(join(root,'corrected'),side,environment);
      for(const receipt of native[side].received.checks){
        const original=native[side].products[receipt.query];
        const mode=receipt.query==='member_catalog'?'set':'ordered';
        const expected=compareRedisCutoverRows({baseline:{columns:columns[receipt.query],rows:rows[receipt.query]},candidate:original,mode});
        assert.equal(expected.matched,true);
        if(['leaderboard','events','list_feed','member_catalog'].includes(receipt.query))
          check(original.pages.length>1,'The paired native collection must exercise its actual continuation.');
      }
    }
    await phase('BOTH_COMPLETE_SIX_PRODUCT_WORKSPACES_RECEIVED',{workspaceBindings:corrected.workspaceBindings,
      nativePages:Object.fromEntries(Object.entries(native).map(([side,value])=>[side,Object.fromEntries(Object.entries(value.products).map(([name,p])=>[name,p.pages.length]))])),
      packageFiles:Object.fromEntries(Object.entries(corrected.packages).map(([side,value])=>[side,value.customerFiles.length]))});
    const customers={};
    for(const side of ['baseline','candidate']){
      customers[side]=await customer(join(root,'corrected'),side,input,environment);
      for(const [name,value] of Object.entries(customers[side].data)){
        const compared=compareRedisCutoverRows({baseline:native[side].products[name],candidate:value,
          mode:name==='member_catalog'?'set':'ordered'});
        assert.equal(compared.matched,true);
      }
      await phase('GENERATED_CUSTOMER_RECEIVED',{side,calls:customers[side].budget.callsUsed,
        files:customers[side].files.length,products:customers[side].products.map(value=>({id:value.id,pages:value.pages,rows:value.rows}))});
    }
    for(const name of Object.keys(rows))assert.equal(compareRedisCutoverRows({
      baseline:customers.baseline.data[name],candidate:customers.candidate.data[name],mode:name==='member_catalog'?'set':'ordered'}).matched,true);
    const count=customers.baseline.budget.callsUsed+customers.candidate.budget.callsUsed;
    assert.equal(facilitator.counts.verified,count);assert.equal(facilitator.counts.settled,count);
    for(const side of ['candidate','baseline'])closure[side]=await stopEngine(engines[side]);
    await facilitator.close();facilitator.closed=true;
    await phase('OWNED_NATIVE_ENGINES_CLOSED',{closure});
    const reopened=await coldReceiving(root,input,environment);
    const result={schema:SCHEMA,result:'PASS',directory:root,retainedWorkDirectory:root,
      runtime:{node:process.version,platform:process.platform,architecture:process.arch,nativeClient:'@redis/client@'+clientPackage.version},
      engineIdentities:Object.fromEntries(Object.entries(engines).map(([side,value])=>[side,value.identity])),
      migration:{method:'Redis SAVE -> exact original RDB -> native Valkey load',path:originalRdb,
        bytes:migration.bytes,sha256:migration.sha256,loadedDatabase:2,keys:6},
      consistency:input.consistency,phases,native,
      customer:Object.fromEntries(Object.entries(customers).map(([side,value])=>[side,{...value,data:undefined}])),
      nativeVerifies:facilitator.counts.verified,nativeSettlements:facilitator.counts.settled,
      facilitator:'LOCAL_PROTOCOL_FIXTURE',coldReceiving:reopened,closure};
    await phase('COMPLETE_SAME_SOURCE_COLD_REOPEN',{comparedProducts:reopened.compared.length});
    await save(join(root,'native-cutover.json'),result);
    return result;
  }catch(error){
    await save(join(root,'native-cutover-error.json'),{schema:SCHEMA,result:'FAILED',directory:root,
      phases,error:errorView(error)}).catch(()=>{});
    throw error;
  }finally{
    const errors=[];
    for(const side of ['candidate','baseline'])try{if(engines[side])await stopEngine(engines[side]);}catch(error){errors.push(error);}
    if(facilitator&&!facilitator.closed)try{await facilitator.close();}catch(error){errors.push(error);}
    if(errors.length)await save(join(root,'native-cutover-cleanup.json'),{errors:errors.map(errorView)}).catch(()=>{});
  }
}
export async function redisValkeyCutoverJourneyCli(args=process.argv.slice(2)){
  const [command,...rest]=args,values={};
  for(let i=0;i<rest.length;i+=2){
    check(['--directory','--redis-server','--valkey-server'].includes(rest[i])&&rest[i+1]&&!values[rest[i]],
      'Use run --directory NEW --redis-server REDIS --valkey-server VALKEY, or status --directory ORIGINAL.');
    values[rest[i]]=rest[i+1];
  }
  check(values['--directory']&&['run','status'].includes(command),'Choose run or status and the original directory.');
  if(command==='status'){
    check(!values['--redis-server']&&!values['--valkey-server'],'Status reopens the original saved operation.');
    return inspectRedisValkeyCutoverJourney({directory:values['--directory']});
  }
  return runRedisValkeyCutoverJourney({directory:values['--directory'],redisServer:values['--redis-server'],
    valkeyServer:values['--valkey-server'],onProgress:value=>process.stderr.write(encode(value))});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await redisValkeyCutoverJourneyCli();process.stdout.write(encode(result));}
  catch(error){process.stderr.write(encode({error:errorView(error)}));process.exitCode=1;}
}
