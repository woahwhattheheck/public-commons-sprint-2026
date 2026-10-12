// Continue the one completed original recovery case through the maintained MCP receiver.
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {readFile,open,mkdir,rename,stat} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';

const flags=process.argv.slice(2),selected={};
if(flags.length!==6)throw Error('Use --case ORIGINAL_NATIVE_RUN --source COMPLETE_SOURCE --output PRIVATE_MCP_CONTINUATION');
for(let i=0;i<flags.length;i+=2){
 if(!['--case','--source','--output'].includes(flags[i])||selected[flags[i]]||!flags[i+1])throw Error('ARGUMENTS_INVALID');
 selected[flags[i]]=resolve(flags[i+1]);
}
const caseRoot=selected['--case'],sourceRoot=selected['--source'],output=selected['--output'];
assert.ok(!output.startsWith(caseRoot+'/original-state/'));
const load=async p=>JSON.parse(await readFile(p,'utf8'));
const text=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
async function retain(path,value){
 const bytes=Buffer.from(typeof value==='string'?value:text(value)),tmp=path+'.pending';
 const h=await open(tmp,'w',0o600);
 try{await h.writeFile(bytes);await h.sync();}finally{await h.close();}
 await rename(tmp,path);const d=await open(dirname(path),'r');
 try{await d.sync();}finally{await d.close();}
}
const original=await load(join(caseRoot,'result.json'));
assert.equal(original.status,'COMPLETED');assert.equal(original.closed,true);
assert.equal(original.providerRequests,0);assert.equal(original.payments,0);
const stateRoot=join(caseRoot,'original-state'),journal=join(caseRoot,'receiver'),bundle=join(caseRoot,'encrypted-backup');
const originalBytes=await readFile(join(caseRoot,'result.json'));
const originalQueueModule=await import(pathToFileURL(join(sourceRoot,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs')));
const {startCollectionsWorkspace}=await import(pathToFileURL(join(sourceRoot,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/collections/server.mjs')));
const {initializeCollectionReceiver,openCollectionReceiver,startCollectionReceiver}=await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-paid-agent/native-collections-receiver.mjs')));
const {openMerchantFileClient}=await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-merchant-operator/retained-download.mjs')));
const {inspectNativeCollectionRecovery,downloadNativeCollectionRecovery,reopenNativeCollectionRecovery,openNativeCollectionRecoveryClient}=
 await import(pathToFileURL(join(sourceRoot,'stellar-forge/mcp-paid-agent/native-collections-recovery-download.mjs')));
const queue=()=>originalQueueModule.openQueue(join(stateRoot,'inbox'));
assert.equal(sha(text(await(await queue()).list())),original.originalJobSha256);
await mkdir(output,{recursive:true,mode:0o700});
const checkpoint=join(output,'checkpoint.json'),nativeRoot=join(output,'mcp-host'),downloadRoot=join(output,'received-original');
let saved=await load(checkpoint).catch(e=>{if(e.code==='ENOENT')return {
 schema:'scf.collection-recovery-mcp-continuation.v1',caseRoot,sourceRoot,
 originalResultSha256:sha(originalBytes),phases:[]};throw e;});
assert.equal(saved.caseRoot,caseRoot);assert.equal(saved.sourceRoot,sourceRoot);
assert.equal(saved.originalResultSha256,sha(originalBytes));
const phase=async(name,fn)=>{if(saved.phases.includes(name))return;console.log('PHASE '+name);
 await fn();saved.phases.push(name);await retain(checkpoint,saved);console.log('PASS '+name);};
const privateFile=join(output,'private-environment.json');
let privateEnv=await load(privateFile).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
if(!privateEnv){privateEnv={MCP_ACCESS_TOKEN:randomBytes(32).toString('hex')};await retain(privateFile,privateEnv);}
const environment={...process.env,...await load(join(caseRoot,'native-environment.json')),...privateEnv};
delete environment.MCP_OAUTH_CONFIG;delete environment.MCP_CLIENT_ORIGINS;
let listener,service,native,client,recovery;
const connectionFile=join(output,'original-listener.json'),profileFile=join(output,'original-profile.json');
const schema='stellar-forge.mcp-native-collection-recovery-profile.v1';
const profile={schema,label:'Original completed collection receiving case',stateRoot,bundle,
 passEnv:'SF88_BACKUP_PASSPHRASE',python:'/usr/bin/python3',kinds:['VERIFY','RESTORE'],
 afterRestore:{name:'restored',sources:{source:join(stateRoot,'operator','request.json'),empty:join(stateRoot,'inputs','empty.json')},
  buyers:{primary:join(stateRoot,'operator')}}};
async function originalApi(path){
 const response=await fetch(listener.origin+path,{headers:{authorization:'Bearer '+listener.token},signal:AbortSignal.timeout(30000)});
 const value=await response.json();assert.equal(response.status,200,JSON.stringify(value));return value;
}
async function connectMcp(){
 service=await startCollectionReceiver({directory:nativeRoot,port:saved.port??0,environment});
 const url=new URL(service.url);saved.port=Number(url.port);await retain(checkpoint,saved);
 client=await openMerchantFileClient({url:service.url,environment});
 recovery=await openNativeCollectionRecoveryClient({url:service.url,recoveryWorkspace:'receiver',environment});
}
async function closeMcp(){
 await service?.close();service=null;client=null;recovery=null;
}
async function cli(file,args){
 const child=spawn(process.execPath,[join(sourceRoot,file),...args],{env:environment,stdio:['ignore','pipe','pipe']});
 let out='',err='';child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);
 const code=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',done);});
 assert.equal(code,0,err);return JSON.parse(out);
}
const receiverCli='stellar-forge/mcp-paid-agent/native-collections-receiver-cli.mjs';
const downloadCli='stellar-forge/mcp-paid-agent/native-collections-recovery-download.mjs';
let final;
try{
 // All three originals already exist. Starting their receiver does not initialize another buyer.
 listener=await startCollectionsWorkspace({receivingDirectory:journal,port:0,environment});
 const announcement=await originalApi('/api/connection');
 assert.equal(announcement.receivingDirectory,journal);assert.equal(announcement.pid,process.pid);
 await retain(connectionFile,announcement);
 const buyer=await load(join(stateRoot,'operator','workspace.json'));
 // Use the manifest's actual original configured input path, without rebasing that workspace.
 const buyerModule=await import(pathToFileURL(join(sourceRoot,'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/workspace.mjs')));
 const originalBuyer=await buyerModule.openWorkspace(['--dir',join(stateRoot,'operator')]);
 assert.equal(buyer.directory,join(stateRoot,'operator'));profile.afterRestore.sources.source=originalBuyer.configPath;
 const profileText=text(profile),profileSha256=sha(profileText);
 let prior=await readFile(profileFile).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
 if(prior)assert.equal(sha(prior),profileSha256);else await retain(profileFile,profile);
 saved.profileSha256=profileSha256;
 const exists=await stat(nativeRoot).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});
 if(!exists)await initializeCollectionReceiver({directory:nativeRoot});
 native=await openCollectionReceiver(nativeRoot);
 const registration=await native.registerRecovery({name:'receiver',connectionFile,profiles:{original:profileFile}});
 assert.equal(registration.state,'ORIGINAL_RECOVERY_SERVICE_REGISTERED');
 await native.close();native=null;await connectMcp();
 const pin={profile:'original',expectedProfileSha256:profileSha256};
 const archivePin={...pin,requestId:original.restoreId,expectedRecordSha256:original.backupRecordSha256};
 const downloadOptions=()=>({url:service.url,recoveryWorkspace:'receiver',profile:'original',profileSha256,
  requestId:original.restoreId,recordSha256:original.backupRecordSha256,environment,directory:downloadRoot,
  expectedManifestSha256:saved.manifestSha256});
 await phase('original-profile-and-completed-operations',async()=>{
  const profiles=await recovery.call('profiles',{offset:0,limit:100});
  assert.equal(profiles.items.find(x=>x.name==='original').sha256,profileSha256);
  for(const requestId of [original.verifyId,original.restoreId]){
   const item=await recovery.call('inspect',{...pin,requestId});
   assert.equal(item.state,'COMPLETED');assert.equal(item.result.recordSha256,original.backupRecordSha256);
  }
  saved.originalVerifyId=original.verifyId;saved.originalRestoreId=original.restoreId;
  saved.recordSha256=original.backupRecordSha256;
 });
 // Reopen this same completed restore on each controller continuation; it never restores again.
 const opened=await recovery.call('open',archivePin);
 assert.equal(opened.opened,true);assert.equal(opened.restorationRepeated,false);
 assert.equal(opened.executionStarted,false);assert.equal(opened.registration.status,'ORIGINAL_COLLECTION_WORKSPACE_REGISTERED');
 await phase('restored-collection-and-original-buyer-selected',async()=>{
  const response=await client.call('sf43_discover_review_and_pay',{action:'collections',collectionWorkspace:'restored',
   collectionOperation:'inspect',collectionRequest:{id:original.collectionId,offset:0,limit:100}});
  assert.equal(response.value.manifestSha256,original.manifestSha256);
  assert.equal(response.value.items.find(x=>x.intentId==='collection.recovery.source').job.attempt.id,original.cancelledAttempt);
  assert.equal(response.value.items.find(x=>x.intentId==='collection.recovery.empty').state,'QUEUED');
  const buyers=await client.call('sf43_discover_review_and_pay',{action:'collections',collectionWorkspace:'restored',collectionOperation:'buyers'});
  assert.equal(buyers.value.items.find(x=>x.alias==='primary'||x.name==='primary')?.manifestSha256,
   sha(await readFile(join(stateRoot,'operator','workspace.json'))));
  const read=await cli(receiverCli,['opened','--dir',nativeRoot,'--name','receiver','--request-id',original.restoreId]);
  assert.equal(read.requestId,original.restoreId);saved.openedConnectionSha256=read.sha256;
 });
 await phase('original-encrypted-manifest-reviewed',async()=>{
  const inspection=await inspectNativeCollectionRecovery(downloadOptions());
  assert.equal(inspection.manifest.recordSha256,original.backupRecordSha256);
  assert.equal(inspection.manifestSha256,sha(await readFile(join(bundle,'manifest.json'))));
  saved.manifestSha256=inspection.manifestSha256;saved.encryptedMembers=inspection.manifest.files;
 });
 await phase('durable-partial-download',async()=>{
  const controller=new AbortController();let progress;
  try{
   await downloadNativeCollectionRecovery({...downloadOptions(),chunkSize:128,signal:controller.signal,
    onProgress:p=>{if(!progress&&p.bytes>0&&p.bytes<p.total){progress=p;controller.abort();}}});
   throw Error('EXPECTED_ORIGINAL_PARTIAL_CHECKPOINT');
  }catch(error){if(!controller.signal.aborted)throw error;}
  assert.ok(progress?.bytes>0&&progress.bytes<progress.total);
  saved.partial={filename:progress.file,bytes:progress.bytes,total:progress.total};
  saved.originalMcpUrl=service.url;
 });
 await phase('mcp-cold-restart-keeps-original-listener',async()=>{
  const port=saved.port;await closeMcp();
  const before=await originalApi('/api/connection');assert.equal(before.pid,process.pid);
  await connectMcp();assert.equal(saved.port,port);assert.equal(service.url,saved.originalMcpUrl);
  const originalStatus=await recovery.call('inspect',{...pin,requestId:original.restoreId});
  assert.equal(originalStatus.state,'COMPLETED');assert.equal(originalStatus.requestId,original.restoreId);
 });
 await phase('same-download-resumed-and-complete',async()=>{
  const result=await downloadNativeCollectionRecovery({...downloadOptions(),chunkSize:65536});
  assert.equal(result.state,'COMPLETE');assert.ok(result.resumedBytes>=saved.partial.bytes);
  assert.equal(result.manifestSha256,saved.manifestSha256);
  for(const file of saved.encryptedMembers){
   const local=await readFile(join(downloadRoot,file.name)),source=await readFile(join(bundle,file.name));
   assert.equal(local.length,file.bytes);assert.equal(sha(local),file.sha256);assert.deepEqual(local,source);
  }
  assert.deepEqual(await readFile(join(downloadRoot,'manifest.json')),await readFile(join(bundle,'manifest.json')));
  saved.received={files:result.files,bytes:result.bytes,resumedBytes:result.resumedBytes,encrypted:true,
   decrypted:result.decrypted,restored:result.restored};
 });
 await phase('sdk-cli-offline-reopen-and-original-terminal-history',async()=>{
  await listener.close();listener=null;
  const originalStatus=await recovery.call('inspect',{...pin,requestId:original.restoreId});
  assert.equal(originalStatus.state,'COMPLETED');assert.equal(originalStatus.requestId,original.restoreId);
  const reopened=await reopenNativeCollectionRecovery(downloadOptions());
  assert.equal(reopened.state,'COMPLETE');assert.equal(reopened.executionStarted,false);
  const selection=['--workspace','receiver','--profile','original','--profile-sha256',profileSha256,
   '--request-id',original.restoreId,'--record-sha256',original.backupRecordSha256,
   '--dir',downloadRoot,'--manifest-sha256',saved.manifestSha256];
  const result=await cli(downloadCli,['reopen',...selection]);
  assert.equal(result.state,'COMPLETE');assert.equal(result.requestId,original.restoreId);
  saved.offlineReopen=true;
 });
 assert.equal(sha(text(await(await queue()).list())),original.originalJobSha256);
 assert.equal(sha(await readFile(join(caseRoot,'result.json'))),saved.originalResultSha256);
 final={...saved,status:'COMPLETED',completedAt:new Date().toISOString(),providerRequests:0,payments:0,
  newRestoreOperations:0,newBuyerWorkspaces:0,originalQueueChanged:false,closed:true};
}finally{
 await closeMcp();await native?.close();await listener?.close();
 if(final){await retain(join(output,'result.json'),final);console.log('COMPLETE '+join(output,'result.json'));}
}
