#!/usr/bin/env node
// MIT. Complete operator receiving over the original completed 7A2F fleet case.
import assert from 'node:assert/strict';
import {constants,createReadStream} from 'node:fs';
import {readFile,open,mkdir,lstat,realpath,readdir,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,join,dirname,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const SCHEMA='stellar-forge.fleet-operator-receiving.v1';
const ORIGINAL='SCF-MANAGED-FLEET-RECOVERY-RECEIVING-7A2F-20261012';
const BASE='stellar/scf-starforge-20261009/';
const WORKSPACE=BASE+'sf101-merchant-recovery/workspace/';
const PRODUCT_COMMIT='8a31d674ccc626f9c47e0982e0e66c4e801bae73';
const HERE=fileURLToPath(import.meta.url);
const PRODUCT_PINS={
 'model.mjs':'04436e5c5ddbc39324b52d3810ee23d8e72af172',
 'app.mjs':'b702d73a790a910c7f10b33f605dbfb28f872da2',
 'index.html':'5ed696799b6c315d59595e381adbcd2dfa057e22',
 'GUIDE.md':'d87ff1945c56bf08f3932cdf5e1f6813cd06de13',
 'fleet.mjs':'d04acaa840fe38666147e7f655fdb2f4c857d5bd',
 'FLEET_ADAPTER.md':'f6e2ba73ae2e9478c2f5059ab8078de12058b635',
 'cli.mjs':'c8ae8171eb31f4722629b816896545a0ce396aac',
 'merchant-client.mjs':'8b5e073d6ff414759ebb7af4e9e3f1b5f997f4a5',
 'merchant-client.d.mts':'cf816fae9f10018a5aa8ae4dbbe32689beb7d22c',
 'merchant-catalog.mjs':'8e96c00332725253740e1a88bf28b24de53c8ab0',
 'merchant-provider.mjs':'ebbd4aa90a30ddaac27f925522b9bc02e96f3671',
 'MCP.md':'751c42c6718ccb97c5578c4f3c6d46cd54227462',
 'server.mjs':'41e12d41b78ab916d7e1aeb7523090ff258ec75a',
 'connection.mjs':'1d1d8383bffdb2f358061098382b79ad76de93fd',
 'style.css':'de7e408731f1613bc95f6cd9254c21177dea97b5',
 'browser-assets.json':'15c2d4908bd768b1b7a7c8fdf335782e2683468c'
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const gitBlob=bytes=>createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex');
const now=()=>new Date().toISOString();
const sleep=ms=>new Promise(done=>setTimeout(done,ms));
const clone=value=>structuredClone(value);
function stable(value){return JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?
 Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);}
const equal=(a,b,message)=>assert.equal(stable(a),stable(b),message);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const inside=(root,path)=>{const r=relative(root,path);return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));};
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path,{create=false}={}){
 if(create)await mkdir(path,{recursive:true,mode:0o700});
 const s=await lstat(path);assert(s.isDirectory()&&!s.isSymbolicLink()&&!(s.mode&0o077),'Use an original private directory: '+path);
 assert.equal(await realpath(path),path,'Use the canonical original path');
 assert.equal(s.uid,process.getuid());assert.equal(s.gid,process.getgid());
}
async function syncDirectory(path){const f=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);try{await f.sync();}finally{await f.close();}}
async function bytes(path,maximum=32*1024*1024,{privateFile=false}={}){
 assert.equal(await realpath(path),path,'Original file path must be canonical');
 const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{
  const before=await f.stat({bigint:true});
  assert(before.isFile()&&before.size<=BigInt(maximum),'Original file exceeds its selected bound: '+path);
  if(privateFile)assert(before.nlink===1n&&(before.mode&0o077n)===0n&&before.uid===BigInt(process.getuid())&&before.gid===BigInt(process.getgid()),'Original file must be private and service-owned');
  const value=await f.readFile(),after=await f.stat({bigint:true}),named=await lstat(path,{bigint:true});
  assert(BigInt(value.length)===before.size&&after.size===before.size&&after.mtimeNs===before.mtimeNs&&after.ctimeNs===before.ctimeNs&&named.ino===before.ino&&named.dev===before.dev,'Original file changed during read');
  return value;
 }finally{await f.close();}
}
async function identity(path){
 const before=await lstat(path,{bigint:true});assert(before.isFile()&&!before.isSymbolicLink());
 assert.equal(await realpath(path),path);const h=createHash('sha256');let size=0;
 for await(const chunk of createReadStream(path)){h.update(chunk);size+=chunk.length;}
 const after=await lstat(path,{bigint:true});
 assert(after.ino===before.ino&&after.dev===before.dev&&after.size===before.size&&after.mtimeNs===before.mtimeNs&&after.ctimeNs===before.ctimeNs&&BigInt(size)===before.size);
 return{path,bytes:size,sha256:h.digest('hex')};
}
async function readJson(path,maximum=32*1024*1024){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path,maximum)));}
async function exact(path,value){
 value=Buffer.isBuffer(value)?value:Buffer.from(value);await privateDirectory(dirname(path),{create:true});
 if(await exists(path)){assert((await bytes(path,Math.max(value.length,1),{privateFile:true})).equals(value),'Retain the different original file: '+path);return identity(path);}
 const temp=path+'.pending',f=await open(temp,constants.O_RDWR|constants.O_CREAT|constants.O_NOFOLLOW,0o600);
 try{
  const info=await f.stat();assert(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&info.uid===process.getuid()&&info.gid===process.getgid()&&info.size<=value.length);
  const prefix=await f.readFile();assert(prefix.equals(value.subarray(0,prefix.length)),'Retain the original interrupted file: '+temp);
  let offset=prefix.length;while(offset<value.length){const r=await f.write(value,offset,value.length-offset,offset);assert(r.bytesWritten>0);offset+=r.bytesWritten;}await f.sync();
 }finally{await f.close();}
 await rename(temp,path);await syncDirectory(dirname(path));return identity(path);
}
async function replaceJson(path,value){
 const temp=path+'.next';const f=await open(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_TRUNC|constants.O_NOFOLLOW,0o600);
 try{const s=await f.stat();assert(s.isFile()&&s.nlink===1&&!(s.mode&0o077)&&s.uid===process.getuid());await f.writeFile(json(value));await f.sync();}finally{await f.close();}
 await rename(temp,path);await syncDirectory(dirname(path));
}
async function boundedChild(argv,{timeoutMs=120000}={}){
 const child=spawn(process.execPath,argv,{stdio:['ignore','pipe','pipe'],env:process.env});
 const out=[],err=[];let count=0,expired=false,error=null;
 const take=target=>chunk=>{count+=chunk.length;if(count>32*1024*1024){error??=new Error('Original child response exceeded 32 MiB');child.kill('SIGINT');}else target.push(chunk);};
 child.stdout.on('data',take(out));child.stderr.on('data',take(err));
 const result=await new Promise(resolve=>{
  const timer=setTimeout(()=>{expired=true;child.kill('SIGINT');},timeoutMs);
  const force=setTimeout(()=>{expired=true;child.kill('SIGKILL');},timeoutMs+10000);
  child.once('error',e=>error=e);
  child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(force);resolve({code,signal});});
 });
 return{...result,stdout:Buffer.concat(out),stderr:Buffer.concat(err),expired,error:error?.message??null,pid:child.pid??null};
}
function publicResult(value){const{workspace,connection,...rest}=value;return rest;}
function expectedRequest(value,selection){
 assert.equal(value.profileId,selection.profileId);assert.equal(value.operationId,selection.id);
 equal(value.review.intent,selection,'The original request selection changed');
 assert.equal(value.review.command,'fleet-prepare');
}
export async function receiveFleetRecoveryOperator(input={}){
 const runner=new Receiving(input);return runner.run();
}
class Receiving{
 constructor(input){this.input=input;this.state=null;this.lease=null;this.service=null;this.browser=null;this.context=null;this.page=null;this.client=null;this.saveChain=Promise.resolve();this.pageErrors=[];this.assets=new Map();this.routeError=null;this.lossExpected=null;}
 async save(){const copy=clone(this.state);this.saveChain=this.saveChain.then(()=>replaceJson(join(this.directory,'progress.json'),copy));return this.saveChain;}
 async event(kind,value){this.state.events.push({kind,at:now(),...value});await this.save();}
 async stage(name,value){this.state.stages[name]={at:now(),...value};await this.save();process.stdout.write(JSON.stringify({operationId:this.state.selection.operationId,stage:name,complete:true})+'\n');}
 async retained(name,value){return exact(join(this.directory,name),Buffer.isBuffer(value)?value:json(value));}
 async until(check,label){const end=Date.now()+this.timeoutMs;while(Date.now()<end){if(this.routeError)throw this.routeError;const v=await check();if(v)return v;await sleep(100);}throw new Error('Timed out: '+label);}
 async bind(){
  const allowed=new Set(['sourceDirectory','caseDirectory','directory','python','chromiumPath','playwrightModule','timeoutMs','quiesced']);
  for(const k of Object.keys(this.input))assert(allowed.has(k),'Unknown receiving input: '+k);
  assert.equal(this.input.quiesced,true,'Keep the original receiving fleet and writers stopped for this same-case adoption');
  assert.equal(process.platform,'linux');assert(process.getuid()>0&&process.getgid()>0,'Use the original nonroot service account');
  this.timeoutMs=this.input.timeoutMs??120000;assert(Number.isSafeInteger(this.timeoutMs)&&this.timeoutMs>=10000&&this.timeoutMs<=300000);
  for(const key of ['sourceDirectory','caseDirectory','chromiumPath','playwrightModule']){
   assert(typeof this.input[key]==='string'&&isAbsolute(this.input[key])&&resolve(this.input[key])===this.input[key],key+' must be an absolute canonical path');
   assert.equal(await realpath(this.input[key]),this.input[key]);
  }
  this.source=this.input.sourceDirectory;this.case=this.input.caseDirectory;
  assert(!inside(this.source,this.case)&&!inside(this.case,this.source));await privateDirectory(this.case);
  this.directory=this.input.directory??join(this.case,'operator-receiving');
  assert(isAbsolute(this.directory)&&resolve(this.directory)===this.directory&&inside(this.case,this.directory)&&this.directory!==this.case,'Receiving output must stay inside this exact original case');
  await privateDirectory(this.directory,{create:true});
  const{acquireDeliveryLease}=await import(pathToFileURL(join(this.source,BASE+'sf98-merchant-delivery/delivery-lock.mjs')));
  this.lease=await acquireDeliveryLease(this.directory,{purpose:'drain'});
  const caseFile=join(this.case,'journey.json'),record=await readJson(caseFile);
  assert.equal(record.state,'COMPLETE','Finish and close the original whole fleet journey before this same-case operator stage');
  assert.equal(record.schema,'stellar-forge.fleet-recovery-native-journey.v1');assert.equal(record.operationId,ORIGINAL);
  assert.equal(record.input.source,this.source);assert.equal(record.input.directory,this.case);
  assert.equal(record.environment.uid,process.getuid());assert.equal(record.environment.gid,process.getgid());
  const capture=record.stages.find(s=>s.name==='stopped-native-encrypted-capture')?.result;
  assert.equal(capture?.result.status,'FLEET_CAPTURED','Use the actual original stopped encrypted capture');
  const preserved=record.stages.find(s=>s.name==='preserve-only-this-new-stopped-source')?.result;
  assert(Array.isArray(preserved?.preserved)&&preserved.preserved.length===capture.originalRoots.length);
  this.paths=record.paths;assert.equal(this.paths.root,this.case);
  for(const key of ['encrypted','plaintext','targetsFile','receiveOperation','receivedBundle']){
   const path=this.paths[key];assert(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&inside(this.case,path)&&path!==this.case);
   assert(!inside(this.directory,path)&&!inside(path,this.directory),'Keep operator control state separate from original source/receiving paths');
  }
  this.passEnv=record.input.passphraseEnv;assert(/^[A-Z][A-Z0-9_]{4,63}$/.test(this.passEnv),'The original passphrase variable must satisfy the existing host profile name grammar');
  assert(typeof process.env[this.passEnv]==='string'&&process.env[this.passEnv].length>=16,'Retain the original private passphrase environment');
  this.python=this.input.python??record.input.python;assert.equal(this.python,record.input.python,'Keep the original Python runtime');
  assert.equal(await realpath(this.python),this.python);
  this.nativePath=join(this.paths.receiveOperation,'receiving.json');
  const nativeBytes=await bytes(this.nativePath,32*1024*1024,{privateFile:true}),native=JSON.parse(nativeBytes);
  assert.equal(native.phase,'COMPLETE','Complete the original native receiving before operator adoption');
  assert.equal(native.result?.status,'FLEET_RECEIVING_COMPLETE');
  this.native=clone(native.result);this.nativeReview=clone(native.review);
  assert.equal(this.native.snapshotId,capture.result.snapshotId);assert.equal(this.native.sourcePlanSha256,capture.prepared.sha256);
  assert.equal(this.native.operationDirectory,this.paths.receiveOperation);assert.equal(this.native.deploymentBundle,this.paths.receivedBundle);
  assert.equal(this.native.serviceUid,process.getuid());assert.equal(this.native.serviceGid,process.getgid());
  assert.equal(this.native.reviewSha256,native.reviewSha256);assert.equal(this.native.operationId,native.operationId);
  assert.equal(this.nativeReview.deploymentBundle,this.paths.receivedBundle);assert.equal(this.nativeReview.targetFile,this.paths.targetsFile);
  assert.equal(this.nativeReview.operationDirectory,this.paths.receiveOperation);assert.equal(this.nativeReview.snapshotId,this.native.snapshotId);
  equal(this.native.roots.map(r=>({name:r.name,path:r.path,kind:r.kind,source:r.source})),
   this.nativeReview.roots.map(r=>({name:r.name,path:r.destination,kind:r.kind,source:r.source})));
  assert(this.native.summary.merchants.length>=2,'Use both actual original merchants');
  const sourceFiles={};
  for(const[path,pin]of Object.entries(PRODUCT_PINS)){
   const raw=await bytes(join(this.source,WORKSPACE+path));assert.equal(gitBlob(raw),pin,'Select the published complete operator source: '+path);
   sourceFiles[WORKSPACE+path]={gitBlob:pin,bytes:raw.length,sha256:sha(raw)};
  }
  for(const row of record.source.verifiedFiles){
   assert(typeof row.path==='string'&&!isAbsolute(row.path)&&!row.path.split('/').includes('..'));
   const raw=await bytes(join(this.source,row.path));assert.equal(gitBlob(raw),row.gitBlob,'Preserve the original fleet source');
   assert.equal(sha(raw),row.sha256);assert.equal(raw.length,row.bytes);sourceFiles[row.path]={gitBlob:row.gitBlob,sha256:row.sha256,bytes:row.bytes};
  }
  assert.equal(await realpath(HERE),join(this.source,WORKSPACE+'receiving/fleet-operator.mjs'),'Invoke this receiving module from the same selected source');
  sourceFiles[WORKSPACE+'receiving/fleet-operator.mjs']=await identity(HERE);
  const runtimes={node:await identity(process.execPath),python:await identity(this.python),chromium:await identity(this.input.chromiumPath),playwright:await identity(this.input.playwrightModule)};
  this.profileId='original-fleet';this.restoreId='original-authenticated-restore';this.targetId='original-receiving-target';
  this.requestId='fleet-adoption-'+this.native.operationId.slice(0,24);
  this.selection={profileId:this.profileId,action:'fleet-prepare',id:this.requestId,fleetRestoreId:this.restoreId,fleetTargetId:this.targetId,quiesced:true};
  this.workspace=join(this.directory,'workspace');this.configFile=join(this.directory,'host.json');this.connectionFile=join(this.directory,'merchant-connection.json');
  this.selectionFile=join(this.directory,'selection.json');
  const bundleParent=dirname(this.paths.encrypted),restoreParent=dirname(this.paths.plaintext);
  for(const parent of [bundleParent,restoreParent]){
   await privateDirectory(parent);assert(!inside(parent,this.workspace)&&!inside(this.workspace,parent),'Choose output outside the original permitted bundle/restore parent');
  }
  this.host={schema:'stellar-forge.recovery-workspace.v1',title:'Original fleet receiving',profiles:[{
   id:this.profileId,label:'Original two-merchant fleet',storeConfig:null,passEnv:this.passEnv,
   operations:join(this.directory,'transfer-journal'),
   bundleRoots:[{id:'original-recovery',label:'Original encrypted recovery',directory:bundleParent}],
   downloadRoot:bundleParent,restoreRoot:restoreParent,
   fleetRestores:[{id:this.restoreId,label:'Original authenticated fleet',bundleDirectory:this.paths.encrypted,restoreDirectory:this.paths.plaintext}],
   fleetTargets:[{id:this.targetId,label:'Original receiving paths and deployment',targetFile:this.paths.targetsFile,operationDirectory:this.paths.receiveOperation}]
  }]};
  const frozen={schema:SCHEMA,operationId:ORIGINAL+'.operator',originalOperationId:ORIGINAL,sourceDirectory:this.source,
   productCommit:PRODUCT_COMMIT,caseDirectory:this.case,directory:this.directory,paths:this.paths,host:this.host,selection:this.selection,
   sourceFiles,runtimes,native:{path:this.nativePath,bytes:nativeBytes.length,sha256:sha(nativeBytes),result:this.native,review:this.nativeReview},
   originalTargets:await identity(this.paths.targetsFile),originalManifest:await identity(join(this.paths.encrypted,'manifest.json')),
   originalCapture:capture.result,originalService:record.environment,preservedSources:preserved.preserved};
  const operationPath=join(this.directory,'operation.json');await exact(operationPath,json(frozen));
  const progressPath=join(this.directory,'progress.json');
  this.state=await exists(progressPath)?await readJson(progressPath):{schema:SCHEMA,selection:frozen,state:'RUNNING',startedAt:now(),stages:{},events:[],calls:[],launches:[],browserStorage:{},browserStarts:[],screenshots:[]};
  equal(this.state.selection,frozen,'Reopen the same original source, native result and receiving selection');
  this.state.state='RUNNING';await this.save();
  const observedJourney=join(this.directory,'source/original-journey-observation.json');
  if(!await exists(observedJourney))await this.retained('source/original-journey-observation.json',record);
  else{const original=await readJson(observedJourney);equal(original.input,record.input);equal(original.paths,record.paths);assert.equal(original.operationId,record.operationId);}
  await exact(this.configFile,json(this.host));await exact(this.selectionFile,json(this.selection));
  await exact(this.connectionFile,json({schema:'stellar-forge.recovery-workspace-connection.v1',workspaces:{
   original:{label:'Original fleet receiving workspace',directory:this.workspace,configFile:this.configFile,sourceDirectory:join(this.source,WORKSPACE)}
  }}));
  this.connection=await import(pathToFileURL(join(this.source,WORKSPACE+'connection.mjs')));
  this.provider=(await import(pathToFileURL(join(this.source,WORKSPACE+'merchant-provider.mjs')))).default;
  this.nativeEngine=await import(pathToFileURL(join(this.source,BASE+'merchant-fleet-gateway/recovery.mjs')));
  this.playwright=await import(pathToFileURL(this.input.playwrightModule));
  this.playwright=this.playwright.chromium?this.playwright:this.playwright.default;
  assert(this.playwright?.chromium?.launch);
  await this.stage('original-case-source-and-host-bound',{nativeOperationId:this.native.operationId,snapshotId:this.native.snapshotId,receivingRoots:this.native.roots.length,merchants:this.native.summary.merchants.length});
 }

