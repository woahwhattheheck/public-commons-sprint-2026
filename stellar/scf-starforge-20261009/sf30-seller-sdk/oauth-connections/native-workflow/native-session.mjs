// One original application / browser / receiving-host workflow. No external account or settlement.
import {openProtocolPeer} from './oauth-peer.mjs';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,chmod,readFile,writeFile,lstat,readdir,open,rename,unlink} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
const root=resolve(process.env.SCF_OAUTH_WORKSPACE_ROOT??join(here,'..'));
const sourceRoot=resolve(process.env.SCF_OAUTH_SOURCE_ROOT??join(root,'source'));
const star=join(sourceRoot,'stellar/scf-starforge-20261009');
const acceptance=join(root,'acceptance'),privateRoot=join(root,'native-private');
const controls=join(acceptance,'control'),packages=join(privateRoot,'merchant-projects');
const sha=b=>createHash('sha256').update(b).digest('hex');
const json=v=>JSON.stringify(v,null,2)+'\n';
const stamp=()=>new Date().toISOString();
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v);
const sleep=ms=>new Promise(yes=>setTimeout(yes,ms));
async function exists(file){try{return await lstat(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function directory(path){await mkdir(path,{recursive:true,mode:0o700});await chmod(path,0o700);}
async function atomic(file,value){
 const temp=file+'.tmp-'+randomUUID(),handle=await open(temp,'wx',0o600);
 try{await handle.writeFile(typeof value==='string'||Buffer.isBuffer(value)?value:json(value));await handle.sync();}finally{await handle.close();}
 await rename(temp,file);const d=await open(dirname(file),'r');try{await d.sync();}finally{await d.close();}
}
async function immutable(file,bytes){const prior=await exists(file);if(prior){if(!prior.isFile()||prior.isSymbolicLink()||sha(await readFile(file))!==sha(bytes))throw Error('Retained input changed: '+file);return;}await atomic(file,bytes);}
async function freePorts(count){
 const servers=[];try{for(let i=0;i<count;i++){const server=createServer();await new Promise((yes,no)=>{server.once('error',no);server.listen(0,'127.0.0.1',()=>{server.off('error',no);yes();});});servers.push(server);}return servers.map(s=>s.address().port);}
 finally{await Promise.all(servers.map(server=>new Promise(yes=>server.close(yes))));}
}
const load=relative=>import(pathToFileURL(join(star,relative)).href);
function specification(origin,revision){
 const path=revision?'/v2/records':'/records';
 const recordSchema={type:'object',required:['id','name'],additionalProperties:false,properties:{id:{type:'string'},name:{type:'string'}}};
 const responseSchema={type:'object',required:['records'],additionalProperties:false,properties:{records:{type:'array',items:recordSchema}}};
 const operation={operationId:revision?'listRecordsV2':'listRecords',summary:'Read the retained records',
  responses:{'200':{description:'Records returned by the original local provider',content:{'application/json':{schema:responseSchema}}}}};
 return {openapi:'3.1.0',info:{title:revision?'Records API revision 2':'Records API',version:revision?'2.0.0':'1.0.0',
  description:'Retained local OAuth protocol example for the original merchant workflow.'},
  servers:[{url:origin}],security:[{recordsOAuth:['records.read']}],paths:{[path]:{get:operation}},
  components:{securitySchemes:{recordsOAuth:{type:'oauth2',flows:{
   authorizationCode:{authorizationUrl:origin+'/authorize',tokenUrl:origin+'/token',scopes:{'records.read':'Read retained records'}},
   clientCredentials:{tokenUrl:origin+'/token',scopes:{'records.read':'Read retained records'}}
  }}}}};
}
for(const path of [acceptance,privateRoot,controls,packages,join(acceptance,'inputs')])await directory(path);
for(const file of ['sf61-openapi-seller-import/workspace/server.mjs','sf61-openapi-seller-import/workspace/oauth-http.mjs',
 'sf30-seller-sdk/oauth-connections/connection.mjs','sf30-seller-sdk/oauth-connections/store.mjs','sf30-seller-sdk/upstream.mjs',
 'sf82-seller-pilot/release-cli.mjs','sf99-merchant-deploy/host.mjs','sf30-seller-sdk/oauth-connections/host-check.mjs',
 'sf30-seller-sdk/oauth-connections/deployment.mjs','sf30-seller-sdk/oauth-connections/host.mjs']){
 const s=await lstat(join(star,file));if(!s.isFile()||s.isSymbolicLink()||!s.size)throw Error('Use the frozen regular source closure: '+file);
}
const configFile=join(privateRoot,'workflow.json');
let config;
if(await exists(configFile))config=JSON.parse(await readFile(configFile,'utf8'));
else{const [providerPort,workspacePort,hostSellerPort]=await freePorts(3);config={schema:'stellar-forge.oauth-native-workflow.v1',createdAt:stamp(),providerPort,workspacePort,hostSellerPort,clientId:'scf-local-records-review',publicSellerServer:'https://merchant.example.com/api',
 paymentExample:{network:'stellar:testnet',asset:'DEMO_NONPAYABLE_ASSET',payTo:'DEMO_NONPAYABLE_RECIPIENT',maxTimeoutSeconds:60,amountAtomic:'20000'},
 aliases:[{alias:'records-demo',directoryEnv:'Records_OAuth_Directory',directory:join(privateRoot,'records-connection'),file:'original-openapi.json',revision:false},
 {alias:'records-demo-revision',directoryEnv:'Records_Revision_OAuth_Directory',directory:join(privateRoot,'records-revision-connection'),file:'replacement-openapi.json',revision:true}]};await atomic(configFile,config);}
const {normalizeOAuthProfile,oauthProfileIdentity,oauthCallbackPath}=await load('sf30-seller-sdk/oauth-connections/profile.mjs');
const {initializeOAuthConnection,oauthConnectionStatus}=await load('sf30-seller-sdk/oauth-connections/connection.mjs');
const {startWorkspace}=await load('sf61-openapi-seller-import/workspace/server.mjs');
const {readPackage}=await load('sf61-openapi-seller-import/workspace/model.mjs');
const {readSellerConfig}=await load('sf30-seller-sdk/serve.mjs');
const {readUpstreamBindings,createUpstreamApplication}=await load('sf30-seller-sdk/upstream.mjs');
const providerOrigin='http://127.0.0.1:'+config.providerPort,workspaceOrigin='http://127.0.0.1:'+config.workspacePort;
const env={...process.env},sourceInputs=[],redirectUris=[];
for(const alias of config.aliases){
 const source=Buffer.from(json(specification(providerOrigin,alias.revision))),specPath=join(acceptance,'inputs',alias.file);
 await immutable(specPath,source);const profile=normalizeOAuthProfile({schema:'stellar-forge.oauth-authorization-profile.v1',label:alias.revision?'Records revision provider':'Records provider',
  source:{sha256:sha(source),scheme:'recordsOAuth'},authorizationEndpoint:providerOrigin+'/authorize',tokenEndpoint:providerOrigin+'/token',
  revocationEndpoint:providerOrigin+'/revoke',issuer:providerOrigin+'/',clientId:config.clientId,authMethod:'none',scopes:['records.read'],
  resourceOrigins:[providerOrigin],authorizationParameters:{},resourceParameters:[],pkceMethod:'S256'},{allowLoopback:true});
 await directory(alias.directory);await initializeOAuthConnection(alias.directory,{profile,allowLoopback:true});
 env[alias.directoryEnv]=alias.directory;const profileSha256=oauthProfileIdentity(profile),callbackPath=oauthCallbackPath(profileSha256);
 redirectUris.push(workspaceOrigin+callbackPath);sourceInputs.push({alias:alias.alias,directoryEnv:alias.directoryEnv,specPath,sourceSha256:sha(source),profileSha256,callbackPath});
 await immutable(join(acceptance,'inputs',alias.alias+'-profile.json'),Buffer.from(json(profile)));
}
const registry=config.aliases.map(({alias,directoryEnv})=>({alias,directoryEnv}));
await immutable(join(acceptance,'inputs','connections.json'),Buffer.from(json({schema:'stellar-forge.oauth-host-connections.v1',connections:registry})));
const peer=await openProtocolPeer({directory:join(privateRoot,'provider'),port:config.providerPort,clientId:config.clientId,redirectUris});
let workspace=null,driver=null,closing=null,stopping=false;
const applications=new Map();
async function currentStatus(){return Promise.all(config.aliases.map(async alias=>({alias:alias.alias,...await oauthConnectionStatus(alias.directory,{allowLoopback:true})})));}
async function ready(){
 const full={schema:'stellar-forge.oauth-native-ready.v1',updatedAt:stamp(),workspaceUrl:workspace.url,workspaceOrigin:workspace.origin,workspaceToken:workspace.token,
  providerOrigin,alias:'records-demo',revisionAlias:'records-demo-revision',specPath:sourceInputs[0].specPath,replacementSpecPath:sourceInputs[1].specPath,
  connectionDirectory:config.aliases[0].directory,revisionConnectionDirectory:config.aliases[1].directory,
  callbackPath:sourceInputs[0].callbackPath,aliases:sourceInputs,controlDirectory:controls,packageDirectory:packages,sourceRoot,
  publicSellerServer:config.publicSellerServer,paymentExample:config.paymentExample};
 await atomic(join(privateRoot,'ready.json'),full);
 const safe={schema:full.schema,updatedAt:full.updatedAt,workspaceOrigin:full.workspaceOrigin,providerOrigin,aliases:sourceInputs.map(({specPath,...x})=>({...x,specFile:specPath.split('/').at(-1)})),state:'ready',controllerPid:process.pid};
 await atomic(join(acceptance,'native-ready.json'),safe);return safe;
}
async function startWorkspaceAgain(){workspace=await startWorkspace({parent:packages,port:config.workspacePort,noSignals:true,oauthConnections:registry,env,allowLoopbackOAuth:true});await ready();}
async function closeApplications(){for(const app of applications.values())await app.application.close();applications.clear();}
await startWorkspaceAgain();
const driverFile=resolve(process.env.SCF_OAUTH_OPERATOR_DRIVER??join(acceptance,'operator-session.cjs'));
if(!(await exists(driverFile))?.isFile())throw Error('Retain the paired attach-only operator driver before starting the single lifetime.');
const output=await open(join(privateRoot,'operator.log'),'a',0o600);
driver=spawn(process.execPath,[driverFile],{env:{...process.env,SCF_OAUTH_WORKSPACE_ROOT:root},stdio:['ignore',output.fd,output.fd]});
driver.once('exit',(code,signal)=>{atomic(join(acceptance,'operator-exit.json'),{at:stamp(),code,signal}).catch(()=>{});});
await output.close();
const publicBytes=[]; // Only completed local output and public source are inspected for credential leakage.
async function applicationFor(packageName){
 const project=await readPackage(packages,packageName),manifestSha256=sha(await readFile(join(project.folder,'merchant-package.json')));
 const prior=applications.get(packageName);
 if(prior){if(prior.manifestSha256!==manifestSha256)throw Error('COMPILED_PACKAGE_CHANGED');return prior;}
 const [configValue,bindings]=await Promise.all([readSellerConfig(join(project.folder,'compiled','seller-service.json')),readUpstreamBindings(join(project.folder,'upstreams.json'))]);
 const application=createUpstreamApplication(configValue,bindings,{allowLoopback:true,env});
 const entry={project,manifestSha256,config:configValue,bindings,application};applications.set(packageName,entry);return entry;
}
async function hostPreparation(requestId,payload){
 const project=await readPackage(packages,payload.package);
 const {initReleaseStore,stageRelease,activateRelease,readReleaseState,inspectRelease}=await load('sf82-seller-pilot/releases.mjs');
 const {generate,checkBundle}=await load('sf99-merchant-deploy/host.mjs');
 const {prepareMounts,checkMounts}=await load('sf99-merchant-deploy/container-mounts.mjs');
 const {checkOAuthHostConnections}=await load('sf30-seller-sdk/oauth-connections/deployment.mjs');
 const stateRoot=join(privateRoot,'host-state-'+requestId),store=join(stateRoot,'releases'),bundle=join(privateRoot,'host-bundle-'+requestId);
 const planFile=join(privateRoot,'host-plan-'+requestId+'.json'),envFile=join(privateRoot,'host-environment-'+requestId+'.env');
 await directory(stateRoot);if(!await exists(store))await initReleaseStore(store);
 if(!await exists(join(store,'releases','oauth-host')))await stageRelease(store,{id:'oauth-host',workspace:project.folder,runtime:{port:config.hostSellerPort}});
 let state=await readReleaseState(store);if(state.active!=='oauth-host'){await activateRelease(store,'oauth-host',{expectedGeneration:state.generation,reason:'Joined OAuth receiving-host workflow'});state=await readReleaseState(store);}
 const bindingSource=await readUpstreamBindings(join(project.folder,'upstreams.json')),oauthDirectories={};
 for(const binding of Object.values(bindingSource.bindings))if(binding.oauthConnection){const name=binding.oauthConnection.directoryEnv;if(typeof env[name]!=='string')throw Error('NATIVE_ENVIRONMENT_REFERENCE_MISSING');oauthDirectories[name]=env[name];}
 if(!Object.keys(oauthDirectories).length)throw Error('NATIVE_HOST_OAUTH_BINDING_REQUIRED');
 await immutable(envFile,Buffer.from(Object.entries(oauthDirectories).map(([key,value])=>key+'='+JSON.stringify(value)).join('\n')+'\n'));
 const plan={schema:'stellar-forge.merchant-host.v1',merchant:'oauth-native',serviceUser:'forge',kind:'release',mode:'challenge',privateRoot:stateRoot,
  environmentFile:envFile,oauthDirectories,release:{store,expectedGeneration:state.generation}};
 await immutable(planFile,Buffer.from(json(plan)));
 if(!await exists(bundle))await generate(planFile,bundle,{sourceRoot});
 const before=peer.snapshot().counters,host=await checkBundle(bundle),connections=await checkOAuthHostConnections(host,{env});
 const container={uid:process.getuid(),readOnlyRoots:[]},mounts=await prepareMounts(host,container,bundle);await checkMounts(host,container,bundle,mounts);
 const seller=host.services.find(x=>x.role==='seller'),unit=await readFile(join(bundle,seller.unit),'utf8');
 for(const path of Object.values(oauthDirectories)){
  if(!unit.includes(path)||!unit.includes('ReadWritePaths=')||!unit.includes('oauth-connections/host-check.mjs'))throw Error('NATIVE_SYSTEMD_OAUTH_TOPOLOGY_MISSING');
  if(!mounts.some(x=>x.source===path&&x.target===path&&!x.read_only&&x.bind.create_host_path===false))throw Error('NATIVE_OAUTH_MOUNT_MISSING');
 }
 if(JSON.stringify(before)!==JSON.stringify(peer.snapshot().counters))throw Error('HOST_PREFLIGHT_CALLED_PROVIDER');
 const release=await inspectRelease(store,'oauth-host');
 const result={schema:'stellar-forge.oauth-native-host-result.v1',at:stamp(),package:payload.package,releaseId:release.id,generation:state.generation,
  sourceEntries:host.sourceEntries.map(x=>({path:x.path.replace(sourceRoot+'/',''),sha256:x.sha256})),connections,
  systemd:{generated:true,executed:false,unit:seller.unit,sha256:sha(unit),oauthPreflight:true,explicitWritableDirectories:Object.keys(oauthDirectories)},
  mounts:{prepared:true,checked:true,containerExecuted:false,bindings:mounts},providerCallsDuringPreparation:0};
 publicBytes.push(Buffer.from(json(result)),Buffer.from(unit));await atomic(join(acceptance,'HOST_'+requestId+'.json'),result);return result;
}
async function scanPublic(payload){
 const secrets=[],peerState=JSON.parse(await readFile(join(privateRoot,'provider','peer-state.json'),'utf8'));
 secrets.push(...Object.keys(peerState.access),...Object.keys(peerState.refresh),...Object.keys(peerState.codes));
 const selected=await readPackage(packages,payload.package),files=[];
 async function walk(dir){for(const entry of await readdir(dir,{withFileTypes:true})){if(entry.name==='support'||entry.name.startsWith('.'))continue;const p=join(dir,entry.name);if(entry.isDirectory())await walk(p);else if(entry.isFile()){const stat=await lstat(p);if(stat.size>8*1024*1024)throw Error('OUTPUT_SCAN_LIMIT');files.push(p);}}}
 await walk(selected.folder);
 const buffers=[...publicBytes,Buffer.from(json(await currentStatus()))];for(const file of files)buffers.push(await readFile(file));
 for(const bytes of buffers)for(const secret of secrets)if(secret&&bytes.includes(Buffer.from(secret)))throw Error('PRIVATE_PROTOCOL_VALUE_IN_PUBLIC_OUTPUT');
 return {package:payload.package,files:files.length,statusAndHostOutputs:publicBytes.length+1,privateValuesChecked:secrets.length,leaks:0};
}
async function command(request){
 const {id:requestId,action,payload={}}=request;
 if(!validId(requestId)||typeof action!=='string'||payload===null||typeof payload!=='object'||Array.isArray(payload))throw Error('CONTROL_REQUEST_INVALID');
 if(action==='status')return {connections:await currentStatus(),peer:peer.snapshot(),workspaceOrigin:workspace.origin,applications:[...applications.keys()]};
 if(action==='peer.control')return peer.control({requestId,action:payload.action});
 if(action==='workspace.restart'){await workspace.close();workspace=null;await closeApplications();await startWorkspaceAgain();return {workspaceOrigin:workspace.origin,connections:await currentStatus(),sameOriginalSources:true};}
 if(action==='application.invoke'){
  const entry=await applicationFor(payload.package),route=entry.config.routes.find(x=>x.id===payload.routeId)??entry.config.routes[0];
  if(!route||typeof entry.application.handlers[route.handler]!=='function')throw Error('NATIVE_APPLICATION_HANDLER_MISSING');
  if(payload.invalidateCache===true)entry.application.invalidateCache(route.handler);
  const url=new URL(route.path,entry.config.publicOrigin??config.publicSellerServer);
  const response=await entry.application.handlers[route.handler]({method:'GET',url,params:{},headers:{accept:'application/json'},signal:AbortSignal.timeout(10000)});
  const raw=Buffer.isBuffer(response.body)?response.body:Buffer.from(JSON.stringify(response.body));
  let body;try{body=JSON.parse(raw.toString('utf8'));}catch{body=raw.toString('utf8');}
  const result={at:stamp(),package:payload.package,routeId:route.id,status:response.status,body,responseSha256:sha(raw),runtime:entry.application.snapshot(),peer:peer.snapshot(),
   semantics:'Original SF30 application handler with the original compiled package; no payment verification or settlement is asserted by this direct application call.'};
  publicBytes.push(Buffer.from(json(result)));return result;
 }
 if(action==='application.close'){await closeApplications();return {closed:true};}
 if(action==='host.prepare')return hostPreparation(requestId,payload);
 if(action==='scan.public')return scanPublic(payload);
 if(action==='close'){stopping=true;return {closing:true,at:stamp(),connections:await currentStatus(),peer:peer.snapshot()};}
 throw Error('CONTROL_ACTION_UNKNOWN');
}
async function close(){
 if(closing)return closing;
 closing=(async()=>{
  stopping=true;if(driver&&driver.exitCode===null&&!driver.killed){driver.kill('SIGTERM');await Promise.race([new Promise(yes=>driver.once('exit',yes)),sleep(10000)]);if(driver.exitCode===null&&!driver.signalCode)driver.kill('SIGKILL');}
  await workspace?.close();workspace=null;await closeApplications();await peer.close();
  await atomic(join(acceptance,'native-closed.json'),{at:stamp(),controllerPid:process.pid,peer:peer.snapshot()});
  await unlink(join(privateRoot,'ready.json')).catch(e=>{if(e.code!=='ENOENT')throw e;});
 })();return closing;
}
process.once('SIGTERM',()=>close().catch(()=>{process.exitCode=1;}));process.once('SIGINT',()=>close().catch(()=>{process.exitCode=1;}));
process.stdout.write(JSON.stringify({state:'ready',workspaceOrigin,providerOrigin,readyFile:join(acceptance,'native-ready.json')})+'\n');
try{
 while(!stopping){
  const names=(await readdir(controls)).filter(x=>x.endsWith('.request.json')).sort();
  for(const name of names){
   if(stopping)break;
   const requestFile=join(controls,name),request=JSON.parse(await readFile(requestFile,'utf8'));
   if(name!==request.id+'.request.json'||!validId(request.id))throw Error('CONTROL_FILENAME_MISMATCH');
   const resultFile=join(controls,request.id+'.result.json'),inputHash=sha(json(request)),prior=await exists(resultFile);
   if(prior){const result=JSON.parse(await readFile(resultFile,'utf8'));if(result.inputHash!==inputHash)throw Error('CONTROL_REPLAY_CHANGED');continue;}
   let response;
   try{response={id:request.id,inputHash,ok:true,result:await command(request),completedAt:stamp()};}
   catch(error){response={id:request.id,inputHash,ok:false,error:{code:typeof error.code==='string'?error.code:'NATIVE_OPERATION_FAILED',message:String(error.message).slice(0,1500)},completedAt:stamp()};}
   await atomic(resultFile,response);await atomic(join(acceptance,'native-progress.json'),{at:stamp(),lastCommand:request.id,ok:response.ok,peer:peer.snapshot()});
  }
  if(!stopping)await sleep(200);
 }
}finally{await close();}
