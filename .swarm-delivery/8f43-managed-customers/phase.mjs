// MIT. One caller of the maintained distribution, installer and original customer journeys.
import {readFile,writeFile,copyFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const phase=process.argv[2], intent=JSON.parse(await readFile(process.argv[3],'utf8'));
const root=intent.project, result=join(root,'results');
const save=async(name,value)=>writeFile(join(result,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const read=async path=>JSON.parse(await readFile(path,'utf8'));
const load=async name=>import(pathToFileURL(join(intent.builderDirectory,name)).href);
const progress=event=>process.stdout.write(JSON.stringify({phase,...event})+'\n');
const fail=message=>{throw new Error(message);};
await mkdir(result,{recursive:true,mode:0o700});
try {
 if(phase==='build'){
  const {buildDistribution}=await load('build.mjs');
  const built=await buildDistribution({repository:intent.sourceCache,ref:intent.sourceCommit,
   output:join(root,'release'),offline:true,resume:false,python:intent.python,onProgress:progress});
  if(built.sourceCommit!==intent.sourceCommit)fail('Built source commit differs');
  await save('build.json',built);
  await copyFile(built.archive,join(result,'source.tgz'));
  progress({status:built.status,sourceCommit:built.sourceCommit,sha256:built.sha256,archiveBytes:built.archiveBytes});
 } else if(phase==='prepare'){
  const built=await read(join(result,'build.json'));
  const {prepareRuntimeInstall}=await load('runtime-install.mjs');
  const prepared=await prepareRuntimeInstall({directory:intent.runtimeDirectory,archive:built.archive,
   sha256:built.sha256,native:true,features:['freighter-wallet'],pins:{'@stellar/stellar-sdk':'16.3.1'},
   operator:true,python:intent.python});
  await save('prepare.json',prepared);progress({status:prepared.status,sourceCommit:prepared.sourceCommit});
 } else if(phase==='install'){
  const {installRuntime}=await load('runtime-install.mjs');
  const installed=await installRuntime({directory:intent.runtimeDirectory,offline:true,
   cache:intent.npmCache,npm:intent.npm});
  await save('installation.json',installed);
  if(installed.status!=='READY'||installed.ready!==true)fail('Original installer has not returned READY');
  const plan=await read(join(intent.runtimeDirectory,'runtime-install.json'));
  const state=await read(join(intent.runtimeDirectory,'install-state.json'));
  const profile=await read(join(intent.runtimeDirectory,'runtime-profile.json'));
  const manifest=await readFile(join(intent.runtimeDirectory,'package','manifest.json'));
  const manifestSha256=createHash('sha256').update(manifest).digest('hex');
  if(plan.source.sourceCommit!==intent.sourceCommit||manifestSha256!==plan.source.manifestSha256||
     state.phase!=='READY'||state.lockSha256!==installed.lockSha256)fail('Original READY binding changed');
  const ready={status:'READY',observedAt:new Date().toISOString(),runtimeDirectory:intent.runtimeDirectory,
   sourceCommit:plan.source.sourceCommit,sourceRoot:plan.sourceRoot,manifestSha256,
   installationId:plan.installationId,profileId:profile.profileId,lockSha256:state.lockSha256,
   sourceArchiveSha256:plan.archiveSha256,selection:profile.selection,
   dependencies:profile.dependencies.map(({name,version})=>({name,version}))};
  await save('READY.json',ready);progress(ready);
 } else if(phase==='feeds'){
  const ready=await read(join(result,'READY.json'));
  const {receiveFeedManagedApplication}=await import(pathToFileURL(join(intent.receivingDirectory,'managed-rss-atom-receiving.mjs')).href);
  const template=await read(join(intent.receivingDirectory,'feed-config-template.json'));
  const config={...template,runtimeDirectory:ready.runtimeDirectory,expectedSourceCommit:ready.sourceCommit,
   expectedManifest:ready.manifestSha256,bootstrapSourceRoot:ready.sourceRoot,
   receptionDirectory:join(root,'feed-reception')};
  delete config.applicationWorkspace;delete config.homeId;
  await save('feed-config.json',config);
  const received=await receiveFeedManagedApplication(config,{onProgress:progress});
  await save('feed-managed-reception.json',received);
  progress({status:'COMPLETED',applicationId:received.applicationId,passes:received.passes.length});
 } else if(phase==='wallet'){
  const ready=await read(join(result,'READY.json')),feed=await read(join(result,'feed-managed-reception.json'));
  const {receiveWalletInBrowser}=await import(pathToFileURL(join(intent.receivingDirectory,'browser-receiving.mjs')).href);
  const config={operationId:'SCF-BROWSER-WALLET-8F43-20261012',
   runtimeDirectory:ready.runtimeDirectory,expectedSourceCommit:ready.sourceCommit,
   expectedManifest:ready.manifestSha256,bootstrapSourceRoot:ready.sourceRoot,
   walletDirectory:'/dev/shm/commons-8f43-wallet-customer/operator-wallet',
   operatorWorkspace:'/workspace/scratch/39daa82f3fbd/routescan_native_39da/operator-workspace',
   expectedWalletId:'e686d395-0366-499e-a63a-4d4758e815df',
   browserExecutable:'/workspace/scratch/bc0850d7ba23/browser-runtime/chrome-headless-shell',
   receptionDirectory:join(root,'wallet-reception'),applicationWorkspace:feed.selection.applicationWorkspace};
  await save('wallet-config.json',config);
  const received=await receiveWalletInBrowser(config,{onProgress:progress});
  await save('wallet-managed-reception.json',received.result);
  await save('wallet-browser-reception.json',received.browser);
  progress({status:'COMPLETED',applicationId:received.result.applicationId,passes:received.result.passes.length,browserVisits:received.browser.visits.length});
 } else fail('Unknown original receiving phase');
} catch(error){
 await save(phase+'-error.json',{phase,at:new Date().toISOString(),code:error.code??error.name,
  message:String(error.message),missingObjects:error.missingObjects??null,sourceCommit:error.sourceCommit??null,
  stack:String(error.stack??'')});
 throw error;
}