 async cli(command,flags=[],{expectedError=null}={}){
  const index=this.state.calls.length,stem='calls/'+String(index).padStart(4,'0')+'-cli-'+command;
  const argv=[join(this.source,WORKSPACE+'cli.mjs'),command,'--config',this.configFile,'--directory',this.workspace,...flags];
  const row={transport:'CLI',command,argv,startedAt:now(),state:'STARTING'};this.state.calls.push(row);await this.save();
  const result=await boundedChild(argv,{timeoutMs:this.timeoutMs});
  row.stdout=await this.retained(stem+'.stdout',result.stdout);row.stderr=await this.retained(stem+'.stderr',result.stderr);
  row.exitCode=result.code;row.signal=result.signal;row.expired=result.expired;row.completedAt=now();row.state='RETURNED';
  await this.save();assert(!result.expired&&!result.error,'The owned original CLI did not finish');
  let value;
  if(expectedError){
   assert.equal(result.code,1);value=JSON.parse(result.stderr.toString('utf8'));
   assert.equal(value.error?.code,expectedError);const detail=JSON.parse(value.error.message);
   assert.equal(detail.workspace,'local');assert.equal(detail.error.code,expectedError);assert.equal(detail.outcome,'REJECTED');
   row.expectedNativeError={code:expectedError,httpStatus:detail.httpStatus};await this.save();return value;
  }
  assert.equal(result.code,0,'Original CLI '+command+' must complete; inspect its retained stderr');
  assert.equal(result.signal,null);value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(result.stdout));
  assert.equal(value.workspace,'local');this.checkConnection(value.connection);return publicResult(value);
 }
 checkConnection(connection){
  assert.equal(connection.instanceId,this.launch.instanceId);assert.equal(connection.workspaceId,this.launch.identity.workspaceId);
  assert.equal(connection.configurationSha256,this.launch.identity.configurationSha256);
  assert.equal(connection.sourceDirectory,join(this.source,WORKSPACE.slice(0,-1)));assert.equal(connection.origin,this.launch.origin);
 }
 async merchant(action,input={},expectedError=null){
  const index=this.state.calls.length,stem='calls/'+String(index).padStart(4,'0')+'-merchant-'+action;
  const args={workspace:'original',...clone(input)},row={transport:'MERCHANT_PROVIDER',tool:'merchant_recovery_'+action,args,startedAt:now(),state:'STARTING'};
  this.state.calls.push(row);await this.save();let value;
  try{
   value=await this.client.call(row.tool,args);
  }catch(error){
   row.error=await this.retained(stem+'.error.json',{code:error.code,message:error.message,status:error.status??null,details:error.details??null});
   row.completedAt=now();row.state='ERROR';await this.save();
   if(!expectedError)throw error;
   assert.equal(error.code,expectedError);assert.equal(error.details?.outcome,'REJECTED');
   assert.equal(error.details?.error.code,expectedError);return{error:{code:error.code,details:error.details}};
  }
  assert.equal(expectedError,null,'The original provider operation unexpectedly succeeded');
  row.response=await this.retained(stem+'.json',value);row.state='RETURNED';row.completedAt=now();await this.save();
  assert.equal(value.workspace,'original');this.checkConnection(value.connection);return publicResult(value);
 }
 async nativeInspection(){
  const view=await this.nativeEngine.inspectRestoredFleet({bundleDirectory:this.paths.encrypted,
   restoreDirectory:this.paths.plaintext,passphraseEnv:this.passEnv,expectedManifestSha256:this.native.snapshotId,
   targetFile:this.paths.targetsFile,operationDirectory:this.paths.receiveOperation});
  assert.equal(view.status,'FLEET_RECEIVING_COMPLETE');assert.equal(view.operation?.operationId,this.native.operationId);
  assert.equal(view.operation?.phase,'COMPLETE');equal(view.operation.result,this.native);
  assert.equal(view.reviewSha256,this.native.reviewSha256);equal(view.review,this.nativeReview);equal(view.summary,this.native.summary);
  const saved=await this.retained('source/original-native-inspection.json',view);
  await this.stage('original-complete-native-adoption-reviewed',{inspection:saved,nativeOperationId:this.native.operationId});
  return view;
 }

 async reconcileOwnedHistory(){
  if(!this.state.launches.length&&!this.state.browserStarts.length)return;
  // Inspect only process records owned by the original service account. A live
  // matching listener or browser stays with its original controller.
  const processes=[];
  for(const name of await readdir('/proc')){
   if(!/^[1-9]\d*$/.test(name))continue;
   try{
    const stat=await lstat('/proc/'+name);if(stat.uid!==process.getuid())continue;
    const raw=await readFile('/proc/'+name+'/cmdline');assert(raw.length<=1024*1024);
    processes.push({pid:Number(name),argv:raw.toString('utf8').split('\0').filter(Boolean)});
   }catch(error){if(!['ENOENT','ESRCH'].includes(error.code))throw error;}
  }
  const cli=join(this.source,WORKSPACE+'cli.mjs');
  assert(!processes.some(p=>p.argv.includes(cli)&&p.argv.includes('serve')&&p.argv.includes(this.configFile)&&p.argv.includes(this.workspace)),
   'The existing original serve process still owns this workspace. Retain its listener and ask its original controller to close it.');
  for(const row of this.state.browserStarts)
   assert(!processes.some(p=>p.argv.includes('--user-data-dir='+row.profile)),
    'The existing browser for this exact retained profile is still running; its original controller must close it.');
  if(await exists(this.workspace)){
   let live=null;
   try{live=await this.connection.readRecoveryWorkspaceLaunch({directory:this.workspace,configFile:this.configFile});}
   catch(error){if(!['ENOENT','WORKSPACE_NOT_RUNNING','WORKSPACE_NOT_CREATED'].includes(error.code))throw error;}
   assert(!live,'The original listener remains live');
  }
  const observedAt=now();
  for(const row of [...this.state.launches,...this.state.browserStarts])
   if(!['CLOSED','INTERRUPTED_CLOSED'].includes(row.state)){
    row.previousState=row.state;row.state='INTERRUPTED_CLOSED';row.originalProcessesAbsent=true;row.closureObservedAt=observedAt;
   }
  await this.save();
 }
 async startService(label){
  assert(!this.service,'Close this receiver’s owned original listener before reopening');
  if(await exists(this.workspace)){
   let live=null;
   try{live=await this.connection.readRecoveryWorkspaceLaunch({directory:this.workspace,configFile:this.configFile});}
   catch(error){if(!['ENOENT','WORKSPACE_NOT_RUNNING','WORKSPACE_NOT_CREATED'].includes(error.code))throw error;}
   assert(!live,'An original listener is still live. Its existing controller must close it; this receiver will not take it over.');
  }
  const index=this.state.launches.length,stem='launches/'+String(index).padStart(3,'0')+'-'+label;
  await privateDirectory(join(this.directory,'launches'),{create:true});
  const record={label,startedAt:now(),state:'STARTING',stdout:join(this.directory,stem+'.stdout'),stderr:join(this.directory,stem+'.stderr')};
  this.state.launches.push(record);await this.save();
  const stdout=await open(record.stdout,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  let stderr;
  try{stderr=await open(record.stderr,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);}
  catch(error){await stdout.close();throw error;}
  const argv=[join(this.source,WORKSPACE+'cli.mjs'),'serve','--config',this.configFile,'--directory',this.workspace,'--port','0'];
  let child;
  try{child=spawn(process.execPath,argv,{stdio:['ignore','pipe','pipe'],env:process.env});}
  catch(error){await stdout.close();await stderr.close();throw error;}
  const owned={child,record,exit:null,error:null,ready:null,outputBytes:0,logWrites:Promise.resolve(),closed:null,files:[stdout,stderr]};
  this.service=owned;record.pid=child.pid??null;record.argv=argv;
  let pending='';
  const take=(file,isOut)=>chunk=>{
   owned.outputBytes+=chunk.length;
   if(owned.outputBytes>4*1024*1024){owned.error??=new Error('Original listener logs exceeded 4 MiB');child.kill('SIGINT');return;}
   owned.logWrites=owned.logWrites.then(()=>file.writeFile(chunk));
   owned.logWrites.catch(error=>{owned.error??=error;child.kill('SIGINT');});
   if(isOut){
    pending+=chunk.toString('utf8');
    while(pending.includes('\n')){
     const line=pending.slice(0,pending.indexOf('\n'));pending=pending.slice(pending.indexOf('\n')+1);
     if(!line.startsWith('{'))continue;
     try{const value=JSON.parse(line);if(value.status==='MERCHANT_RECOVERY_WORKSPACE_READY'){
      if(owned.ready)owned.error??=new Error('The original listener emitted more than one ready record');
      else owned.ready=value;
     }}catch{}
    }
   }
  };
  child.stdout.on('data',take(stdout,true));child.stderr.on('data',take(stderr,false));
  child.once('error',error=>owned.error??=error);
  owned.closed=new Promise(done=>child.once('close',(code,signal)=>{owned.exit={code,signal};done(owned.exit);}));
  await this.save();
  await this.until(()=>{if(owned.error)throw owned.error;if(owned.exit)throw new Error('Original listener closed before readiness; inspect its private logs');return owned.ready;},'the original serve ready record');
  const ready=owned.ready;assert.equal(ready.configFile,this.configFile);assert.equal(ready.directory,this.workspace);
  assert.equal(ready.connectionFile,join(this.workspace,this.connection.RECOVERY_LAUNCH_FILE));
  const launch=await this.connection.readRecoveryWorkspaceLaunch({directory:this.workspace,configFile:this.configFile});
  assert.equal(launch.pid,child.pid);assert.equal(ready.instanceId,launch.instanceId);assert.equal(ready.workspaceId,launch.identity.workspaceId);
  assert.equal(ready.configurationSha256,launch.identity.configurationSha256);
  assert.equal(ready.url,launch.origin+'/#token='+launch.token);
  if(this.state.workspaceIdentity)equal(this.state.workspaceIdentity,launch.identity,'Keep the same saved workspace on reopen');
  else this.state.workspaceIdentity=clone(launch.identity);
  for(const prior of this.state.launches.slice(0,-1))if(prior.connection)assert.notEqual(prior.connection.instanceId,launch.instanceId);
  const{token,...publicLaunch}=launch;record.connection=publicLaunch;record.state='RUNNING';record.readyAt=now();await this.save();
  this.launch=launch;this.currentUrl=ready.url;
  const module=await this.provider.load(),config=await module.readRecoveryWorkspaceConfiguration(this.connectionFile);
  this.client=this.provider.create(module,{recoveryWorkspaces:config});
  assert.equal(this.client.summary.ownership,'ORIGINAL_RECOVERY_WORKSPACE');
  assert.equal(this.client.summary.workspaces.length,1);assert.equal(this.client.summary.workspaces[0].workspaceId,launch.identity.workspaceId);
  await this.event('original-listener-started',{label,instanceId:launch.instanceId,workspaceId:launch.identity.workspaceId,configurationSha256:launch.identity.configurationSha256});
 }
 async closeService(){
  if(!this.service)return;
  const owned=this.service;let problem=null;
  if(!owned.exit)owned.child.kill('SIGINT');
  try{
   await Promise.race([owned.closed,sleep(10000).then(()=>{throw new Error('Original serve did not drain after SIGINT');})]);
  }catch(error){
   problem=error;if(!owned.exit)owned.child.kill('SIGKILL');
   try{await Promise.race([owned.closed,sleep(5000).then(()=>{throw new Error('Owned listener did not close after its forced stop');})]);}
   catch(e){problem=e;}
  }
  try{await owned.logWrites;for(const file of owned.files){await file.sync();await file.close();}}
  catch(error){problem??=error;for(const file of owned.files)await file.close().catch(()=>{});}
  owned.record.closedAt=now();owned.record.exit=owned.exit;owned.record.state=problem?'CLOSE_FAILED':'CLOSED';
  if(!problem&&owned.exit?.code!==0)problem=new Error('Original serve closed with a failure; inspect its private retained logs');
  if(!problem){
   try{
    const path=join(this.workspace,this.connection.RECOVERY_LAUNCH_FILE);
    assert.equal(await exists(path),null,'Original close must retire its own current launch');
    owned.record.launchRetired=true;
   }catch(error){problem=error;}
  }
  this.service=null;await this.save();if(problem)throw problem;
 }
 async openBrowser(label){
  assert(!this.context&&!this.browser);
  const index=this.state.browserStarts.length,profile=join(this.directory,'browser-profiles',String(index).padStart(3,'0')+'-'+label);
  await privateDirectory(profile,{create:true});await privateDirectory(join(this.directory,'browser-downloads'),{create:true});
  const record={label,profile,startedAt:now(),state:'STARTING',listenerInstanceId:this.launch.instanceId};
  this.state.browserStarts.push(record);await this.save();
  this.context=await this.playwright.chromium.launchPersistentContext(profile,{executablePath:this.input.chromiumPath,
   headless:true,viewport:{width:1440,height:1100},deviceScaleFactor:1,locale:'en-US',serviceWorkers:'block',
   downloadsPath:join(this.directory,'browser-downloads'),args:['--disable-dev-shm-usage'],timeout:this.timeoutMs});
  this.browser=this.context.browser();assert(this.browser,'Use the original Chromium browser context');
  record.state='RUNNING';this.browserDisconnected=false;this.browser.on('disconnected',()=>{this.browserDisconnected=true;});
  this.page=this.context.pages()[0]??await this.context.newPage();this.page.setDefaultTimeout(this.timeoutMs);
  this.page.on('pageerror',error=>this.pageErrors.push({label,message:error.message}));
  this.assetTasks??=new Set();
  this.page.on('response',response=>{
   const url=new URL(response.url()),assets={'/':'index.html','/app.mjs':'app.mjs','/style.css':'style.css'};
   if(url.origin!==this.launch.origin||!assets[url.pathname])return;
   const task=(async()=>{
    assert.equal(response.status(),200);const body=await response.body(),path=assets[url.pathname];
    assert.equal(gitBlob(body),PRODUCT_PINS[path],'The browser must render the selected original asset');
    this.assets.set(path,{path,bytes:body.length,sha256:sha(body),gitBlob:gitBlob(body)});
   })();
   this.assetTasks.add(task);task.catch(error=>this.routeError??=error).finally(()=>this.assetTasks.delete(task));
  });
  const storage=clone(this.state.browserStorage);
  await this.context.addInitScript(({origin,storage})=>{
   if(location.origin!==origin||sessionStorage.getItem('starforge-receiving-draft-seeded'))return;
   sessionStorage.setItem('starforge-receiving-draft-seeded','yes');
   for(const[key,value]of Object.entries(storage))if(key.startsWith('starforge-fleet-selection/v1/'))sessionStorage.setItem(key,value);
  },{origin:this.launch.origin,storage});
  await this.page.goto(this.currentUrl,{waitUntil:'domcontentloaded',timeout:this.timeoutMs});
  await this.until(async()=>await this.page.locator('#profile').inputValue()===this.profileId&&
   await this.page.locator('#fleet-restores-list article').count()===2,'the original profile and two declared fleet entries');
  await this.until(()=>this.assets.size===3,'all original browser assets');
  assert.equal(await this.page.locator('#fleet-quiesced').isChecked(),false,'Cold open requires current quiescence acknowledgment');
  record.readyAt=now();await this.save();
 }
 async closeBrowser(){
  if(!this.context&&!this.browser)return;
  const context=this.context,browser=this.browser,record=this.state.browserStarts.at(-1);let problem=null;
  try{await context?.close();await browser?.close();}
  catch(error){problem=error;}
  try{await Promise.all([...(this.assetTasks??[])]);}catch(error){problem??=error;}
  record.closedAt=now();record.state=problem?'CLOSE_FAILED':'CLOSED';record.disconnected=this.browserDisconnected;
  this.page=null;this.context=null;this.browser=null;await this.save();
  if(!problem&&!record.disconnected)problem=new Error('The original Chromium did not report closure');
  if(problem)throw problem;
 }
 async rememberDraft(){
  const values=await this.page.evaluate(()=>Object.fromEntries(Object.entries(sessionStorage).filter(([key])=>key.startsWith('starforge-fleet-selection/v1/'))));
  const key='starforge-fleet-selection/v1/'+JSON.stringify([this.state.workspaceIdentity.workspaceId,this.workspace,this.profileId]);
  assert.equal(Object.keys(values).length,1);assert(Object.hasOwn(values,key));
  const value=JSON.parse(values[key]);assert.equal(value.schema,'starforge-fleet-selection/v1');assert.equal(value.active,true);
  this.state.browserStorage=values;await this.save();return value;
 }
 async rawDraft(){
  await this.page.locator('#action').selectOption('fleet-prepare');
  await this.page.locator('#fleet-source').selectOption('remote');
  const remote=' original remote-id / retained ',operation='  '+this.requestId+' draft  ';
  await this.page.locator('#fleet-restore-operation').fill(remote);
  await this.page.locator('#fleet-source').selectOption('host');
  await this.page.locator('#fleet-restore').selectOption(this.restoreId);await this.page.locator('#fleet-target').selectOption(this.targetId);
  await this.page.locator('#operation-id').fill(operation);await this.page.locator('#fleet-quiesced').check();
  const value=await this.rememberDraft();
  equal(value,{schema:'starforge-fleet-selection/v1',active:true,source:'host',restoreId:remote,
   fleetRestoreId:this.restoreId,fleetTargetId:this.targetId,operationId:operation});
  assert.equal(await this.page.locator('#review-panel').isVisible(),false);
  await this.page.reload({waitUntil:'domcontentloaded'});
  await this.until(async()=>await this.page.locator('#operation-id').inputValue()===operation,'the saved raw operation text after reload');
  await this.assertRawDraft(value);return value;
 }
 async assertRawDraft(value){
  equal({source:await this.page.locator('#fleet-source').inputValue(),restoreId:await this.page.locator('#fleet-restore-operation').inputValue(),
   fleetRestoreId:await this.page.locator('#fleet-restore').inputValue(),fleetTargetId:await this.page.locator('#fleet-target').inputValue(),
   operationId:await this.page.locator('#operation-id').inputValue()},
   Object.fromEntries(['source','restoreId','fleetRestoreId','fleetTargetId','operationId'].map(key=>[key,value[key]])));
  assert.equal(await this.page.locator('#fleet-quiesced').isChecked(),false);assert.equal(await this.page.locator('#review-panel').isVisible(),false);
 }
 async canonicalBrowserReview(){
  await this.page.locator('#action').selectOption('fleet-prepare');await this.page.locator('#fleet-source').selectOption('host');
  await this.page.locator('#fleet-restore').selectOption(this.restoreId);await this.page.locator('#fleet-target').selectOption(this.targetId);
  await this.page.locator('#operation-id').fill(this.requestId);await this.page.locator('#fleet-quiesced').check();
  const observed=this.page.waitForResponse(response=>{const u=new URL(response.url());return u.origin===this.launch.origin&&u.pathname==='/api/review'&&response.request().method()==='POST';});
  await this.page.locator('#review-button').click();const response=await observed;
  assert.equal(response.status(),200);equal(response.request().postDataJSON(),this.selection);
  const body=await response.body(),review=JSON.parse(body);this.validateReview(review);
  await this.until(async()=>await this.page.locator('#review-heading').textContent()==='Original fleet receiving','the full native review');
  const rendered=JSON.parse(await this.page.locator('#fleet-review-original').textContent());equal(rendered,review.restoredFleet);
  const actualRoots=await this.page.locator('#fleet-review-roots tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(x=>x.textContent)));
  assert.equal(actualRoots.length,this.nativeReview.roots.length);
  for(let i=0;i<actualRoots.length;i++){
   const expected=this.nativeReview.roots[i];assert.equal(actualRoots[i][0],expected.name+' · '+expected.kind);
   assert.equal(actualRoots[i][1],expected.restored);assert.equal(actualRoots[i][2],expected.destination);
  }
  const slots=this.native.summary.merchants.flatMap(merchant=>merchant.slots.map(slot=>({merchant,slot})));
  const actualMerchants=await this.page.locator('#fleet-review-merchants tr').evaluateAll(rows=>rows.map(row=>[...row.querySelectorAll('td')].map(x=>x.textContent)));
  assert.equal(actualMerchants.length,slots.length);
  const retained=value=>value===null||value===undefined?'—':typeof value==='string'?value:JSON.stringify(value);
  for(let i=0;i<slots.length;i++){
   const{merchant,slot}=slots[i],cells=actualMerchants[i];assert(cells[0].includes(merchant.id+' · '+merchant.host));
   assert(cells[0].includes('Startup slot: '+merchant.startupSlot));assert.equal(cells[1],slot.slot+' / '+slot.port);
   assert.equal(cells[2],slot.generation+' / '+slot.retainedChanges);assert.equal(cells[3],retained(slot.active));assert.equal(cells[4],retained(slot.previous));
  }
  const summary=await this.page.locator('#fleet-review-summary').evaluate(node=>Object.fromEntries([...node.querySelectorAll('dt')].map(dt=>[dt.textContent,dt.nextElementSibling.textContent])));
  for(const[key,value]of Object.entries({'Snapshot':this.native.snapshotId,'Native receiving operation':this.native.operationId,
   'Native review SHA-256':this.native.reviewSha256,'Original service UID / GID':this.native.serviceUid+' / '+this.native.serviceGid,
   'New deployment bundle':this.paths.receivedBundle,'Native receiving journal':this.paths.receiveOperation}))assert.equal(summary[key],value);
  const artifact=await this.retained('observations/browser-review-'+String(this.state.calls.length).padStart(4,'0')+'.json',body);
  await this.stage('browser-full-original-fleet-review',{response:artifact,reviewHash:review.reviewHash,roots:actualRoots.length,merchantSlots:slots.length});
  this.review=review;return review;
 }
 validateReview(review){
  assert.equal(review.profileId,this.profileId);assert.equal(review.operationId,this.requestId);assert.equal(review.command,'fleet-prepare');
  assert.equal(review.originalStatus,'COMPLETE');equal(review.intent,this.selection);equal(review.restoredFleet.review,this.nativeReview);
  equal(review.restoredFleet.operation.result,this.native);assert.equal(review.restoredFleet.operationId,this.native.operationId);
  assert.equal(review.restoredFleet.reviewSha256,this.native.reviewSha256);equal(review.restoredFleet.summary,this.native.summary);
  assert.equal(review.options.fleetOperationId,this.native.operationId);assert.equal(review.options.expectedReviewSha256,this.native.reviewSha256);
  assert.equal(review.options.sourceFleetRestoreId,this.restoreId);assert.equal(review.options.fleetTargetId,this.targetId);
  assert.equal(review.options.bundle,this.paths.encrypted);assert.equal(review.options.out,this.paths.plaintext);
  assert.equal(review.options.targetFile,this.paths.targetsFile);assert.equal(review.options.operationDirectory,this.paths.receiveOperation);
  assert(/^[a-f0-9]{64}$/.test(review.reviewHash));
 }

 verifyRequest(value,{complete=false}={}){
  expectedRequest(value,this.selection);assert.equal(value.review.options.fleetOperationId,this.native.operationId);
  assert.equal(value.review.options.expectedReviewSha256,this.native.reviewSha256);
  if(complete){
   assert.equal(value.phase,'COMPLETE');assert.equal(value.running,false);assert.equal(value.error,null);
   assert.equal(value.operation?.status,'COMPLETE');assert.equal(value.operation?.command,'fleet-prepare');
   assert.equal(value.operation.fleetOperationId,this.native.operationId);assert.equal(value.operation.reviewSha256,this.native.reviewSha256);
   assert.equal(value.operation.sourceFleetRestoreId,this.restoreId);assert.equal(value.operation.fleetTargetId,this.targetId);
   equal(value.operation.prepared,this.native);assert.equal(value.operation.bundle,this.paths.encrypted);assert.equal(value.operation.destination,this.paths.plaintext);
  }
 }
 async requestNow(){
  try{
   const reply=await this.client.call('merchant_recovery_request',{workspace:'original',profileId:this.profileId,id:this.requestId});
   this.checkConnection(reply.connection);const value=publicResult(reply);this.verifyRequest(value);return value;
  }catch(error){if(error.code==='WORKSPACE_REQUEST_NOT_FOUND'&&error.details?.httpStatus===404)return null;throw error;}
 }
 async completeRequest({resume=false}={}){
  let value=await this.requestNow();assert(value,'Read the same committed original request');
  if(resume&&value.phase!=='COMPLETE'&&!value.running)
   value=await this.merchant('resume',{profileId:this.profileId,id:this.requestId});
  value=await this.until(async()=>{
   const current=await this.requestNow();
   assert(current,'The saved original request disappeared');
   if(['FAILED','INTERRUPTED'].includes(current.phase)&&!current.running)throw new Error('The original request needs its retained recovery: '+(current.error?.code??current.phase));
   return current.phase==='COMPLETE'&&!current.running?current:null;
  },'the exact original completed fleet request');
  this.verifyRequest(value,{complete:true});return value;
 }
 async lostBrowserResponse(){
  const body={selection:this.selection,expectedReviewHash:this.review.reviewHash},serialized=JSON.stringify(body),requestSha256=sha(Buffer.from(serialized));
  if(this.state.lostReply)equal(this.state.lostReply.body,body,'Keep the same saved browser start payload');
  else{this.state.lostReply={body,requestSha256,createdAt:now(),attempts:[],complete:null};await this.save();}
  const loss=this.state.lostReply;assert.equal(loss.requestSha256,requestSha256);
  const previous=await this.requestNow();
  await this.event('original-request-before-start-replay',{present:!!previous,phase:previous?.phase??null,operationId:this.requestId,nativeOperationId:this.native.operationId});
  if(previous&&previous.phase!=='COMPLETE'&&!previous.running)await this.completeRequest({resume:true});
  if(loss.complete){
   assert(loss.complete.browserRequestFailed===true);const retained=await bytes(loss.complete.response.path);
   assert.equal(sha(retained),loss.complete.response.sha256);assert.equal(retained.length,loss.complete.response.bytes);
   this.verifyRequest(JSON.parse(retained));await this.completeRequest({resume:true});return;
  }
  const attempt={index:loss.attempts.length,startedAt:now(),instanceId:this.launch.instanceId,state:'PLANNED',requestSha256};
  loss.attempts.push(attempt);await this.save();
  const matches=request=>{
   const url=new URL(request.url());return url.origin===this.launch.origin&&url.pathname==='/api/start'&&request.method()==='POST';
  };
  let routeFinish,routeFailure;
  const handled=new Promise((done,fail)=>{routeFinish=done;routeFailure=fail;});handled.catch(()=>{});
  let seen=false;
  const handler=async route=>{
   if(!matches(route.request())){await route.continue();return;}
   try{
    assert(!seen,'The browser sent the original mutation twice');seen=true;
    equal(route.request().postDataJSON(),body);assert.equal(route.request().headers()['x-recovery-token'],this.launch.token);
    attempt.state='FORWARDING_ORIGINAL_REQUEST';attempt.forwardedAt=now();await this.save();
    const response=await route.fetch({maxRedirects:0,timeout:this.timeoutMs});assert.equal(response.status(),200);
    const raw=await response.body(),value=JSON.parse(raw);this.verifyRequest(value);
    attempt.response=await this.retained('observations/start-response-'+String(attempt.index).padStart(3,'0')+'.json',raw);
    attempt.status=response.status();attempt.headers=response.headers();attempt.receivedAt=now();
    attempt.state='ORIGINAL_RESPONSE_RETAINED';await this.save();
    await route.abort('failed');attempt.abortReturnedAt=now();attempt.state='BROWSER_RESPONSE_WITHHELD';await this.save();routeFinish();
   }catch(error){this.routeError=error;routeFailure(error);await route.abort('failed').catch(()=>{});}
  };
  await this.page.route('**/api/start',handler);
  const failed=this.page.waitForEvent('requestfailed',{predicate:matches,timeout:this.timeoutMs});failed.catch(()=>{});
  try{
   await this.page.locator('#start-button').click();
   const[request]=await Promise.all([failed,handled]);assert(seen);
   equal(request.postDataJSON(),body);assert(attempt.response&&request.failure()?.errorText);
   attempt.browserFailure={errorText:request.failure().errorText,observedAt:now()};attempt.state='BROWSER_FAILURE_OBSERVED';
   loss.complete={requestSha256,response:attempt.response,status:attempt.status,instanceId:this.launch.instanceId,
    attempt:attempt.index,browserRequestFailed:true,browserFailure:attempt.browserFailure,completedAt:now()};
   await this.save();
  }finally{await this.page.unroute('**/api/start',handler);}
  const readback=await this.completeRequest({resume:true});
  const cli=await this.cli('request',['--profile',this.profileId,'--id',this.requestId]);this.verifyRequest(cli,{complete:true});
  const merchant=await this.merchant('request',{profileId:this.profileId,id:this.requestId});this.verifyRequest(merchant,{complete:true});
  equal(readback.operation,merchant.operation);equal(cli.operation,merchant.operation);
  await this.page.locator('#refresh-progress').click();
  await this.until(async()=>await this.requestCard().locator('.badge').textContent()==='COMPLETE','the browser’s same completed request after readback');
  await this.stage('browser-lost-response-original-request-recovered',{requestSha256,nativeOperationId:this.native.operationId,
   response:loss.complete.response,browserFailure:loss.complete.browserFailure,requestId:this.requestId});
 }
 requestCard(){return this.page.locator('#request-list article.request').filter({has:this.page.getByRole('heading',{name:this.requestId,exact:true})});}
 async inspectBrowserResult(label){
  await this.page.locator('#refresh-progress').click();
  await this.until(async()=>await this.requestCard().count()===1&&await this.requestCard().locator('.badge').textContent()==='COMPLETE','one original completed request in the browser');
  const card=this.requestCard();await card.getByRole('button',{name:'View selection',exact:true}).click();
  await this.until(async()=>{try{return JSON.parse(await this.page.locator('#detail-body').textContent()).operationId===this.requestId;}catch{return false;}},'the exact retained request detail');
  const detail=JSON.parse(await this.page.locator('#detail-body').textContent());this.verifyRequest(detail,{complete:true});
  await card.getByText('All received roots, retained merchants and original result',{exact:true}).click();
  const resultDetails=card.locator('details').filter({hasText:'All received roots, retained merchants and original result'});
  const visible=JSON.parse(await resultDetails.locator('pre').textContent());equal(visible,this.native);
  const text=await card.textContent();for(const root of this.native.roots)assert(JSON.stringify(visible.roots).includes(root.path));
  assert(text.includes(this.native.operationId)&&text.includes(this.paths.receivedBundle));
  const ref=await this.retained('observations/browser-'+label+'-result-'+this.state.calls.length+'.json',{request:detail,prepared:visible});
  await this.stage('browser-'+label+'-complete-result',{response:ref,roots:visible.roots.length,merchants:visible.summary.merchants.length});
  return detail;
 }
 async screenshot(label,width,height){
  await this.page.setViewportSize({width,height});await this.page.evaluate(()=>document.fonts.ready);
  const geometry=await this.page.evaluate(()=>({viewport:innerWidth,content:document.documentElement.scrollWidth,body:document.body.scrollWidth}));
  assert.equal(geometry.viewport,width);assert(geometry.content<=width+1&&geometry.body<=width+1,'The original operator must fit its selected viewport');
  const data=await this.page.screenshot({fullPage:true,animations:'disabled'});
  const path='screenshots/'+String(this.state.screenshots.length).padStart(3,'0')+'-'+label+'.png';
  const artifact=await this.retained(path,data);this.state.screenshots.push({label,...geometry,...artifact});await this.save();return artifact;
 }
 async connectedCommands(){
  const status=await this.cli('status');assert.equal(status.id,this.state.workspaceIdentity.workspaceId);assert.equal(status.directory,this.workspace);
  assert.equal(status.profiles.length,1);const profile=status.profiles[0];assert.equal(profile.id,this.profileId);assert.equal(profile.remoteConfigured,false);
  equal(profile.fleetRestores,this.host.profiles[0].fleetRestores);equal(profile.fleetTargets,this.host.profiles[0].fleetTargets);
  const bundles=await this.cli('bundles',['--profile',this.profileId]);
  const original=bundles.bundles.filter(row=>row.directory===this.paths.encrypted&&row.snapshotId===this.native.snapshotId);
  assert.equal(original.length,1);assert.equal(bundles.errors.length,0);
  await this.cli('inventory',['--profile',this.profileId,'--limit','1'],{expectedError:'WORKSPACE_REMOTE_STORE_NOT_CONFIGURED'});
  const operations=await this.cli('operations',['--profile',this.profileId,'--limit','1']);
  equal(operations,{operations:[],errors:[],nextCursor:null});
  await this.cli('operation',['--profile',this.profileId,'--id',this.requestId],{expectedError:'ENOENT'});
  const requests=await this.cli('requests',['--limit','1']);
  assert(requests.requests.length<=1);assert.equal(requests.nextCursor,null);
  for(const request of requests.requests)this.verifyRequest(request);
  const m=await this.merchant('status');assert.equal(m.id,status.id);assert.equal(m.directory,status.directory);
  await this.stage('original-running-cli-read-contracts',{commands:['status','bundles','inventory','operations','operation','requests'],
   remoteInventory:'WORKSPACE_REMOTE_STORE_NOT_CONFIGURED',remoteOperation:'ENOENT',localRequestNamespace:this.requestId,bundle:original[0]});
 }
 async callerMutationJoin(){
  const reviewed=await this.cli('review',['--selection',this.selectionFile]);this.validateReview(reviewed);
  assert.equal(reviewed.reviewHash,this.review.reviewHash);
  const merchantReview=await this.merchant('review',{selection:this.selection});this.validateReview(merchantReview);
  assert.equal(merchantReview.reviewHash,this.review.reviewHash);
  await this.lostBrowserResponse();
  const adoption=await this.completeRequest();
  if(this.state.adoptionAttempts!==undefined)assert.equal(adoption.attempts,this.state.adoptionAttempts);
  else{this.state.adoptionAttempts=adoption.attempts;await this.save();}
  const start=await this.cli('start',['--selection',this.selectionFile,'--expected-review-hash',this.review.reviewHash]);
  this.verifyRequest(start);await this.completeRequest();
  const resume=await this.cli('resume',['--profile',this.profileId,'--id',this.requestId]);this.verifyRequest(resume,{complete:true});
  const cancel=await this.cli('cancel',['--profile',this.profileId,'--id',this.requestId]);this.verifyRequest(cancel,{complete:true});
  const merchantStart=await this.merchant('start',{selection:this.selection,expectedReviewHash:this.review.reviewHash});this.verifyRequest(merchantStart);
  await this.completeRequest();
  const merchantResume=await this.merchant('resume',{profileId:this.profileId,id:this.requestId});this.verifyRequest(merchantResume,{complete:true});
  const last=await this.merchant('request',{profileId:this.profileId,id:this.requestId});this.verifyRequest(last,{complete:true});
  const page=await this.cli('requests',['--limit','1']);
  assert.equal(page.requests.length,1);assert.equal(page.nextCursor,null);this.verifyRequest(page.requests[0],{complete:true});
  assert(Number.isSafeInteger(page.requests[0].attempts)&&page.requests[0].attempts>=1);
  assert.equal(page.requests[0].attempts,this.state.adoptionAttempts,'Completed start/resume must retain the same actual workspace attempt count');
  const commands=new Set(this.state.calls.filter(row=>row.transport==='CLI'&&row.state==='RETURNED').map(row=>row.command));
  for(const command of ['status','bundles','inventory','requests','request','operations','operation','review','start','resume','cancel'])
   assert(commands.has(command),'Complete the original connected CLI command: '+command);
  await this.stage('eleven-cli-commands-and-original-merchant-tool-join',{commands:[...commands].sort(),
   tools:['merchant_recovery_status','merchant_recovery_review','merchant_recovery_start','merchant_recovery_request','merchant_recovery_resume'],
   requestId:this.requestId,attempts:page.requests[0].attempts,nativeOperationId:this.native.operationId});
 }
 async verifyOriginals(){
  const frozen=this.state.selection;
  for(const item of [frozen.native,frozen.originalTargets,frozen.originalManifest]){
   const current=await identity(item.path);assert.equal(current.bytes,item.bytes);assert.equal(current.sha256,item.sha256,'The original immutable native source or result changed');
  }
  for(const[path,expected]of Object.entries(frozen.sourceFiles)){
   const current=await identity(join(this.source,path));assert.equal(current.bytes,expected.bytes);assert.equal(current.sha256,expected.sha256);
  }
  for(const item of Object.values(frozen.runtimes)){const current=await identity(item.path);equal(current,item,'Keep the selected original runtime bytes');}
  const journey=await readJson(join(this.case,'journey.json'));
  assert.equal(journey.operationId,ORIGINAL);assert.equal(journey.state,'COMPLETE');equal(journey.input,(await readJson(join(this.directory,'source/original-journey-observation.json'))).input);
  equal(journey.paths,this.paths);equal(journey.environment,frozen.originalService);
  return{nativeReceivingSha256:frozen.native.sha256,targetsSha256:frozen.originalTargets.sha256,encryptedManifestSha256:frozen.originalManifest.sha256,
   snapshotId:this.native.snapshotId,nativeOperationId:this.native.operationId,originalOperationId:ORIGINAL};
 }
 async closeClient({proveOwner=false}={}){
  if(!this.client)return;const client=this.client;await client.close();assert.equal(client.summary.activeCalls,0);assert.equal(client.summary.closing,true);this.client=null;
  if(proveOwner){
   const status=await this.cli('status');assert.equal(status.id,this.state.workspaceIdentity.workspaceId);
   assert.equal(this.service?.exit,null,'Closing the merchant adapter must leave the original listener running');
   await this.stage('merchant-close-drains-original-listener-remains',{instanceId:this.launch.instanceId,workspaceId:status.id});
  }
 }
 async cleanup(){
  const errors=[];
  for(const operation of [()=>this.closeClient(),()=>this.closeBrowser(),()=>this.closeService()]){
   try{await operation();}catch(error){errors.push(error);}
  }
  await this.saveChain.catch(error=>errors.push(error));
  if(errors.length)throw new AggregateError(errors,'Close every owned original receiver resource');
 }
 async verifyCompleted(result){
  assert.equal(result.schema,SCHEMA);assert.equal(result.state,'COMPLETE');assert.equal(result.operationId,ORIGINAL+'.operator');
  equal(result.selection,this.state.selection.selection);equal(result.native,this.native);equal(result.workspaceIdentity,this.state.workspaceIdentity);
  await this.verifyOriginals();
  for(const item of result.artifacts){const observed=await identity(item.path);equal(observed,item);}
  assert(this.state.launches.every(row=>row.state==='INTERRUPTED_CLOSED'&&row.originalProcessesAbsent===true||row.state==='CLOSED'&&row.exit?.code===0&&row.launchRetired));
  assert(this.state.browserStarts.every(row=>row.state==='INTERRUPTED_CLOSED'&&row.originalProcessesAbsent===true||row.state==='CLOSED'&&row.disconnected===true));
  return result;
 }
 async run(){
  let result=null,problem=null;
  try{
   await this.bind();
   const resultPath=join(this.directory,'result.json');
   if(await exists(resultPath)){
    result=await this.verifyCompleted(await readJson(resultPath));this.state.state='COMPLETE';await this.save();
   }else if(this.state.completionCandidate){
    result=await this.verifyCompleted(this.state.completionCandidate);
    await exact(resultPath,json(result));this.state.state='COMPLETE';await this.save();
   }else{
    // A prior process may have stopped after any saved call. The current original
    // request is always read before another same-ID start or continuation.
    for(const row of this.state.calls)if(row.state==='STARTING')row.state='OUTCOME_UNKNOWN';
    await this.save();
    await this.reconcileOwnedHistory();await this.nativeInspection();await this.startService('operator');
    await this.connectedCommands();await this.openBrowser('operator');
    const raw=await this.rawDraft();await this.stage('raw-fleet-selection-reload',{source:raw.source,restoreId:raw.restoreId,
     fleetRestoreId:raw.fleetRestoreId,fleetTargetId:raw.fleetTargetId,operationId:raw.operationId,quiescenceReset:true});
    await this.canonicalBrowserReview();await this.screenshot('desktop-native-review',1440,1100);
    await this.callerMutationJoin();await this.inspectBrowserResult('completed');
    await this.screenshot('desktop-original-result',1440,1100);await this.screenshot('mobile-original-result',390,844);
    // Reopen an unfinished raw selection independently of the completed request.
    await this.rawDraft();const savedDraft=await this.rememberDraft();
    await this.closeClient({proveOwner:true});await this.closeBrowser();await this.closeService();
    await this.stage('original-listener-browser-closed-before-reopen',{nativeOperationId:this.native.operationId});
    await this.startService('cold-reopen');await this.openBrowser('cold-reopen');await this.assertRawDraft(savedDraft);
    const reopened=await this.cli('request',['--profile',this.profileId,'--id',this.requestId]);this.verifyRequest(reopened,{complete:true});
    const resumed=await this.merchant('resume',{profileId:this.profileId,id:this.requestId});this.verifyRequest(resumed,{complete:true});
    equal(reopened.operation,resumed.operation);await this.inspectBrowserResult('cold-reopened');
    await this.screenshot('cold-reopened-mobile',390,844);
    assert.equal(this.pageErrors.length,0,'The original operator raised a browser error');
    const originals=await this.verifyOriginals();
    await this.closeClient({proveOwner:true});await this.closeBrowser();await this.closeService();
    await this.stage('same-workspace-cold-reopen-and-originals-preserved',{...originals,workspaceId:this.state.workspaceIdentity.workspaceId,
     browserAssets:[...this.assets.values()],pageErrors:[]});
    const artifacts=[];
    for(const row of this.state.calls)for(const key of ['stdout','stderr','response','error'])if(row[key]?.path)artifacts.push(await identity(row[key].path));
    for(const row of this.state.launches)for(const key of ['stdout','stderr'])if(await exists(row[key]))artifacts.push(await identity(row[key]));
    for(const row of this.state.screenshots)artifacts.push(await identity(row.path));
    if(this.state.lostReply?.complete)artifacts.push(await identity(this.state.lostReply.complete.response.path));
    // Hash the retained stage observations as well as every native call.
    const walk=async path=>{for(const item of await readdir(path,{withFileTypes:true})){const name=join(path,item.name);
     if(item.isDirectory())await walk(name);else{assert(item.isFile()&&!item.isSymbolicLink());artifacts.push(await identity(name));}}};
    for(const sub of ['source','observations'])if(await exists(join(this.directory,sub)))await walk(join(this.directory,sub));
    result={schema:SCHEMA,state:'COMPLETE',operationId:ORIGINAL+'.operator',originalOperationId:ORIGINAL,
     productCommit:PRODUCT_COMMIT,sourceDirectory:this.source,caseDirectory:this.case,directory:this.directory,
     selection:this.selection,workspaceIdentity:this.state.workspaceIdentity,native:this.native,
     originalBindings:originals,stages:clone(this.state.stages),calls:clone(this.state.calls),launches:clone(this.state.launches),
     browsers:clone(this.state.browserStarts),screenshots:clone(this.state.screenshots),lostReply:clone(this.state.lostReply),
     artifacts:[...new Map(artifacts.map(item=>[item.path,item])).values()],completedAt:now()};
    this.state.completionCandidate=clone(result);await this.save();
    await this.verifyCompleted(result);await exact(resultPath,json(result));this.state.state='COMPLETE';await this.save();
   }
  }catch(error){problem=error;
   if(this.state){this.state.state='INTERRUPTED';this.state.lastError={at:now(),code:error.code??'FLEET_OPERATOR_RECEIVING_INTERRUPTED',message:error.message};
    await this.save().catch(()=>{});}
  }finally{
   try{if(this.state)await this.cleanup();}catch(error){problem??=error;}
   try{await this.lease?.release();}catch(error){problem??=error;}this.lease=null;
  }
  if(problem)throw problem;return result;
 }
}
export const HELP='Original managed-fleet operator receiving\n\n'+
 'node fleet-operator.mjs --source ABS_INSTALLED_SOURCE --case ABS_ORIGINAL_CASE --python ABS_ORIGINAL_PYTHON\n'+
 '  --chromium ABS_CHROMIUM --playwright ABS_PLAYWRIGHT_INDEX --quiesced [--directory ABS_CASE_SUBDIRECTORY] [--timeout-ms 120000]\n\n'+
 'Run after the original SCF-MANAGED-FLEET-RECOVERY-RECEIVING-7A2F-20261012 journey is COMPLETE and its producers are stopped.\n'+
 'Keep the same nonroot Linux service account, original passphrase environment, actual encrypted/plaintext/target paths and source closure.\n'+
 'This operator stage adopts that original native result, retains one request through browser/CLI/merchant tools, and cold-reopens the same workspace.\n'+
 'Its private result and progress stay inside the original case. Reinvoke the identical arguments after interruption; inspect a surviving original listener before its owner closes it.\n';
export function parseArguments(argv){
 if(argv.length===1&&['--help','-h'].includes(argv[0]))return{help:true};
 const keys={'--source':'sourceDirectory','--case':'caseDirectory','--directory':'directory','--python':'python',
  '--chromium':'chromiumPath','--playwright':'playwrightModule','--timeout-ms':'timeoutMs'};
 const result={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];if(flag==='--quiesced'){assert(!result.quiesced,'Repeat quiescence option');result.quiesced=true;continue;}
  const key=keys[flag],value=argv[++i];assert(key&&!Object.hasOwn(result,key)&&typeof value==='string'&&value&&!value.startsWith('--'),'Use the original documented receiving arguments');
  if(key==='timeoutMs'){assert(/^[1-9]\d*$/.test(value));result[key]=Number(value);}else result[key]=value;
 }
 for(const key of ['sourceDirectory','caseDirectory','python','chromiumPath','playwrightModule','quiesced'])assert(result[key]!==undefined,'Supply '+key);
 return result;
}
export async function main(argv=process.argv.slice(2)){
 const input=parseArguments(argv);if(input.help){process.stdout.write(HELP);return{help:true};}
 const result=await receiveFleetRecoveryOperator(input);
 process.stdout.write(JSON.stringify({status:result.state,operationId:result.operationId,originalOperationId:result.originalOperationId,
  requestId:result.selection.id,nativeOperationId:result.native.operationId,resultFile:join(result.directory,'result.json')})+'\n');
 return result;
}
if(process.argv[1]&&resolve(process.argv[1])===HERE)main().catch(error=>{
 process.stderr.write(JSON.stringify({error:{code:error.code??'FLEET_OPERATOR_RECEIVING_INTERRUPTED',message:error.message}})+'\n');process.exitCode=1;
});
