import { readFile, writeFile, mkdir, lstat, rename } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const configuration=JSON.parse(await readFile(process.argv[2],'utf8'));
const {work, sourceCommit, sourceTree, originalRoot, metadata, builderDirectory, donorRepositories, incomingDirectory, node, python, npm}=configuration;
process.env.PATH=configuration.nodeBin+':'+process.env.PATH;
const result={schema:'starforge.following-source-native-receiving.v1',sourceCommit,sourceTree,work,startedAt:new Date().toISOString(),stages:[],complete:false};
const hash=b=>createHash('sha256').update(b).digest('hex');
const gitBlob=b=>createHash('sha1').update('blob '+b.length+'\0').update(b).digest('hex');
async function save(name,value){const p=join(work,name),t=p+'.pending';await writeFile(t,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(t,p);}
function emit(value){process.stdout.write(JSON.stringify(value)+'\n');}
async function stage(name,workfn){emit({phase:name,state:'STARTED'});const value=await workfn();result.stages.push({name,completedAt:new Date().toISOString(),result:value});await save('native-result.json',result);emit({phase:name,state:'COMPLETE',status:value?.status??value?.state??value?.phase??null});return value;}
async function execute(command,args,{codes=[0],capture=false,cwd=work,env=process.env}={}){return await new Promise((resolveResult,reject)=>{let chunks=[];const child=spawn(command,args,{cwd,env,stdio:['ignore',capture?'pipe':'inherit','inherit'],shell:false});if(capture)child.stdout.on('data',b=>chunks.push(b));const stop=signal=>child.kill(signal);const a=()=>stop('SIGINT'),b=()=>stop('SIGTERM');process.on('SIGINT',a);process.on('SIGTERM',b);const close=()=>{process.off('SIGINT',a);process.off('SIGTERM',b);};child.once('error',error=>{close();reject(error);});child.once('close',(code,signal)=>{close();if(codes.includes(code))resolveResult({code,signal,...(capture?{stdout:Buffer.concat(chunks).toString('utf8')}:{})});else reject(Object.assign(new Error(command+' failed: '+(signal??code)),{code:'ORIGINAL_COMMAND_FAILED',exitCode:code,signal}));});});}
async function exists(path){return await lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});}
try{
 if(!/^[a-f0-9]{40}$/.test(sourceCommit)||sourceCommit!=='891b207201025a152ba284b622c0b93dde70b906')throw Error('Original selected source changed');
 const metadataBytes=await readFile(metadata);
 if(hash(metadataBytes)!==configuration.metadataSha256)throw Error('Original source metadata changed');
 const frozenMetadata=JSON.parse(metadataBytes);
 if(frozenMetadata.source.commit!==sourceCommit||frozenMetadata.source.tree!==sourceTree||frozenMetadata.requiredPaths.length!==configuration.expectedSourceFiles)throw Error('Original source selection differs');
 const builder=JSON.parse(await readFile(join(originalRoot,'builder-input.json'),'utf8'));
 if(builder.sourceCommit!==sourceCommit)throw Error('Original builder input changed');
 for(const item of builder.files){const data=await readFile(join(builderDirectory,item.name));if(gitBlob(data)!==item.sha)throw Error('Original builder file changed: '+item.name);}
 const producer=await readFile(builder.originalProducer.path);
 if(gitBlob(producer)!==builder.originalProducer.sha)throw Error('Original run-release source changed');
 const receiver=join(builderDirectory,'git-object-receiving.py'),cacheDirectory=join(work,'source-cache'),repository=join(cacheDirectory,'repository.git');
 await stage('original_git_object_receiving',async()=>{
  const args=[receiver,'--metadata',metadata,'--commit',sourceCommit,'--directory',cacheDirectory];
  for(const donor of donorRepositories)args.push('--donor-repository',donor);
  args.push('--incoming',incomingDirectory);
  const completed=await execute(python,args,{codes:[0,2],capture:true});
  const state=JSON.parse(await readFile(join(cacheDirectory,'source-receiving.json'),'utf8'));
  return {exitCode:completed.code,...state};
 });
 await stage('original_https_source_transport',async()=>{
  const transport=await execute('git',['-C',donorRepositories[0],'config','--get','remote.origin.url'],{capture:true});
  const remote=transport.stdout.trim();
  if(remote!=='https://github.com/woahwhattheheck/public-commons-sprint-2026.git')throw Error('Original source remote changed');
  if(await exists(join(repository,'config'))){
   const present=await execute('git',['-C',repository,'config','--get','remote.origin.url'],{capture:true,codes:[0,1]});
   if(present.code===0&&present.stdout.trim()!==remote)throw Error('Owned receiving cache remote changed');
  }
  await execute('git',['-C',repository,'config','remote.origin.url',remote]);
  await execute('git',['-C',repository,'config','remote.origin.promisor','true']);
  await execute('git',['-C',repository,'config','remote.origin.partialclonefilter','blob:none']);
  return {repository,remote,sourceCommit,sourceTree,originalDonorsReadOnly:true};
 });
 const operationRoot=join(work,'source-operation');await mkdir(operationRoot,{mode:0o700,recursive:true});
 const intent={schema:'starforge.following-source-release-operation.v1',operationRoot,builderDirectory,
  builderFiles:builder.files.map(({name,content})=>{const bytes=Buffer.from(content);return {name,bytes:bytes.length,sha256:hash(bytes)};}),sourceCache:repository,sourceCommit,sourceTree,
  releaseDirectory:join(work,'release'),installedDirectory:join(work,'source-install')};
 const intentPath=join(work,'release-intent.json');const intentBytes=JSON.stringify(intent,null,2)+'\n';
 if(await exists(intentPath)){if(await readFile(intentPath,'utf8')!==intentBytes)throw Error('Original release intent changed');}
 else await writeFile(intentPath,intentBytes,{mode:0o600,flag:'wx'});
 const installed=await stage('complete_original_source_package_and_install',async()=>{
  await execute(node,[builder.originalProducer.path,intentPath],{env:{...process.env,PATH:configuration.nodeBin+':'+process.env.PATH}});
  const value=JSON.parse(await readFile(join(operationRoot,'installation.json'),'utf8'));
  if(value.state!=='SOURCE_INSTALLED'||value.sourceCommit!==sourceCommit||value.sourceTree!==sourceTree||!Number.isSafeInteger(value.sourceFiles)||value.sourceFiles<configuration.expectedSourceFiles)throw Error('Full original source installation is incomplete');
  const manifest=JSON.parse(await readFile(join(value.packageRoot,'manifest.json'),'utf8'));
  const included=new Map(manifest.files.map(item=>[item.path,item]));
  const original=new Map(frozenMetadata.tree.tree.map(item=>[item.path,item]));
  for(const path of frozenMetadata.requiredPaths){const a=included.get(path),b=original.get(path);if(!a||!b||a.gitBlob!==b.sha||a.bytes!==b.size||a.mode!==b.mode)throw Error('A frozen source member differs: '+path);}
  if(included.size!==value.sourceFiles)throw Error('Original manifest source count differs');
  return {...value,requiredSourceFilesVerified:frozenMetadata.requiredPaths.length};
 });
 const sourceRoot=join(installed.packageRoot,'source'),distribution=join(sourceRoot,'stellar/scf-starforge-20261009/distribution');
 const installer=await import(pathToFileURL(join(distribution,'runtime-install.mjs')));
 const runtimeDirectory=join(work,'runtime'),npmCache=join(work,'npm-cache');await mkdir(npmCache,{mode:0o700,recursive:true});
 await stage('native_mcp_operator_profile_prepare',async()=>{
  if(await exists(join(runtimeDirectory,'runtime-install.json'))){const retained=await installer.inspectRuntimeInstall({directory:runtimeDirectory,load:false,source:true,python});if(retained.sourceCommit!==sourceCommit)throw Error('Retained runtime source changed');return retained;}
  return installer.prepareRuntimeInstall({
  directory:runtimeDirectory,archive:installed.receipt.archive,sha256:installed.receipt.sha256,
  native:true,features:['timescale','mcp','graphql','schema','openapi'],pins:{'@stellar/stellar-sdk':'16.3.1'},operator:true,python
 });});
 await stage('original_locked_dependency_install',()=>installer.installRuntime({directory:runtimeDirectory,cache:npmCache,npm,offline:false}));
 const ready=await stage('ready_source_and_import_readback',()=>installer.inspectRuntimeInstall({directory:runtimeDirectory,load:true,source:true,python}));
 if(ready.status!=='READY'||!ready.ready||ready.sourceCommit!==sourceCommit)throw Error('The original installed runtime is not READY');
 await stage('original_installed_source_entrypoint',async()=>{
  const command=await installer.runtimeCommand({directory:runtimeDirectory,args:['source']});
  const observed=await execute(command.executable,command.args,{capture:true,cwd:command.cwd});
  const value=JSON.parse(observed.stdout);await save('installed-source-command.json',value);
  return {command,output:value};
 });
 const transferModule=await import(pathToFileURL(join(distribution,'runtime-transfer.mjs')));
 const transferDirectory=join(work,'runtime-transfer');
 const exported=await stage('complete_original_runtime_transfer',()=>transferModule.exportRuntimeTransfer({
  runtimeDirectory,directory:transferDirectory,cache:npmCache,npm,offline:true,expectedLockSha256:ready.state.lockSha256,
  onProgress:async p=>{if(p.phase!=='PACKAGES'||p.completed%20===0||p.completed===p.total)emit({phase:'runtime_transfer',...p});}
 }));
 const transfer=await stage('full_transfer_manifest_and_part_readback',()=>transferModule.inspectRuntimeTransfer({directory:transferDirectory,verify:true}));
 if(!transfer.complete||transfer.manifest.runtime.sourceCommit!==sourceCommit||transfer.parts.some(x=>x.status!=='VERIFIED'))throw Error('The complete runtime carrier is not verified');
 const receivingDirectory=join(work,'transfer-receiving');
 await stage('original_transfer_receiving',async()=>{
  const manifest=await readFile(join(transferDirectory,'manifest.json'));
  await transferModule.beginRuntimeTransferReceive({directory:receivingDirectory,manifest,manifestSha256:transfer.manifestSha256});
  for(const part of transfer.parts)await transferModule.receiveRuntimeTransferPart({directory:receivingDirectory,index:part.index,file:join(transferDirectory,'parts',part.name)});
  const received=await transferModule.completeRuntimeTransferReceive({directory:receivingDirectory,populateCache:false,npm});
  if(!received.complete||!received.filesDirectory||received.manifestSha256!==transfer.manifestSha256)throw Error('Original complete transfer receiving failed');
  return {complete:received.complete,manifestSha256:received.manifestSha256,transferId:received.manifest.transferId,files:received.manifest.files.length,bytes:received.manifest.payload.bytes,filesDirectory:received.filesDirectory};
 });
 const reopened=await stage('installed_runtime_reopen',()=>installer.inspectRuntimeInstall({directory:runtimeDirectory,load:true,source:true,python}));
 if(reopened.installationId!==ready.installationId||reopened.profileId!==ready.profileId||reopened.state.lockSha256!==ready.state.lockSha256||!reopened.ready)throw Error('Original runtime identity changed on reopen');
 result.complete=true;result.completedAt=new Date().toISOString();result.installation={directory:runtimeDirectory,installationId:ready.installationId,profileId:ready.profileId,lockSha256:ready.state.lockSha256,sourceCommit,sourceRoot:ready.sourceRoot,entrypoint:ready.entrypoint};
 result.archive={path:installed.receipt.archive,bytes:installed.receipt.archiveBytes,sha256:installed.receipt.sha256};
 result.transfer={directory:transferDirectory,manifestSha256:transfer.manifestSha256,transferId:transfer.manifest.transferId,parts:transfer.parts.length,payloadBytes:transfer.manifest.payload.bytes,receivingDirectory};
 await save('native-result.json',result);emit({phase:'COMPLETE',complete:true,sourceCommit,archive:result.archive,installation:result.installation,transfer:result.transfer});
}catch(error){result.failedAt=new Date().toISOString();result.error={code:error.code??error.name,message:error.message,stack:error.stack};await save('native-result.json',result).catch(()=>{});emit({phase:'FAILED',complete:false,error:result.error,completedStages:result.stages.map(x=>x.name)});process.exitCode=1;}
