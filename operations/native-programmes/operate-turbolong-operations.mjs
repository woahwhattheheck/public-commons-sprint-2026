#!/usr/bin/env node
// MIT. Complete source-native Turbolong commissioning and independent receiving.
// Original implementation remains Dgetsylver/TurboLong at the selected source commit.
import * as fs from 'node:fs/promises';
import {constants,createReadStream,createWriteStream} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {pipeline} from 'node:stream/promises';
import {createInterface} from 'node:readline';

const SOURCE_ROOT='stellar/scf-starforge-20261009/sf30-seller-sdk/turbolong-operations';
const SOURCE_COMMIT='f017de605bb020bf3d7f4285aae4c654508e8d86';
const SCHEMA='stellar-forge.turbolong-operations.native-commissioning.v1';
const FLAGS=new Set(['source-packet','expected-source-sha256','operation-directory','original-source-capsule','configuration-file','installation-directory','runtime-directory','runtime-manifest-sha256','runtime-mode','build-targets','node-executable','npm-executable','cargo-executable','rustc-executable','stellar-executable','node-heap-mb','cargo-jobs','include-tools','include-rust-toolchain','playwright-module','chromium-executable','port','starts-at','ends-at','provider-budget-ms','maximum-provider-pages','rates-input','courier-stdin','execute-corrections','keep-server']);
const options={};for(let i=2;i<process.argv.length;i++){
 const token=process.argv[i];if(token==='--help'){console.log('node operate-turbolong-operations.mjs --source-packet /private/application.json --operation-directory /private/turbolong-native --original-source-capsule /private/publisher.json [--runtime-directory /private/existing-runtime] [--configuration-file /private/connections.json] [--playwright-module /actual/playwright/index.mjs --chromium-executable /actual/chrome] [--courier-stdin true]');process.exit(0);}
 if(!token.startsWith('--')||!FLAGS.has(token.slice(2))||options[token.slice(2)]!==undefined)throw new Error('Unknown or repeated option '+token);
 const value=process.argv[++i];if(!value||value.startsWith('--'))throw new Error('Supply a value for '+token);options[token.slice(2)]=value;
}
function need(value,code,details={}){if(!value)throw Object.assign(new Error(code),{code,details});return value;}
const sha=b=>createHash('sha256').update(b).digest('hex');
const bytes=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const now=()=>new Date().toISOString(),clone=v=>JSON.parse(JSON.stringify(v));
const bool=(name,fallback=false)=>options[name]===undefined?fallback:need(['true','false'].includes(options[name]),'BOOLEAN_REQUIRED',{name})&&options[name]==='true';
function integer(name,fallback,min=0,max=Number.MAX_SAFE_INTEGER){const value=options[name]===undefined?fallback:Number(options[name]);need(Number.isSafeInteger(value)&&value>=min&&value<=max,'INTEGER_REQUIRED',{name});return value;}
function relative(value){need(typeof value==='string'&&value&&!value.includes('\\')&&!value.includes('\0')&&!path.posix.isAbsolute(value)&&value.split('/').every(v=>v&&v!=='.'&&v!=='..'),'SOURCE_PATH_INVALID',{path:value});return value;}
function within(root,value){const r=path.relative(root,value);return !path.isAbsolute(r)&&r!=='..'&&!r.startsWith('..'+path.sep);}
async function exists(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function privateDirectory(p){await fs.mkdir(p,{recursive:true,mode:0o700});const st=await fs.lstat(p);need(st.isDirectory()&&!st.isSymbolicLink(),'DIRECTORY_REQUIRED',{path:p});return p;}
async function syncDir(p){const h=await fs.open(p,'r');try{await h.sync();}finally{await h.close();}}
async function originalFile(p){const h=await fs.open(p,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{
 const before=await h.stat({bigint:true});need(before.isFile(),'REGULAR_FILE_REQUIRED',{path:p});const hash=createHash('sha256'),b=Buffer.alloc(262144);let count=0;
 while(true){const{bytesRead}=await h.read(b,0,b.length,null);if(!bytesRead)break;hash.update(b.subarray(0,bytesRead));count+=bytesRead;}
 const after=await h.stat({bigint:true});need(before.ino===after.ino&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'SOURCE_CHANGED',{path:p});
 return {path:p,bytes:count,sha256:hash.digest('hex'),mode:Number(after.mode&0o777n)};
 }finally{await h.close();}}
async function exact(p,body,mode=0o600){body=Buffer.from(body);await privateDirectory(path.dirname(p));const old=await exists(p);
 if(old){need(old.isFile()&&!old.isSymbolicLink(),'SOURCE_PATH_CONFLICT',{path:p});const d=await originalFile(p);need(d.bytes===body.length&&d.sha256===sha(body),'IMMUTABLE_SOURCE_CHANGED',{path:p});return d;}
 const temp=p+'.pending-'+randomUUID(),h=await fs.open(temp,'wx',mode);try{await h.writeFile(body);await h.chmod(mode);await h.sync();}finally{await h.close();}
 try{await fs.link(temp,p);}catch(e){if(e.code!=='EEXIST')throw e;const d=await originalFile(p);need(d.bytes===body.length&&d.sha256===sha(body),'IMMUTABLE_SOURCE_CHANGED',{path:p});}
 finally{await fs.unlink(temp);}await syncDir(path.dirname(p));return {path:p,bytes:body.length,sha256:sha(body),mode};}
async function replace(p,value){await privateDirectory(path.dirname(p));const temp=p+'.pending-'+randomUUID(),h=await fs.open(temp,'wx',0o600);try{await h.writeFile(bytes(value));await h.sync();}finally{await h.close();}await fs.rename(temp,p);await syncDir(path.dirname(p));}
async function json(p){return JSON.parse(await fs.readFile(p,'utf8'));}
async function optional(p){try{return await json(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
function errorValue(e){return {code:e.code??e.name??'ERROR',message:e.message??String(e),details:e.details??null};}
async function procInfo(p='self'){try{const prefix='/proc/'+p,stat=await fs.readFile(prefix+'/stat','utf8'),v=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);return {pid:Number(stat.slice(0,stat.indexOf(' '))),start:v[19],namespace:await fs.readlink(prefix+'/ns/pid'),boot:(await fs.readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};}catch(e){if(['ENOENT','EACCES','EPERM','ESRCH'].includes(e.code))return null;throw e;}}
async function alive(owner){if(process.platform!=='linux'){try{process.kill(owner.pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
 for(const entry of await fs.readdir('/proc',{withFileTypes:true})){if(!entry.isDirectory()||!/^\d+$/.test(entry.name))continue;const p=await procInfo(entry.name);if(p&&p.boot===owner.boot&&p.namespace===owner.namespace&&p.start===owner.start&&p.pid===owner.pid)return true;}return false;}
async function lease(root){const target=path.join(root,'native-owner'),token=randomUUID(),owner={...await procInfo(),token,pid:process.pid,at:now()};
 for(let i=0;i<3;i++){const candidate=target+'.candidate-'+token;await fs.mkdir(candidate,{mode:0o700});await exact(path.join(candidate,'owner.json'),bytes(owner));
  try{await fs.rename(candidate,target);return async()=>{const current=await json(path.join(target,'owner.json'));need(current.token===token,'NATIVE_OWNER_CHANGED');await fs.rm(target,{recursive:true});};}
  catch(e){await fs.rm(candidate,{recursive:true,force:true});if(!['EEXIST','ENOTEMPTY'].includes(e.code))throw e;
   const old=await json(path.join(target,'owner.json'));need(!await alive(old),'NATIVE_OPERATION_ALREADY_RUNNING',{owner:old});
   const stale=target+'.previous-'+old.token;try{await fs.rename(target,stale);}catch(e){if(e.code!=='ENOENT')throw e;}
  }}
 throw new Error('NATIVE_OPERATION_BUSY');
}
need(options['source-packet']&&options['operation-directory'],'SOURCE_AND_OPERATION_REQUIRED');
const ROOT=path.resolve(options['operation-directory']);await privateDirectory(ROOT);
const release=await lease(ROOT),controller=new AbortController();
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>controller.abort(new Error(signal)));
const JPATH=path.join(ROOT,'operation.json');let ledger=await optional(JPATH);
if(!ledger){ledger={schema:SCHEMA,id:'TURBOLONG-NATIVE-6BBB-20261013',createdAt:now(),workspaceDirectory:path.join(ROOT,'workspace'),sources:[],stages:{},requests:{},results:[],currentSource:null};await replace(JPATH,ledger);}
need(ledger.schema===SCHEMA,'NATIVE_OPERATION_IDENTITY_CONFLICT');
let operator=null,server=null,receivedServer=null,browser=null,sourceDirectory=null,modules={},sourceIdentity=null;
const progress=(phase,data={})=>process.stdout.write(JSON.stringify({operationId:ledger.id,phase,at:now(),...data})+'\n');
async function stage(key,work,{sourceBound=true,required=true,force=false}={}){
 const selectedKey=(sourceBound?sourceIdentity.sha256+':':'')+key,row=ledger.stages[selectedKey]??{key,sourceSha256:sourceBound?sourceIdentity.sha256:null,required,attempts:[]};ledger.stages[selectedKey]=row;
 if(row.state==='COMPLETE'&&!force){progress(key,{state:'REUSED'});return {ok:true,value:await json(path.join(ROOT,row.result.path))};}
 const n=row.attempts.length+1,dir=path.join(ROOT,'stages',sha(Buffer.from(selectedKey)),String(n).padStart(6,'0'));await privateDirectory(dir);
 const attempt={index:n,state:'RUNNING',startedAt:now(),directory:path.relative(ROOT,dir),owner:await procInfo()};row.attempts.push(attempt);row.state='RUNNING';await replace(JPATH,ledger);progress(key,{state:'RUNNING',attempt:n});
 try{const result=await work({directory:dir,attempt:n});const value=result===undefined?null:result;const saved=await exact(path.join(dir,'result.json'),bytes(value));
  attempt.state='COMPLETE';attempt.finishedAt=now();attempt.result={...saved,path:path.relative(ROOT,saved.path)};row.state='COMPLETE';row.result=attempt.result;await replace(JPATH,ledger);progress(key,{state:'COMPLETE',resultSha256:saved.sha256});return {ok:true,value};
 }catch(e){const detail=errorValue(e);await exact(path.join(dir,'error.json'),bytes(detail));attempt.state='FAILED';attempt.error=detail;attempt.finishedAt=now();row.state='FAILED';await replace(JPATH,ledger);progress(key,{state:'FAILED',error:detail});return {ok:false,error:detail};}
}
async function pinned(name,semantic,create){const target=path.join(ROOT,'selections',sha(Buffer.from(name))+'.json'),old=await optional(target);
 if(old){need(old.semanticSha256===sha(bytes(semantic)),'NATIVE_SELECTION_CHANGED',{name});return old.value;}
 const value=await create();await exact(target,bytes({name,semanticSha256:sha(bytes(semantic)),value,createdAt:now()}));return value;}
async function invokeOriginal(target,name,method,args){
 const directory=target.directory,semantic={directory,method,args},saved=await pinned('request:'+name,semantic,async()=>({requestId:randomUUID(),expectedRevision:(await target.describe()).revision}));
 let wire={...args,...saved};
 const key=sha(bytes(semantic)),sidecar=path.join(ROOT,'requests',key);await privateDirectory(sidecar);
 const attempts=(await fs.readdir(sidecar)).filter(n=>/^\d{6}\.json$/.test(n)).sort();
 if(attempts.length){const selected=await json(path.join(sidecar,attempts.at(-1)));need(selected.requestId===saved.requestId&&selected.semanticSha256===sha(bytes(semantic)),'NATIVE_REQUEST_CONFLICT');wire.expectedRevision=selected.expectedRevision;}
 for(let count=0;count<8;count++){
  try{const result=await target.invoke({method,args:wire});const responseBytes=bytes(result);await exact(path.join(sidecar,'responses',sha(responseBytes)+'.json'),responseBytes);return result;}
  catch(e){if(e.code!=='REVISION_CONFLICT')throw e;
   const observed=(await target.describe()).revision;need(Number.isSafeInteger(observed)&&observed!==wire.expectedRevision,'REVISION_CONFLICT',{actualRevision:observed});
   const index=(await fs.readdir(sidecar)).filter(n=>/^\d{6}\.json$/.test(n)).length+1;
   await exact(path.join(sidecar,String(index).padStart(6,'0')+'.json'),bytes({requestId:saved.requestId,semanticSha256:sha(bytes(semantic)),priorExpectedRevision:wire.expectedRevision,expectedRevision:observed,rejection:errorValue(e),observedAt:now()}));
   wire.expectedRevision=observed;
  }
 }
 throw new Error('NATIVE_REVISION_PROGRESS_CONFLICT');
}
async function command(name,exe,args,{cwd=ROOT,env={},stdin}={}){
 const commandRoot=path.join(ROOT,'native-commands',sha(bytes({name,exe,args,cwd})));await privateDirectory(commandRoot);
 const existing=await optional(path.join(commandRoot,'result.json'));if(existing){need(existing.code===0,'ORIGINAL_COMMAND_FAILED',existing);return existing;}
 const selection={name,executable:exe,args,cwd,stdinSha256:stdin?sha(stdin):null};await exact(path.join(commandRoot,'request.json'),bytes(selection));
 const output=await fs.open(path.join(commandRoot,'stdout'),'a',0o600),errors=await fs.open(path.join(commandRoot,'stderr'),'a',0o600);
 try{const child=spawn(exe,args,{cwd,env:{...process.env,...env},stdio:[stdin?'pipe':'ignore',output.fd,errors.fd]});if(stdin)child.stdin.end(stdin);
  const result=await new Promise((done,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>done({code,signal,finishedAt:now()}));});
  await output.sync();await errors.sync();const receipt={...selection,...result,stdout:await originalFile(path.join(commandRoot,'stdout')),stderr:await originalFile(path.join(commandRoot,'stderr'))};await exact(path.join(commandRoot,'result.json'),bytes(receipt));need(result.code===0,'ORIGINAL_COMMAND_FAILED',receipt);return receipt;
 }finally{await output.close();await errors.close();}
}


async function materializeApplication(){
 const packetPath=path.resolve(options['source-packet']),body=await fs.readFile(packetPath);sourceIdentity={bytes:body.length,sha256:sha(body)};
 if(options['expected-source-sha256'])need(sourceIdentity.sha256===options['expected-source-sha256'],'APPLICATION_PACKET_CHANGED');
 const packet=JSON.parse(body);need(['tjlabs.original-source-packet.v1','stellar-forge.complete-source.v1'].includes(packet.schema)&&Array.isArray(packet.files)&&packet.files.length>0,'APPLICATION_PACKET_REQUIRED');
 const root=path.join(ROOT,'applications',sourceIdentity.sha256,'source'),seen=new Set();await privateDirectory(root);
 for(const f of packet.files){relative(f.path);need(!seen.has(f.path),'APPLICATION_DUPLICATE_SOURCE');seen.add(f.path);
  const content=f.encoding==='base64'?Buffer.from(f.content,'base64'):Buffer.from(f.content,'utf8');need(content.length===f.bytes&&sha(content)===f.sha256,'APPLICATION_SOURCE_CHANGED',{path:f.path});
  const mode=typeof f.mode==='string'?parseInt(f.mode,8)&0o777:(f.mode??0o644)&0o777;await exact(path.join(root,f.path),content,mode);
 }
 sourceDirectory=path.join(root,SOURCE_ROOT);need(await exists(path.join(sourceDirectory,'source-files.json')),'APPLICATION_MANIFEST_REQUIRED');
 const manifest=await originalFile(path.join(sourceDirectory,'source-files.json'));
 if(!ledger.sources.some(item=>item.sha256===sourceIdentity.sha256)){ledger.sources.push({...sourceIdentity,directory:root,sourceDirectory,manifest,selectedAt:now()});}
 ledger.currentSource=sourceIdentity.sha256;await replace(JPATH,ledger);
 await exact(path.join(ROOT,'applications',sourceIdentity.sha256,'packet.json'),body);
 for(const f of packet.files.filter(f=>f.path.endsWith('.mjs')))await command('syntax:'+f.path,options['node-executable']??process.execPath,['--check',path.join(root,f.path)]);
 for(const name of ['runtime','operator','server','receiving','archive','worker','catalogue','native'])modules[name]=await import(pathToFileURL(path.join(sourceDirectory,name+'.mjs')).href);
 return {packet:sourceIdentity,directory:root,sourceDirectory,manifest,files:packet.files.length,syntaxModules:packet.files.filter(f=>f.path.endsWith('.mjs')).length};
}
async function materializePublisher(){
 if(options['original-source-capsule']){
  const selected=path.resolve(options['original-source-capsule']),body=await fs.readFile(selected),capsule=JSON.parse(body);
  need(capsule.repository==='Dgetsylver/TurboLong'&&capsule.commit===SOURCE_COMMIT&&capsule.files?.length===276&&!capsule.missing?.length,'ORIGINAL_PUBLISHER_SOURCE_REQUIRED');
  const root=options['installation-directory']?path.resolve(options['installation-directory']):path.join(ROOT,'publisher-installation'),seen=new Set();
  for(const f of capsule.files){relative(f.path);need(!seen.has(f.path),'ORIGINAL_SOURCE_DUPLICATE');seen.add(f.path);
   const content=f.encoding==='base64'?Buffer.from(f.content,'base64'):Buffer.from(f.content,'utf8');
   need(content.length===f.bytes&&sha(content)===f.sha256&&createHash('sha1').update(Buffer.from('blob '+content.length+'\0')).update(content).digest('hex')===f.gitBlobSha,'ORIGINAL_SOURCE_CHANGED',{path:f.path});
   await exact(path.join(root,f.path),content,parseInt(f.gitMode,8)&0o777);
  }
  await exact(path.join(ROOT,'private','publisher-source.json'),body);
  return {directory:root,capsule:path.join(ROOT,'private','publisher-source.json'),capsuleSha256:sha(body),files:seen.size,commit:SOURCE_COMMIT};
 }
 if(options['installation-directory'])return {directory:path.resolve(options['installation-directory']),commit:SOURCE_COMMIT,source:'selected-installed-original'};
 if(options['runtime-directory']){const runtime=await modules.runtime.verifyTurbolongRuntime({directory:path.resolve(options['runtime-directory']),expectedManifestSha256:options['runtime-manifest-sha256']});return {directory:runtime.sourceDirectory,commit:SOURCE_COMMIT,source:'verified-retained-runtime'};}
 throw Object.assign(new Error('Select the complete original publisher capsule, installation or retained runtime.'),{code:'ORIGINAL_PUBLISHER_SOURCE_REQUIRED'});
}
async function prepareRuntime(publisher){
 if(options['runtime-directory'])return modules.runtime.verifyTurbolongRuntime({directory:path.resolve(options['runtime-directory']),expectedManifestSha256:options['runtime-manifest-sha256']});
 const directory=path.join(ROOT,'runtimes','original'),common={installationDirectory:publisher.directory,directory,
  nodeHeapMB:integer('node-heap-mb',512,256,65536),cargoJobs:integer('cargo-jobs',1,1,256),
  includeRustToolchain:bool('include-rust-toolchain',true),signal:controller.signal,
  progress:value=>progress('original-build',value)};
 for(const [flag,key]of Object.entries({'node-executable':'nodeExecutable','npm-executable':'npmExecutable','cargo-executable':'cargoExecutable','rustc-executable':'rustcExecutable','stellar-executable':'stellarExecutable'}))if(options[flag])common[key]=options[flag];
 if(options['include-tools'])common.includeTools=options['include-tools'].split(',').filter(Boolean);
 if(options['runtime-mode']==='retain')return modules.runtime.retainTurbolongRuntime(common);
 need(!options['runtime-mode']||options['runtime-mode']==='build','RUNTIME_MODE_INVALID');
 common.buildTargets=(options['build-targets']??'scripts,binaries,contracts,frontend,alerts,cargo-sources').split(',').filter(Boolean);
 common.sourceDirectory=publisher.directory;common.buildDirectory=path.join(ROOT,'original-build');
 return modules.runtime.buildTurbolongRuntime(common);
}
async function regularRuntime(runtime){
 const root=path.join(ROOT,'runtime-transfer',runtime.id);await privateDirectory(root);
 for(const f of runtime.manifest.files){const src=path.join(runtime.directory,f.path),target=path.join(root,f.path);await privateDirectory(path.dirname(target));
  if(!await exists(target)){await fs.copyFile(src,target,constants.COPYFILE_EXCL);await fs.chmod(target,0o600);}
  const actual=await originalFile(target);need(actual.sha256===f.sha256&&actual.bytes===f.bytes,'RUNTIME_TRANSPORT_CHANGED',{path:f.path});
 }
 await exact(path.join(root,'manifest.json'),await fs.readFile(path.join(runtime.directory,'manifest.json')));
 const restored=await modules.runtime.restoreTurbolongRuntime({sourceDirectory:root,destination:path.join(ROOT,'runtimes','independent-'+runtime.id),expectedManifestSha256:runtime.manifestSha256,signal:controller.signal});
 need(restored.id===runtime.id&&restored.manifestSha256===runtime.manifestSha256,'RUNTIME_RECONSTRUCTION_CHANGED');
 const binding=await modules.runtime.bindTurbolongRuntime({directory:restored.directory,applicationDirectory:sourceDirectory,expectedManifestSha256:runtime.manifestSha256});
 const node=restored.tools.node;need(node,'ORIGINAL_NODE_REQUIRED');
 const execution=await command('restored-original-node',node.path,['-p','JSON.stringify({version:process.version,versions:process.versions,platform:process.platform,arch:process.arch})'],
  {env:{LD_LIBRARY_PATH:[...new Set(Object.values(restored.tools).flatMap(t=>t.libraryDirectories??[]))].join(path.delimiter)}});
 return {original:modules.runtime.publicTurbolongRuntime(runtime),restored:modules.runtime.publicTurbolongRuntime(restored),directory:restored.directory,binding,nativeNode:JSON.parse(await fs.readFile(execution.stdout.path,'utf8'))};
}
async function readConfiguration(publisher,runtime){
 let supplied={};if(options['configuration-file']){const file=path.resolve(options['configuration-file']),st=await fs.lstat(file);
  need(st.isFile()&&!st.isSymbolicLink()&&(st.mode&0o077)===0,'PRIVATE_CONFIGURATION_REQUIRED');supplied=await json(file);}
 const source=publisher?.directory;let testnetVaults=[];
 if(source){const selected=await json(path.join(source,'deployed-vaults.testnet.json'));testnetVaults=Object.entries(selected).map(([symbol,row])=>({symbol,name:'Original '+symbol+' testnet vault',network:'testnet',strategyId:row.strategy,shareTokenId:row.token,source:{commit:SOURCE_COMMIT,path:'deployed-vaults.testnet.json'}}));}
 const mainnetURL='https://soroban-rpc.creit.tech/',testnetURL='https://soroban-testnet.stellar.org',telemetryURL='https://turbolong-alerts.turbolong.workers.dev';
 const connections={
  mainnet:{id:'turbolong-native-mainnet',network:'mainnet',rpcUrl:mainnetURL,horizonUrl:'https://horizon.stellar.org',telemetryUrl:telemetryURL,
   surfaces:[{id:'rpc',kind:'rpc-health',url:mainnetURL},{id:'app',url:'https://app.turbolong.com'},{id:'status',url:'https://app.turbolong.com/status.html'},{id:'snapshots',url:telemetryURL+'/snapshots?limit=1'}]},
  testnet:{id:'turbolong-native-testnet',network:'testnet',rpcUrl:testnetURL,horizonUrl:'https://horizon-testnet.stellar.org',telemetryUrl:telemetryURL,
   surfaces:[{id:'rpc',kind:'rpc-health',url:testnetURL}]},
  ...(supplied.connections??{})
 };
 if(runtime)for(const [alias,connection]of Object.entries(connections)){
  const selected={...connection,...(connection.private??{})};
  if(!selected.runtime&&!selected.runtimeDirectory)connection.runtime={runtimeDirectory:runtime.directory,expectedManifestSha256:runtime.manifestSha256};
  if(!selected.executionDirectory)connection.executionDirectory=path.join(ROOT,'native-executions',alias);
 }
 const runtimes=[...(supplied.runtimes??[]),...(runtime?[{directory:runtime.directory,expectedManifestSha256:runtime.manifestSha256}]:[])];
 const profile={name:'Turbolong source-native commissioning',organization:'Turbolong',...(supplied.profile??{})};
 const originalWindow=await pinned('operating-window',{startsAt:options['starts-at']??null,endsAt:options['ends-at']??null},async()=>{
  const end=options['ends-at']??now(),start=options['starts-at']??new Date(Date.parse(end)-30*86400000).toISOString();need(Number.isFinite(Date.parse(start))&&Number.isFinite(Date.parse(end))&&Date.parse(start)<Date.parse(end),'OPERATING_PERIOD_INVALID');
  return {startsAt:new Date(start).toISOString(),endsAt:new Date(end).toISOString()};
 });
 const connectionAliases=Object.fromEntries(['mainnet','testnet'].map(network=>[network,supplied.connectionAliases?.[network]??Object.entries(supplied.connections??{}).find(([,value])=>(value.private?.network??value.network)===network)?.[0]??network]));
 for(const [network,alias]of Object.entries(connectionAliases))need(connections[alias]&&(connections[alias].private?.network??connections[alias].network)===network,'SELECTED_CONNECTION_NETWORK_MISMATCH',{network,alias});
 const result={connections,connectionAliases,runtimes,profile,window:originalWindow,vaults:supplied.vaults??testnetVaults,
  history:supplied.history??[],corrections:supplied.correctiveOperations??[],ratesInput:supplied.ratesInput??null,
  source:{commit:SOURCE_COMMIT,metadata:'Endpoints from original frontend/src/history.ts, frontend/src/status.ts and original native script defaults; deployed testnet IDs from complete original JSON.'}};
 const selectedBytes=bytes(result);await exact(path.join(ROOT,'private','configuration-'+sourceIdentity.sha256+'-'+sha(selectedBytes)+'.json'),selectedBytes);return result;
}
async function savePeriod(network,configuration){
 const definition={name:'Original '+network+' operating history',network,...configuration.window,expectedSnapshotIntervalSeconds:900,
  expectedSurfaceIntervalSeconds:900,expectedHealthIntervalSeconds:900,surfaces:(configuration.connections[findAlias(configuration,network)]?.surfaces??[]).map(s=>s.id),
  healthDimensions:['keeper','alerts','snapshots','flows'],acceptance:{executedMainnetHarvests:50,rateHistoryDays:30,consecutiveGreenDays:14},
  originalSourceCommit:SOURCE_COMMIT};
 const id=await pinned('period-id:'+network,{network},async()=>randomUUID());
 const saved=await invokeOriginal(operator,'period:'+network,'period.save',{periodId:id,name:definition.name,definition});return saved.period;
}
async function allRows(target,table,args={}){let cursor=null,result=[];const seen=new Set();while(true){
 const page=await target.invoke({method:'records.page',args:{table,...args,limit:1000,...(cursor?{after:cursor}:{})}});result.push(...page.rows);
 if(!page.nextCursor)return result;need(!seen.has(page.nextCursor),'RECORD_CURSOR_STALLED');seen.add(page.nextCursor);cursor=page.nextCursor;
}}
async function runOriginalOperation(name,{connection,action,args={},periodId,periodVersion,vaultId,vaultVersion,correctionId},target=operator){
 const semantic={connection,action,args,...(periodId?{periodId,periodVersion}:{}),...(vaultId?{vaultId,vaultVersion}:{}),...(correctionId?{correctionId}:{})};
 const operationId=await pinned('operation-id:'+name,semantic,async()=>randomUUID());
 let row;try{row=(await target.invoke({method:'operation.read',args:{operationId}})).operation;}catch(e){if(e.code!=='NOT_FOUND')throw e;}
 if(!row?.request){await invokeOriginal(target,'prepare:'+name+':'+sourceIdentity.sha256,'operation.prepare',{operationId,...semantic});row=(await target.invoke({method:'operation.read',args:{operationId}})).operation;}
 need(row.request,'ORIGINAL_NATIVE_PREPARATION_FAILED',{operationId,error:row.lastError,sourceIds:row.sourceIds});
 const deadline=Date.now()+integer('provider-budget-ms',300000,1000,86400000),limit=integer('maximum-provider-pages',100000,1);
 let turns=0;
 while(!controller.signal.aborted&&turns<limit){
  const current=await target.invoke({method:'operation.read',args:{operationId}});row=current.operation;
  if(row.paused)await invokeOriginal(target,'resume:'+name+':'+row.updatedAt,'operation.resume',{operationId});
  if(['COMPLETED','PARTIAL'].includes(row.state)&&!row.nextRequest&&!row.continuationError&&row.pagination?.complete!==false)break;
  if(['FAILED','CANCELED'].includes(row.state)||(row.state==='PARTIAL'&&!row.nextRequest))break;
  const reconcile=['RUNNING','PENDING','UNCERTAIN'].includes(row.state),method=reconcile?'operation.reconcile':'operation.run';
  const last=row.attemptIds.at(-1)??'initial',key=name+':'+method+':'+last;
  await invokeOriginal(target,key,method,{operationId});
  turns++;row=(await target.invoke({method:'operation.read',args:{operationId}})).operation;
  if(row.state==='UNCERTAIN'||(Date.now()>=deadline&&['PENDING','RUNNING'].includes(row.state)))break;
  if(['PENDING','RUNNING'].includes(row.state))await new Promise(resolve=>setTimeout(resolve,500));
 }
 const current=await target.invoke({method:'operation.read',args:{operationId}});
 return {...current,commissioning:{complete:['COMPLETED','PARTIAL'].includes(current.operation.state)&&!current.operation.nextRequest&&!current.operation.continuationError&&current.operation.pagination?.complete!==false,
  originalRequestSha256:current.operation.request?.requestSha256,turns,continuation:current.operation.nextRequest??current.operation.request}};
}
async function readOperationContents(result,target=operator){const values=[];for(const source of result.sources??[]){
 const full=await target.invoke({method:'source.read',args:{sourceId:source.id}});if(full.record.native)values.push(full.record.native.content);
 }return values;}
async function retainedFile(target,method,args,destination){
 const chunks=[],sum=createHash('sha256');let offset=0,first;await privateDirectory(path.dirname(destination));const handle=await fs.open(destination,'w',0o600);
 try{while(true){const part=await target.invoke({method,args:{...args,offset,length:196608}});first??=part;need(part.bytes===first.bytes&&part.sha256===first.sha256,'SOURCE_DOWNLOAD_CHANGED');
  const body=Buffer.from(part.contentBase64,'base64');need(body.length||offset===first.bytes,'SOURCE_DOWNLOAD_INCOMPLETE');await handle.writeFile(body);sum.update(body);offset+=body.length;
  if(offset===first.bytes)break;need(offset<first.bytes,'SOURCE_DOWNLOAD_OVERFLOW');}
  need(sum.digest('hex')===first.sha256,'SOURCE_DOWNLOAD_HASH');await handle.sync();return {path:destination,bytes:offset,sha256:first.sha256,contentType:first.contentType};
 }finally{await handle.close();}
}


async function chooseRuntimeConfiguration(configuration){
 return modules.operator.loadTurbolongOperationsConfiguration({workspaceDirectory:ledger.workspaceDirectory,connections:configuration.connections,profile:configuration.profile,runtimes:configuration.runtimes});
}
async function openOperator(configuration){
 const selected=await chooseRuntimeConfiguration(configuration);
 operator=await modules.operator.openTurbolongOperationsOperator({workspaceDirectory:ledger.workspaceDirectory,configuration:selected,signal:controller.signal,applicationDirectory:sourceDirectory});
 const state=await operator.describe();if(ledger.workspaceId)need(state.workspaceId===ledger.workspaceId,'WORKSPACE_IDENTITY_CHANGED');
 else{ledger.workspaceId=state.workspaceId;await replace(JPATH,ledger);}
 return {workspaceId:state.workspaceId,revision:state.revision,methods:await operator.methods()};
}
async function pauseCollectors(target=operator){
 const selected=await allRows(target,'acquisitions'),results=[];
 for(const row of selected)if(!row.paused||row.desiredState!=='PAUSED')results.push(await invokeOriginal(target,'pause-acquisition:'+row.id+':'+row.updatedAt,'acquisition.pause',{acquisitionId:row.id}));
 return {acquisitions:selected.map(r=>r.id),results};
}
function completeNative(result,label){
 need(result.commissioning.complete&&result.operation.state==='COMPLETED','ORIGINAL_NATIVE_OUTCOME_INCOMPLETE',{label,operationId:result.operation.id,state:result.operation.state,nextRequest:result.operation.nextRequest??null,lastError:result.operation.lastError??null,sourceIds:result.operation.sourceIds});
 return result;
}
async function registerVaults(configuration){
 const result=[];
 for(const definition of configuration.vaults){const id=await pinned('vault-id:'+definition.network+':'+(definition.strategyId??definition.shareTokenId??definition.poolId),definition,async()=>randomUUID());
  const row=await invokeOriginal(operator,'vault:'+id,'vault.save',{vaultId:id,name:definition.name??definition.symbol,definition});result.push({row:row.vault,definition});}
 return result;
}
function findAlias(configuration,network){return configuration.connectionAliases?.[network]??Object.entries(configuration.connections).find(([,c])=>(c.private?.network??c.network)===network)?.[0]??null;}
async function nativeRead(name,selection,required=true){
 return stage('native:'+name,async()=>completeNative(await runOriginalOperation(name,selection),name),{required});
}
async function originalObservations(configuration,periods,vaults,publisher,runtime){
 const outcomes=[],health=new Map(),networkOperations=new Map();
 for(const network of ['mainnet','testnet']){
  const alias=findAlias(configuration,network),period=periods[network];if(!alias||!period)continue;
  const base={connection:alias,periodId:period.id,periodVersion:period.currentVersion};
  const surfaces=await nativeRead(network+':surfaces',{...base,action:'surfaces.inspect',args:{network}},true);outcomes.push(surfaces);
  if(surfaces.ok){const values=await readOperationContents(surfaces.value);for(const content of values)for(const row of content?.rows??[]){
    const provider=row.provider?.result??row.provider;
    if(provider&&Number.isSafeInteger(provider.latestLedger)&&Number.isSafeInteger(provider.oldestLedger))health.set(network,provider);
   }}
  const pool_id=network==='mainnet'?'CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI':'CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW';
  const snapshot=await nativeRead(network+':snapshots',{...base,action:'snapshots.list',args:{network,pool_id,limit:500,...configuration.window}},true);outcomes.push(snapshot);
  let routes=null;
  const routeSelections=network==='mainnet'?[null]:vaults.filter(x=>x.definition.network===network&&x.definition.strategyId).map(x=>x.definition.strategyId);
  for(const strategy_id of routeSelections){const result=await nativeRead(network+':routes:'+(strategy_id??'original-mainnet-worker'),{...base,action:'routes.list',args:{network,...(strategy_id?{strategy_id}:{}),limit:500,...configuration.window}},true);outcomes.push(result);routes??=result;}
  networkOperations.set(network,{base,surfaces,snapshot,routes});
  const trusted={...configuration.connections[alias],...(configuration.connections[alias].private??{})};
  if(runtime&&(trusted.secretFiles?.DEPLOY_SECRET_KEY||trusted.environment?.DEPLOY_SECRET_KEY))outcomes.push(await nativeRead(network+':original-deployment-plan',{...base,action:'deployment.plan',args:{network}},true));
 }
 for(const {row,definition}of vaults){
  const network=definition.network,entry=networkOperations.get(network);if(!entry)continue;
  const base={...entry.base,vaultId:row.id,vaultVersion:row.currentVersion},name=network+':'+row.id;
  if(definition.strategyId)outcomes.push(await nativeRead(name+':vault',{...base,action:'vault.inspect',args:{network,strategyId:definition.strategyId,symbol:definition.symbol}},true));
  if(definition.shareTokenId)outcomes.push(await nativeRead(name+':shares',{...base,action:'vault.shareInspect',args:{network,tokenId:definition.shareTokenId}},true));
  if(definition.strategyId)outcomes.push(await nativeRead(name+':rebalance-probe',{...base,action:'keeper.rebalance.probe',args:{network,vaults:[{symbol:definition.symbol??row.name,strategyId:definition.strategyId}]}},true));
 }
 if(runtime&&networkOperations.has('mainnet')){
  const base=networkOperations.get('mainnet').base;
  outcomes.push(await nativeRead('mainnet:original-harvest-quote',{...base,action:'keeper.harvest.quote',args:{network:'mainnet',telemetry:false}},true));
  outcomes.push(await nativeRead('mainnet:original-routing-report',{...base,action:'routing.report',args:{network:'mainnet'}},true));
  const ratesFile=options['rates-input']??configuration.ratesInput;
  if(ratesFile)outcomes.push(await nativeRead('mainnet:original-rates-project',{...base,action:'rates.project',args:{inputs:await json(path.resolve(ratesFile))}},true));
   outcomes.push(await nativeRead('mainnet:original-rates-simulation',{...base,action:'rates.simulate',args:{}},true));
 }
 for(const [network,observed]of health){
  const entry=networkOperations.get(network),selectedVaults=vaults.filter(x=>x.definition.network===network&&x.definition.strategyId),ids=selectedVaults.map(x=>x.definition.strategyId);
  if(!ids.length)continue;
  const window=await pinned('ledger-window:'+network,{network,sourceSha256:sourceIdentity.sha256},async()=>({startLedger:observed.oldestLedger,endLedger:observed.latestLedger+1,
   observationSourceIds:entry.surfaces.value.operation.sourceIds,observedAt:now()}));
  for(let i=0;i<ids.length;i+=5)outcomes.push(await nativeRead(network+':events:'+i,{...entry.base,action:'events.list',args:{network,startLedger:window.startLedger,endLedger:window.endLedger,limit:10000,filters:[{type:'contract',contractIds:ids.slice(i,i+5)}],...configuration.window}},true));
 }
 for(const [index,history]of configuration.history.entries()){
  const network=history.network??'mainnet',entry=networkOperations.get(network);if(!entry)continue;
  outcomes.push(await nativeRead('original-history:'+index,{...entry.base,action:'keeper.history.import',args:{path:path.resolve(history.path),format:history.format??'jsonl',kind:history.kind,network,...configuration.window}},true));
 }
 const transactionSelections=new Map();
 for(const outcome of outcomes.filter(x=>x.ok)){
  const network=outcome.value.operation.request?.connection?.network??outcome.value.operation.network;
  const actualNetwork=network??(outcome.value.operation.periodId===periods.mainnet?.id?'mainnet':'testnet');
  for(const content of await readOperationContents(outcome.value)){
   const hashes=[...(content?.transactionHashes??[]),...(content?.rows??[]).flatMap(row=>[row.tx_hash,row.transactionHash,row.transaction_hash]).filter(Boolean)];
   for(const hash of hashes)if(typeof hash==='string'&&/^[a-fA-F0-9]{64}$/.test(hash))transactionSelections.set(actualNetwork+':'+hash,{network:actualNetwork,hash});
  }
 }
 for(const {network,hash}of transactionSelections.values()){
  const entry=networkOperations.get(network);if(entry)outcomes.push(await nativeRead(network+':transaction:'+hash,{...entry.base,action:'transaction.inspect',args:{network,hash}},true));
 }
 return {selectedOperations:outcomes.map(x=>x.ok?{operationId:x.value.operation.id,state:x.value.operation.state,complete:x.value.commissioning.complete}:{error:x.error}),
  actualBoundaryObservations:[...health.entries()].map(([network,provider])=>({network,provider})),transactionCount:transactionSelections.size};
}
function configurationTime(){return ledger.createdAt;}
async function importPublishedSource(publisher,period){
 const relativeName='docs/evidence/harvest-router-log.jsonl',file=path.join(publisher.directory,relativeName),descriptor=await originalFile(file);
 const selection={periodId:period.id,periodVersion:period.currentVersion,name:'original-published-harvest-router-log.jsonl',kind:'keeper.harvest',
  contentType:'application/x-ndjson',expectedSha256:descriptor.sha256,observedAt:configurationTime(),
  notes:'Unchanged upstream published evidence at '+SOURCE_COMMIT+'/'+relativeName+'. Native quote_only and QUOTE_ONLY rows remain quote observations, never executed settlement claims.',
  coverage:{kind:'original-published-file',complete:true,repository:'Dgetsylver/TurboLong',commit:SOURCE_COMMIT,path:relativeName}};
 const pinnedRequest=await pinned('published-file-import',selection,async()=>({requestId:randomUUID(),expectedRevision:(await operator.describe()).revision}));
 let args={...selection,...pinnedRequest};
 try{return await operator.importSource(args,{file});}catch(e){if(e.code!=='REVISION_CONFLICT')throw e;
  args.expectedRevision=(await operator.describe()).revision;return operator.importSource(args,{file});}
}
async function collectionCycle(configuration,periods){
 const results=[];
 for(const network of ['mainnet','testnet']){
  const period=periods[network],connection=findAlias(configuration,network);if(!period||!connection)continue;
  const definition={name:network+' original read-only collection',periodId:period.id,periodVersion:period.currentVersion,cadenceSeconds:900,
   queries:[{name:'Original health observation',connection,action:'surfaces.inspect',args:{network}},
    {name:'Full native snapshot history',connection,action:'snapshots.list',args:{network,pool_id:network==='mainnet'?'CDMAVJPFXPADND3YRL4BSM3AKZWCTFMX27GLLXCML3PD62HEQS5FPVAI':'CAPBMXIQTICKWFPWFDJWMAKBXBPJZUKLNONQH3MLPLLBKQ643CYN5PRW',limit:500,...configuration.window}},
    ...(network==='mainnet'?[{name:'Original retained route window',connection,action:'routes.list',args:{network,limit:500,...configuration.window}}]:
     configuration.vaults.filter(x=>x.network===network&&x.strategyId).map(x=>({name:'Selected original strategy route window',connection,action:'routes.list',args:{network,strategy_id:x.strategyId,limit:500,...configuration.window}})))]};
  const id=await pinned('acquisition-id:'+network,{network},async()=>randomUUID());
  const saved=await invokeOriginal(operator,'acquisition-save:'+network,'acquisition.save',{acquisitionId:id,definition});
  const result=await invokeOriginal(operator,'acquisition-cycle:'+id,'acquisition.run',{acquisitionId:id,version:saved.acquisition.currentVersion});
  const current=await operator.invoke({method:'acquisition.read',args:{acquisitionId:id}});
  await invokeOriginal(operator,'acquisition-pause:'+id+':'+current.acquisition.updatedAt,'acquisition.pause',{acquisitionId:id});
  results.push({result,acquisition:current.acquisition});
 }
 need(results.every(x=>x.result.complete===true),'ORIGINAL_COLLECTION_INCOMPLETE',{cycles:results.map(x=>({acquisitionId:x.acquisition.id,execution:x.acquisition.execution,continuation:x.result.continuation}))});
 return {cycles:results,note:'One original commissioning cycle, with retained continuation where needed; a 14-day unattended operating period is not inferred.'};
}
async function actualIncidents(periods){
 const operations=await allRows(operator,'operations'),results=[];
 for(const row of operations){if(!['FAILED','UNCERTAIN','PENDING','PARTIAL'].includes(row.state)&&!row.continuationError)continue;
  const periodId=row.periodId;if(!periodId)continue;
  const incidentId=await pinned('incident:'+row.id,{operationId:row.id},async()=>randomUUID());
  const result=await invokeOriginal(operator,'incident:'+row.id+':'+row.state+':'+row.updatedAt,'incident.save',{incidentId,incident:{periodId,periodVersion:row.periodVersion,
   title:'Original '+row.action+' outcome '+row.state,status:'INVESTIGATING',severity:'warning',sourceIds:row.sourceIds,
   note:'Original operation '+row.id+' remains '+row.state+'. Provider error or process uncertainty is retained; no successful settlement inferred.',operationIds:[row.id]}});
  results.push(result.incident);
 }
 return {incidents:results};
}
async function explicitCorrections(configuration,periods){
 if(!bool('execute-corrections',false))return {selected:configuration.corrections.length,executed:0,reason:'Native financial corrective dispatch was not selected.'};
 const results=[];
 for(const [index,selection]of configuration.corrections.entries()){
  need(selection&&['keeper.rebalance.execute','keeper.harvest.execute'].includes(selection.action),'EXPLICIT_CORRECTION_REQUIRED');
  const connection=selection.connection,network=configuration.connections[connection]?.private?.network??configuration.connections[connection]?.network,period=periods[network];
  need(period,'CORRECTION_PERIOD_REQUIRED');
  const correctionId=await pinned('explicit-correction:'+index,selection,async()=>randomUUID());
  await invokeOriginal(operator,'correction-save:'+correctionId,'correction.save',{correctionId,correction:{periodId:period.id,periodVersion:period.currentVersion,
   title:selection.title??'Operator-selected original '+selection.action,status:'IN_PROGRESS',sourceIds:selection.sourceIds??[],incidentIds:selection.incidentIds??[],
   note:selection.reason??'Explicit original native corrective operation selected in private configuration.'}});
  const original=await runOriginalOperation('explicit-correction:'+index,{connection,action:selection.action,args:selection.args,periodId:period.id,periodVersion:period.currentVersion,correctionId});
  await invokeOriginal(operator,'correction-outcome:'+correctionId+':'+original.operation.state,'correction.save',{correctionId,correction:{periodId:period.id,periodVersion:period.currentVersion,
   title:selection.title??'Operator-selected original '+selection.action,status:'AWAITING_OUTCOME',sourceIds:original.operation.sourceIds,operationIds:[original.operation.id],incidentIds:selection.incidentIds??[],
   note:'Original native '+original.operation.state+' response retained. Verified implementation requires its original chain/operating evidence, not this process receipt alone.'}});
  results.push(original);
 }return {selected:configuration.corrections.length,executed:results.length,results};
}
async function createReports(periods){
 const results=[];
 for(const [network,period]of Object.entries(periods)){
  const sourceIds=(await allRows(operator,'sources',{periodId:period.id})).map(x=>x.id);
  const analysis=await invokeOriginal(operator,'analysis:'+network+':'+sha(bytes(sourceIds)),'analysis.create',{periodId:period.id,periodVersion:period.currentVersion,name:'Original '+network+' operating-period review',sourceIds});
  need(analysis.analysis.state==='COMPLETE','ANALYSIS_INCOMPLETE');
  const record=await operator.invoke({method:'analysis.read',args:{analysisId:analysis.analysis.id}});
  const report=await invokeOriginal(operator,'report:'+analysis.analysis.id,'report.create',{analysisId:analysis.analysis.id,name:'Turbolong '+network+' original evidence',formats:['html','json','csv']});
  need(report.report.state==='COMPLETE','REPORT_INCOMPLETE');
  const members=[];for(const f of report.report.files)members.push(await retainedFile(operator,'report.file',{reportId:report.report.id,filename:f.filename},path.join(ROOT,'reports',report.report.id,f.filename)));
  results.push({network,analysis:record,report:report.report,members});
 }return results;
}


function serverHeaders(selected){const token=new URLSearchParams(new URL(selected.startup.url).hash.slice(1)).get('token');need(token,'OPERATOR_TOKEN_MISSING');
 return {Authorization:'Bearer '+token,'X-Turbolong-Workspace-ID':selected.startup.workspaceId};}
async function httpJSON(selected,route,{method='GET',body,headers={}}={}){
 const response=await fetch(selected.startup.origin+route,{method,headers:{...serverHeaders(selected),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
 const raw=Buffer.from(await response.arrayBuffer());let value;try{value=JSON.parse(raw);}catch{value={bodyBase64:raw.toString('base64')};}
 return {status:response.status,ok:response.ok,headers:Object.fromEntries(response.headers),bodySha256:sha(raw),bytes:raw.length,value};
}
async function startHost(configuration){
 await pauseCollectors();await operator.close();operator=null;
 server=await modules.server.startTurbolongOperationsServer({workspaceDirectory:ledger.workspaceDirectory,configuration:await chooseRuntimeConfiguration(configuration),port:integer('port',8779,0,65535),
  applicationDirectory:sourceDirectory,deliveryDirectory:path.join(ROOT,'host-inbox'),signal:controller.signal});
 operator=server.operator;await replace(path.join(ROOT,'private','startup.json'),server.startup);
 return server.startup;
}
async function hostIdentity(selected){
 const bootstrap=await httpJSON(selected,'/api/bootstrap');need(bootstrap.ok&&bootstrap.value.state.workspaceId===selected.startup.workspaceId,'HTTP_BOOTSTRAP_IDENTITY');
 need(Array.isArray(bootstrap.value.methods)&&Array.isArray(bootstrap.value.catalogue.actions),'HTTP_NATIVE_CATALOGUE');
 const current=await selected.operator.describe(),before=current.revision;
 const rejected=await httpJSON(selected,'/api/invoke',{method:'POST',body:{method:'profile.save',args:{requestId:randomUUID(),expectedRevision:before,profile:current.profile}},headers:{'X-Turbolong-Workspace-ID':randomUUID()}});
 need(!rejected.ok&&(await selected.operator.describe()).revision===before,'HTTP_WORKSPACE_GUARD_FAILED');
 const html=await fetch(selected.startup.origin+'/',{signal:controller.signal});need(html.ok,'OPERATOR_HTML_FAILED');const body=await html.text();
 need(body.includes('profile-form')&&body.includes('source-form'),'OPERATOR_HTML_INCOMPLETE');
 return {bootstrap,rejected,html:{bytes:Buffer.byteLength(body),sha256:sha(Buffer.from(body))}};
}
async function browserEngine(){
 let selected;
 const choices=options['playwright-module']?[path.resolve(options['playwright-module'])]:['playwright','playwright-core'];
 const failures=[];
 for(const choice of choices)try{
  const candidate=path.isAbsolute(choice)?pathToFileURL(choice).href:choice,loaded=await import(candidate);selected=loaded.chromium??loaded.default?.chromium;if(selected)break;
 }catch(e){failures.push({choice,error:errorValue(e)});}
 need(selected,'ORIGINAL_BROWSER_RUNTIME_REQUIRED',{failures});
 const executable=options['chromium-executable']?path.resolve(options['chromium-executable']):undefined;
 if(executable)need((await fs.stat(executable)).isFile(),'ORIGINAL_BROWSER_EXECUTABLE_REQUIRED');
 browser=await selected.launch({headless:true,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
 return browser;
}
async function browserReady(page,selected){
 await page.goto(selected.startup.url,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>document.querySelector('#active-period')?.options.length>0,{},{timeout:60000});
 await page.waitForFunction(()=>document.querySelector('#status')?.textContent==='Operating workspace opened.',{},{timeout:60000});
}
async function waitUntil(predicate,code,timeout=60000){const deadline=Date.now()+timeout;while(Date.now()<deadline){
 const result=await predicate();if(result)return result;await new Promise(resolve=>setTimeout(resolve,200));}throw Object.assign(new Error(code),{code});}
async function browserJournal(page,id){return page.evaluate(id=>new Promise((resolve,reject)=>{const request=indexedDB.open('stellar-turbolong-operations',1);request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('requests','readonly'),read=tx.objectStore('requests').getAll();read.onerror=()=>{db.close();reject(read.error);};read.onsuccess=()=>{const row=read.result.map(x=>x.value).find(x=>x.id===id);db.close();resolve(row?{id:row.id,state:row.state,appliedAt:row.appliedAt??null,args:row.args,attempts:row.attempts,result:row.result,fileSelection:row.fileSelection}:null);};};}),id);}
async function browserViews(selected,{reportId,allowWrites=false,publisher,period}={}){
 const engine=browser??await browserEngine(),context=await engine.newContext({acceptDownloads:true}),page=await context.newPage(),errors=[];
 page.on('pageerror',e=>errors.push(errorValue(e)));const steps=[];await browserReady(page,selected);
 for(const tab of ['overview','periods','acquisitions','operations','sources','incidents','reports','receiving','recovery','settings']){
  await page.locator('nav [data-tab="'+tab+'"]').click();await page.locator('[data-panel="'+tab+'"]').waitFor({state:'visible'});steps.push({tab,visible:true});
 }
 const profileResult={},uploadResult={};
 if(allowWrites){
  const profile={...(await selected.operator.describe()).profile,commissioningObservation:'Original browser same-UUID recovery '+ledger.id};
  let observed=null,intercepted=false;
  const handler=async route=>{
   const body=route.request().postDataJSON();if(body?.method!=='profile.save'||intercepted)return route.continue();
   intercepted=true;const response=await route.fetch();const native=await response.json();observed={requestId:body.args.requestId,args:body.args,status:response.status(),result:native};
   await route.abort('failed');
  };
  await page.route('**/api/invoke',handler);await page.locator('nav [data-tab="settings"]').click();
  await page.locator('#profile-json').fill(JSON.stringify(profile,null,2));await page.locator('#profile-form').locator('button[type=submit]').click();
  await waitUntil(()=>observed,'BROWSER_PROFILE_DISPATCH_NOT_OBSERVED');need(observed.status>=200&&observed.status<300,'BROWSER_PROFILE_SERVER_REJECTED',observed);
  await exact(path.join(ROOT,'browser','profile-original-'+observed.requestId+'.json'),bytes(observed));
  await page.unroute('**/api/invoke',handler);await page.reload({waitUntil:'domcontentloaded'});
  await waitUntil(async()=>{const state=await selected.operator.describe();return state.profile.commissioningObservation===profile.commissioningObservation;},'BROWSER_PROFILE_RECOVERY_FAILED');
  await page.locator('nav [data-tab="recovery"]').click();
  const profileJournal=await waitUntil(async()=>{const row=await browserJournal(page,observed.requestId);return row?.state==='COMPLETE'&&row.appliedAt&&row.attempts.length>=2?row:null;},'BROWSER_PROFILE_SAME_REQUEST_NOT_RECOVERED');
  profileResult.journal=profileJournal;
  profileResult.original=observed;profileResult.recoveredProfile=(await selected.operator.describe()).profile;
  if(publisher&&period){
   const originalFilePath=path.join(publisher.directory,'docs/evidence/harvest-router-log.jsonl'),original=await originalFile(originalFilePath);
   let upload=null,interceptedUpload=false;
   const uploadHandler=async route=>{
    if(interceptedUpload)return route.continue();interceptedUpload=true;
    const u=new URL(route.request().url()),args=JSON.parse(u.searchParams.get('args'));
    const response=await route.fetch();upload={requestId:args.requestId,args,status:response.status(),result:await response.json()};await route.abort('failed');
   };
   await page.route('**/api/source-import?*',uploadHandler);await page.locator('nav [data-tab="sources"]').click();
   await page.locator('#active-period').selectOption(period.id);await page.waitForTimeout(250);await page.locator('#source-form [name=periodId]').selectOption(period.id);await page.locator('#source-form [name=periodVersion]').fill(String(period.currentVersion));
   await page.locator('#source-form [name=kind]').selectOption('keeper.harvest');
   await page.locator('#source-form [name=coverage]').fill(JSON.stringify({kind:'original-published-file',complete:true,commit:SOURCE_COMMIT,path:'docs/evidence/harvest-router-log.jsonl'}));
   await page.locator('#source-form [name=notes]').fill('Original published quote_only evidence; retained unchanged for File response-loss recovery. It does not assert executed harvests.');
   await page.locator('#source-form input[name=file]').setInputFiles(originalFilePath);
   await page.locator('#source-form').locator('button[type=submit]').click();
   await waitUntil(()=>upload,'BROWSER_SOURCE_DISPATCH_NOT_OBSERVED');need(upload.status>=200&&upload.status<300,'BROWSER_SOURCE_SERVER_REJECTED',upload);
   need(upload.args.expectedSha256===original.sha256,'BROWSER_SOURCE_DIGEST_CHANGED');
   await exact(path.join(ROOT,'browser','source-original-'+upload.requestId+'.json'),bytes(upload));
   await page.unroute('**/api/source-import?*',uploadHandler);await page.reload({waitUntil:'domcontentloaded'});
   const restored=await waitUntil(async()=>{const rows=await allRows(selected.operator,'sources');return rows.find(x=>x.id===upload.requestId);},'BROWSER_FILE_RECOVERY_FAILED');
   need(restored.body.sha256===original.sha256&&restored.body.bytes===original.bytes,'BROWSER_FILE_BYTES_CHANGED');
   await page.locator('nav [data-tab="recovery"]').click();uploadResult.journal=await waitUntil(async()=>{const row=await browserJournal(page,upload.requestId);return row?.state==='COMPLETE'&&row.appliedAt&&row.attempts.length>=2?row:null;},'BROWSER_FILE_SAME_REQUEST_NOT_RECOVERED');
   uploadResult.original=upload;uploadResult.retained=restored;
  }
 }
 if(reportId){
  const selectedReport=await selected.operator.invoke({method:'report.read',args:{reportId}});
  await page.locator('#active-period').selectOption(selectedReport.report.periodId);await page.waitForTimeout(300);
  await page.locator('nav [data-tab="reports"]').click();
  const row=page.locator('#reports-table tr').filter({hasText:reportId});
  if(await row.count()){const buttons=row.locator('button');if(await buttons.count())await buttons.first().click();}
  else{
   const report=await selected.operator.invoke({method:'report.read',args:{reportId}});
   const byName=page.locator('#reports-table tr').filter({hasText:report.report.name});await byName.first().waitFor({state:'visible',timeout:60000});await byName.first().locator('button').first().click();
  }
  await page.locator('#report-selected').waitFor({state:'visible'});const preview=page.locator('#report-members button').filter({hasText:'Preview'});
  need(await preview.count(),'BROWSER_REPORT_PREVIEW_MISSING');await preview.first().click();await page.locator('#report-preview').waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#report-preview')?.contentDocument?.body?.textContent?.length>100,{},{timeout:60000});
  steps.push({reportId,reportPreview:true});
 }
 const screenshot=path.join(ROOT,'browser',sha(Buffer.from(selected.startup.origin+':'+sourceIdentity.sha256+(allowWrites?':write':':receive')))+'.png');
 await privateDirectory(path.dirname(screenshot));await page.screenshot({path:screenshot,fullPage:true});
 const result={steps,profile:profileResult,upload:uploadResult,screenshot:await originalFile(screenshot),pageErrors:errors};
 await context.close();need(!errors.length,'BROWSER_PAGE_ERROR',result);return result;
}
async function exportAndReceive(configuration,reports){
 await pauseCollectors();const liveSnapshot=await operator.workspace.readState();
 const exportSelection=await pinned('workspace-delivery:'+sourceIdentity.sha256,{sourceSha256:sourceIdentity.sha256},async()=>({requestId:randomUUID(),destination:path.join(ROOT,'deliveries',sourceIdentity.sha256,'workspace')}));
 const exported=await invokeOriginal(operator,'full-export:'+sourceIdentity.sha256,'workspace.export',{destination:exportSelection.destination,name:'Turbolong complete original operating workspace',includeApplication:true});
 need(exported.directory&&exported.manifestSha256,'NATIVE_EXPORT_DESCRIPTOR');
 const inspected=await modules.receiving.inspectTurbolongDelivery({sourceDirectory:exported.directory,expectedManifestSha256:exported.manifestSha256});
 need(inspected.manifest.workspaceId===liveSnapshot.workspaceId&&inspected.manifest.application,'FULL_APPLICATION_MISSING');
 const snapshot=await json(path.join(exported.directory,'workspace','state.json'));need(snapshot.revision===inspected.manifest.workspaceRevision&&snapshot.head===inspected.manifest.workspaceHead,'PINNED_EXPORT_STATE_CHANGED');
 const archivePath=path.join(ROOT,'deliveries',sourceIdentity.sha256,'workspace.tar.gz');await privateDirectory(path.dirname(archivePath));
 if(!await exists(archivePath)){const temporary=archivePath+'.pending-'+randomUUID();
  await pipeline(await modules.archive.streamTurbolongDelivery({sourceDirectory:exported.directory,expectedManifestSha256:exported.manifestSha256,signal:controller.signal}),createWriteStream(temporary,{flags:'wx',mode:0o600}));
  const handle=await fs.open(temporary,'r');try{await handle.sync();}finally{await handle.close();}await fs.link(temporary,archivePath);await fs.unlink(temporary);await syncDir(path.dirname(archivePath));
 }
 const archive=await originalFile(archivePath),unpacked=await modules.archive.unpackTurbolongDelivery({input:createReadStream(archivePath),destination:path.join(ROOT,'unpacked',sourceIdentity.sha256),expectedManifestSha256:exported.manifestSha256,signal:controller.signal});
 need(unpacked.manifestSha256===exported.manifestSha256,'ARCHIVE_MANIFEST_CHANGED');
 const receiveSelection=await pinned('independent-receive:'+sourceIdentity.sha256,{manifestSha256:exported.manifestSha256},async()=>({requestId:randomUUID(),destination:path.join(ROOT,'received',sourceIdentity.sha256)}));
 const received=await modules.receiving.receiveTurbolongDelivery({sourceDirectory:unpacked.sourceDirectory??unpacked.directory,...receiveSelection,expectedManifestSha256:exported.manifestSha256});
 const replay=await modules.receiving.receiveTurbolongDelivery({sourceDirectory:unpacked.sourceDirectory??unpacked.directory,...receiveSelection,expectedManifestSha256:exported.manifestSha256});
 need(replay.replayed===true&&received.workspace.workspaceId===snapshot.workspaceId,'RECEIVING_REPLAY_IDENTITY');
 const receivedOperatorModule=await import(pathToFileURL(path.join(path.dirname(received.application.server),'operator.mjs')).href);
 const privateConnections=clone(configuration.connections);
 for(const [alias,connection]of Object.entries(privateConnections)){
  const selected={...connection,...(connection.private??{})},old=selected.runtime??selected,runtimePin=configuration.runtimes.find(x=>x.directory===(old.runtimeDirectory??old.directory??selected.runtimeDirectory));
  const incoming=received.runtimes.find(x=>!runtimePin||x.manifestSha256===runtimePin.expectedManifestSha256);
  if(incoming){
   const target=connection.private??connection;target.runtime={runtimeDirectory:incoming.directory,expectedManifestSha256:incoming.manifestSha256};
   delete target.runtimeDirectory;delete target.installationDirectory;target.executionDirectory=path.join(ROOT,'received-executions',sourceIdentity.sha256,alias);
  }
 }
 const receivedConfig=await receivedOperatorModule.loadTurbolongOperationsConfiguration({workspaceDirectory:received.workspace.directory,connections:privateConnections,profile:configuration.profile,
  runtimes:received.runtimes.map(x=>({directory:x.directory,expectedManifestSha256:x.manifestSha256}))});
 const receivedServerModule=await import(pathToFileURL(received.application.server).href);
 receivedServer=await receivedServerModule.startTurbolongOperationsServer({workspaceDirectory:received.workspace.directory,configuration:receivedConfig,expectedWorkspaceId:received.workspace.workspaceId,
  host:'127.0.0.1',port:0,applicationDirectory:path.dirname(received.application.server),deliveryDirectory:path.join(ROOT,'received-inbox',sourceIdentity.sha256),signal:controller.signal});
 await replace(path.join(ROOT,'private','received-startup-'+sourceIdentity.sha256+'.json'),receivedServer.startup);
 const after=await receivedServer.operator.workspace.readState();
 for(const [id,original]of Object.entries(snapshot.operations)){
  const retained=after.operations[id];need(retained,'RECEIVED_OPERATION_MISSING',{id});
  need(canonical(retained.request)===canonical(original.request)&&canonical(retained.nextRequest)===canonical(original.nextRequest)&&canonical(retained.attemptIds)===canonical(original.attemptIds),'RECEIVED_NATIVE_IDENTITY_CHANGED',{id});
  const terminal=['COMPLETED','FAILED','CANCELED'].includes(original.state)&&!original.nextRequest;
  if(!terminal&&!(original.state==='PARTIAL'&&!original.nextRequest&&!original.continuationError&&original.pagination?.complete!==false))need(retained.paused===true,'RECEIVED_OPERATION_NOT_PAUSED',{id});
 }
 for(const [id,original]of Object.entries(snapshot.sources)){const retained=after.sources[id];need(retained&&retained.file.sha256===original.file.sha256,'RECEIVED_SOURCE_CHANGED',{id});}
 const http=await hostIdentity(receivedServer),readReports=[];
 for(const selected of reports??[]){
  const read=await receivedServer.operator.invoke({method:'report.read',args:{reportId:selected.report.id}});need(read.report.file.sha256===selected.report.file.sha256,'RECEIVED_REPORT_CHANGED');
  for(const f of read.report.files)readReports.push(await retainedFile(receivedServer.operator,'report.file',{reportId:read.report.id,filename:f.filename},path.join(ROOT,'received-report-files',sourceIdentity.sha256,read.report.id,f.filename)));
 }
 const browserOutcome=await stage('received-browser',()=>browserViews(receivedServer,{reportId:reports?.[0]?.report.id}),{required:true,force:true});
 return {exported,manifest:{sha256:inspected.manifestSha256,files:inspected.manifest.files.length,runtimes:inspected.manifest.runtimes?.length},archive,
  unpacked:{directory:unpacked.sourceDirectory??unpacked.directory,manifestSha256:unpacked.manifestSha256},received,replay:{replayed:replay.replayed,workspaceId:replay.workspace.workspaceId},
  originalRevision:snapshot.revision,receivedRevision:after.revision,originalSources:Object.keys(snapshot.sources).length,http,readReports,browser:browserOutcome};
}
async function exportReportOnly(report){
 const destination=path.join(ROOT,'report-deliveries',sourceIdentity.sha256,report.id);
 const result=await invokeOriginal(operator,'report-export:'+report.id,'report.export',{reportId:report.id,destination,includeApplication:false,name:report.name});
 const inspected=await modules.receiving.inspectTurbolongDelivery({sourceDirectory:result.directory,expectedManifestSha256:result.manifestSha256});
 need(inspected.manifest.kind==='report'&&!(inspected.manifest.runtimes??[]).length,'SCOPED_REPORT_RUNTIME_LEAK');
 need(!inspected.manifest.files.some(f=>f.path.startsWith('workspace/')),'SCOPED_REPORT_RAW_SOURCE_LEAK');
 const requestId=await pinned('report-receive:'+report.id,{manifestSha256:result.manifestSha256},async()=>randomUUID());
 const received=await modules.receiving.receiveTurbolongDelivery({sourceDirectory:result.directory,destination:path.join(ROOT,'report-received',sourceIdentity.sha256,report.id),requestId,expectedManifestSha256:result.manifestSha256});
 need(!received.workspace&&!received.application&&received.report,'SCOPED_REPORT_RECEIVE');
 return {exported:result,received,files:inspected.manifest.files.map(f=>({path:f.path,bytes:f.bytes,sha256:f.sha256}))};
}


async function courier(){
 const reader=createInterface({input:process.stdin,crlfDelay:Infinity});progress('COURIER_READY',{directory:ROOT,ledger:path.join(ROOT,'operation.json'),result:ledger.finalResult??null});
 for await(const line of reader){let request;try{request=JSON.parse(line);if(request.action==='close'){process.stdout.write(JSON.stringify({courier:request.id??null,closed:true})+'\n');break;}
  need(['stat','read'].includes(request.action),'COURIER_ACTION_REQUIRED');relative(request.path);const selected=path.join(ROOT,request.path);need(within(ROOT,selected),'COURIER_PATH_OUTSIDE_OPERATION');const real=await fs.realpath(selected);
  need(real===ROOT||real.startsWith(ROOT+path.sep),'COURIER_PATH_OUTSIDE_OPERATION');
  const descriptor=await originalFile(real);if(request.action==='stat'){process.stdout.write(JSON.stringify({courier:request.id??null,...descriptor,path:request.path})+'\n');continue;}
  const offset=request.offset??0,length=request.length??196608;need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(length)&&length>=0&&length<=1048576,'COURIER_RANGE_INVALID');
  const handle=await fs.open(real,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const buffer=Buffer.alloc(Math.min(length,Math.max(0,descriptor.bytes-offset))),read=await handle.read(buffer,0,buffer.length,offset);
   process.stdout.write(JSON.stringify({courier:request.id??null,path:request.path,offset,bytes:descriptor.bytes,sha256:descriptor.sha256,bodyBase64:buffer.subarray(0,read.bytesRead).toString('base64'),done:offset+read.bytesRead===descriptor.bytes})+'\n');
  }finally{await handle.close();}
 }catch(error){process.stdout.write(JSON.stringify({courier:request?.id??null,error:errorValue(error)})+'\n');}}
}
async function finalOutput(){
 const selected=Object.values(ledger.stages).filter(row=>row.sourceSha256===sourceIdentity?.sha256||row.sourceSha256===null),required=selected.filter(x=>x.required),failed=required.filter(x=>x.state!=='COMPLETE');
 const summary={schema:SCHEMA,operationId:ledger.id,source:sourceIdentity,workspaceDirectory:ledger.workspaceDirectory,workspaceId:ledger.workspaceId??null,
  state:failed.length?'INCOMPLETE':'COMPLETE',observedAt:now(),stages:selected.map(row=>({key:row.key,state:row.state,required:row.required,result:row.result??null,
   attempts:row.attempts.map(a=>({index:a.index,state:a.state,error:a.error??null,result:a.result??null}))})),
  requiredFailures:failed.map(x=>({stage:x.key,error:x.attempts.at(-1)?.error??null})),
  evidenceBoundary:'Actual original source, provider responses, process receipts and browser results are retained. Milestone acceptance comes only from original dated operating evidence; a commissioning pass does not establish an unattended operating period.'};
 const file=path.join(ROOT,'results','commissioning-'+(sourceIdentity?.sha256??'unselected')+'-'+Date.now()+'.json'),saved=await exact(file,bytes(summary));
 ledger.finalResult={...saved,path:path.relative(ROOT,file)};ledger.updatedAt=now();await replace(JPATH,ledger);progress('NATIVE_RESULT',{state:summary.state,file:ledger.finalResult,requiredFailures:summary.requiredFailures});
 return summary;
}
let fatal=null,configuration=null,publisher=null,runtime=null,periods={},vaults=[],reports=[];
try{
 const material=await materializeApplication();progress('original-source',{state:'COMPLETE',...material});
 await stage('application-source-and-syntax',async()=>material);
 await stage('native-cli-help',async()=>command('original-cli-help:'+sourceIdentity.sha256,options['node-executable']??process.execPath,[path.join(sourceDirectory,'cli.mjs'),'--help']));
 const publisherResult=await stage('original-publisher-source',()=>materializePublisher(),{sourceBound:false});
 if(publisherResult.ok)publisher=publisherResult.value;
 const runtimeResult=await stage('original-runtime',async()=>{need(publisher,'ORIGINAL_SOURCE_UNAVAILABLE');return prepareRuntime(publisher);});
 if(runtimeResult.ok){runtime=runtimeResult.value;await stage('independent-runtime-reconstruction',()=>regularRuntime(runtime));}
 const configured=await stage('private-configuration',()=>readConfiguration(publisher,runtime),{force:true});need(configured.ok,'CONFIGURATION_UNAVAILABLE');configuration=configured.value;
 await stage('operator-open',()=>openOperator(configuration),{force:true});
 need(operator,'OPERATOR_UNAVAILABLE');
 await stage('original-catalogue',async()=>{const state=await operator.describe(),catalogue=await operator.invoke({method:'catalogue',args:{}}),methods=await operator.methods();
  const actions=Array.isArray(catalogue)?catalogue:catalogue.actions;need(Array.isArray(actions)&&actions.length>=16,'NATIVE_CATALOGUE_INCOMPLETE');
  return {state,methods,catalogue};},{force:true});
 for(const network of ['mainnet','testnet'])if(findAlias(configuration,network)){
  const result=await stage('period:'+network,()=>savePeriod(network,configuration));if(result.ok)periods[network]=result.value;
 }
 const vaultResult=await stage('original-vault-register',()=>registerVaults(configuration));if(vaultResult.ok)vaults=vaultResult.value;
 if(publisher&&periods.mainnet)await stage('original-published-source-import',()=>importPublishedSource(publisher,periods.mainnet));
 await stage('original-observations',()=>originalObservations(configuration,periods,vaults,publisher,runtime),{force:true});
 await stage('complete-original-collection-cycle',()=>collectionCycle(configuration,periods),{force:true});
 await stage('actual-native-outcome-incidents',()=>actualIncidents(periods),{force:true});
 await stage('explicit-native-corrections',()=>explicitCorrections(configuration,periods),{force:true});
 const reportResult=await stage('operating-analysis-and-report',()=>createReports(periods),{force:true});if(reportResult.ok)reports=reportResult.value;
 await stage('pause-original-collectors',()=>pauseCollectors(),{force:true});
 await stage('original-http-host',()=>startHost(configuration),{force:true});
 if(server){
  await stage('native-http-identity',()=>hostIdentity(server),{force:true});
  await stage('actual-browser-response-recovery',()=>browserViews(server,{reportId:reports[0]?.report.id,allowWrites:true,publisher,period:periods.mainnet??periods.testnet}),{force:true});
 }
 const refreshedReports=await stage('post-browser-operating-report',()=>createReports(periods),{force:true});if(refreshedReports.ok)reports=refreshedReports.value;
 for(const selected of reports)await stage('scoped-report-receiving:'+selected.report.id,()=>exportReportOnly(selected.report));
 await stage('complete-workspace-archive-independent-receiving',()=>exportAndReceive(configuration,reports),{force:true});
}catch(error){fatal=errorValue(error);await exact(path.join(ROOT,'failures','fatal-'+Date.now()+'.json'),bytes(fatal));progress('FATAL',{error:fatal});}
finally{
 if(browser){await browser.close().catch(e=>progress('browser-close',{error:errorValue(e)}));browser=null;}
 if(!bool('keep-server',false)){
  if(receivedServer)await receivedServer.close().catch(e=>progress('received-host-close',{error:errorValue(e)}));
  if(server){await server.close().catch(e=>progress('host-close',{error:errorValue(e)}));operator=null;}
  if(operator)await operator.close().catch(e=>progress('operator-close',{error:errorValue(e)}));
 }
 if(!fatal){const oldFatal=(sourceIdentity?.sha256??'unselected')+':fatal';if(ledger.stages[oldFatal]){ledger.stages[oldFatal].state='COMPLETE';ledger.stages[oldFatal].resolvedAt=now();}}
 if(fatal){const key=(sourceIdentity?.sha256??'unselected')+':fatal',attempt={index:1,state:'FAILED',error:fatal,finishedAt:now()};
  ledger.stages[key]={key:'fatal',sourceSha256:sourceIdentity?.sha256??null,required:true,state:'FAILED',attempts:[attempt]};await replace(JPATH,ledger);}
 const final=await finalOutput();process.exitCode=final.state==='COMPLETE'?0:2;
 try{if(bool('courier-stdin',false))await courier();
  else if(bool('keep-server',false)&&!controller.signal.aborted)await new Promise(resolve=>controller.signal.addEventListener('abort',resolve,{once:true}));
 }finally{
  if(receivedServer)await receivedServer.close().catch(()=>{});
  if(server)await server.close().catch(()=>{});
  if(operator)await operator.close().catch(()=>{});
  await release();
 }
}
