#!/usr/bin/env node
// Compose the original published Fiscal receiver and briefing on one existing worker.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
process.umask(0o077);
const root=path.dirname(fileURLToPath(import.meta.url));
const inbox=path.join(root,'inbox'),out=path.join(root,'worker-output');
const configBytes=await fs.readFile(path.join(inbox,'worker-config.json'));
const originalConfig=JSON.parse(configBytes);
const runtime=JSON.parse(await fs.readFile(path.join(root,'worker-runtime.json'),'utf8'));
const config={...originalConfig,node:runtime.node,playwrightModules:runtime.playwrightModules,chromium:runtime.chromium};
const OP='fiscal-treasury-briefing-7108-20261012';
const ORIGINAL='dab0a492-74e0-4e10-8d99-861880b3153d';
const PACKAGE_SHA='f78d3a6bd72f529d14c4cd24d9f89f9e99ab83fc97579c4574e032f5a4318788';
const DRIVER_SHA='bd43b52210fd4920389412812b00f25da20802cf74df80399435aebcba8b8b7a';
const COMPONENT='stellar/scf-starforge-20261009/sf30-seller-sdk/fiscaldata';
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const blob=b=>crypto.createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
const need=(value,message)=>{if(!value)throw Error(message);};
need(config.schema==='fiscal-briefing-worker.v1'&&config.operationId===OP&&config.directory===root,'Original worker selection changed');
need(runtime.schema==='fiscal-briefing-worker-runtime.v1'&&runtime.configurationSha256===hash(configBytes),'Retain the setup-selected runtime for this exact input');
for(const field of ['operationId','workerId','sandboxId','directory'])need(runtime[field]===originalConfig[field],'Original runtime identity changed: '+field);
need(config.workerId==='SCF-DURABLE-PAID-JOBS-0B8D-20261011-e2b-01'&&config.sandboxId==='i7uwmcqmeoxkb7g74x51o','Original worker binding changed');
need(Number(process.versions.node.split('.')[0])>=22,'Use the selected existing Node22+ runtime');
need(await fs.realpath(config.node)===await fs.realpath(process.execPath),'Use the selected Node executable');
for(const key of ['playwrightModules','chromium'])need(path.isAbsolute(config[key]),'Retain the actual existing '+key+' path');
await fs.mkdir(out,{recursive:true,mode:0o700});
const receipt={schema:'fiscal-briefing-worker-receiving.v1',operationId:OP,workerId:config.workerId,sandboxId:config.sandboxId,startedAt:new Date().toISOString(),stages:[]};
async function publish(name,value){
 const target=path.join(out,name),temporary=target+'.'+crypto.randomUUID()+'.part';
 const f=await fs.open(temporary,'wx',0o600);try{await f.writeFile(JSON.stringify(value,null,2)+'\n');await f.sync();}finally{await f.close();}
 await fs.rename(temporary,target);const d=await fs.open(out,'r');try{await d.sync();}finally{await d.close();}
}
async function step(stage,detail){receipt.stages.push({stage,at:new Date().toISOString(),...detail});await publish('progress.json',receipt);process.stdout.write(stage+'\n');}
async function command(label,args,env={}){
 await step(label,{argv:args});
 const result=await new Promise((resolve,reject)=>{const p=spawn(args[0],args.slice(1),{cwd:root,stdio:['ignore','inherit','inherit'],env:{...process.env,...env,PYTHONDONTWRITEBYTECODE:'1'}});p.on('error',reject);p.on('close',(code,signal)=>resolve({code,signal}));});
 need(result.code===0,label+' failed: '+JSON.stringify(result));return result;
}
async function original(name,expectedBlob,expectedSha){
 const p=path.join(inbox,name),st=await fs.lstat(p);need(st.isFile()&&!st.isSymbolicLink(),'Use a regular original input: '+name);
 const bytes=await fs.readFile(p);if(expectedBlob)need(blob(bytes)===expectedBlob,'Original source blob changed: '+name);if(expectedSha)need(hash(bytes)===expectedSha,'Original input hash changed: '+name);return bytes;
}
let unlockRoot=null;
try{
 const publicReceiver=path.join(inbox,'receive-public-source.mjs');
 await original('receive-public-source.mjs','dbb784b7e944b75fe08b725150c1756d5d871e7d');
 await command('PUBLIC_SOURCE_ACQUISITION',[config.node,publicReceiver,'--source',path.join(root,'source'),'--work',path.join(root,'source-acquisition'),'--operation','fiscal-briefing-source-7108-20261012','--acquire-only']);
 const helpers=await import(pathToFileURL(path.join(root,'source/stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs')));
 unlockRoot=await helpers.acquireWorkspace(root);
 async function exact(target,bytes){
  await helpers.privateDirectory(path.dirname(target),true);
  try{need((await helpers.readPrivate(target,bytes.length+1)).equals(bytes),'Retained file differs: '+target);return;}catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=target+'.'+crypto.randomUUID()+'.pending';await helpers.createFile(temporary,bytes);
  await fs.rename(temporary,target);await helpers.syncDirectory(path.dirname(target));
 }
 const sourceInputs=[
  ['briefing.mjs','40ed1a56c912261d4184d328489e811c6a8e231d'],
  ['briefing-render.mjs','201452295199b14e25f7d41801e9dbefcc148a30'],
  ['briefing-cli.mjs','5936cc3c8b7aef87d2bcfc5109842f54102d4fd8'],
  ['BRIEFING.md','6d33760f8b65ed075ffbfbd6da041dc68eef5fb3'],
  ['portable.mjs','cf16aa02aa6100a502b03ac865a6dc6700148c8a']
 ];
 for(const [name,expected] of sourceInputs)await exact(path.join(root,'source',COMPONENT,name),await original(name,expected));
 await step('EXACT_SOURCE_COMPOSED',{base:'0f6899160c46614105dfa9353ec898df37e11a0c',briefing:'210bee08e63ab4cba553a1db1b83f7da0bfeea97',portable:'194c7158140f9b7ffb12424524b4666077031127',sourceInputs});
 const portable=await import(pathToFileURL(path.join(root,'source',COMPONENT,'portable.mjs')));
 const packagePath=path.join(inbox,'workspace.fiscal.gz');
 await original('workspace.fiscal.gz',null,PACKAGE_SHA);
 const inspection=await portable.inspectFiscalSourcePackage({packagePath,expectedSha256:PACKAGE_SHA});
 need(inspection.manifest.workspace.id===ORIGINAL&&inspection.manifest.workspace.revision===60&&inspection.manifest.files.length===226,'Original accepted checkpoint changed');
 const directory=path.join(root,'retained-workspace');
 const received=await portable.receiveFiscalSourcePackage({directory,packagePath,expectedSha256:PACKAGE_SHA,operationId:'fiscal-briefing-source-receiving-7108-20261012',actor:{id:'7108-original-fiscal-receiver',label:'Original Fiscal Treasury receiving operator'}});
 need(received.originalWorkspace.id===ORIGINAL&&received.originalWorkspace.revision===60&&received.originalFiles===226&&received.workspace.id===ORIGINAL&&received.workspace.revision===61,'Original portable receiving identity changed');
 await step('ORIGINAL_WORKSPACE_RECEIVED',{received,packageSha256:PACKAGE_SHA});
 const originalDriver=await original('receive-briefing.original.mjs','3b034f8e953e4ad9af0d5e285fd9b4667beab908',DRIVER_SHA);
 const changes=[
  {from:"const workspace='/workspace/scratch/7108267765ab/fiscal-customer/retained-workspace';",to:'const workspace='+JSON.stringify(directory)+';'},
  {from:'originalHeader.revision===60',to:'originalHeader.revision===61'},
  {from:"executablePath:'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell'",to:'executablePath:'+JSON.stringify(config.chromium)}
 ];
 let continuation=originalDriver.toString('utf8');
 for(const change of changes){need(continuation.split(change.from).length===2,'Exact original caller seam changed');continuation=continuation.replace(change.from,change.to);}
 const continuationBytes=Buffer.from(continuation),driver=path.join(root,'receive-briefing.continuation.mjs');
 await exact(driver,continuationBytes);
 await exact(path.join(root,'caller-substitutions.json'),Buffer.from(JSON.stringify({schema:'fiscal-briefing-worker-source-continuation.v1',operationId:OP,original:{blob:'3b034f8e953e4ad9af0d5e285fd9b4667beab908',sha256:DRIVER_SHA,bytes:originalDriver.length},continuation:{blob:blob(continuationBytes),sha256:hash(continuationBytes),bytes:continuationBytes.length},changes,sourceReceiving:{operationId:received.operationId,packageSha256:PACKAGE_SHA,originalRevision:60,currentRevision:61}},null,2)+'\n'));
 await command('ORIGINAL_BRIEFING_RECEIVING',[config.node,driver],{CODEX_PRIMARY_RUNTIME_NODE_MODULES:config.playwrightModules});
 const result=JSON.parse(await fs.readFile(path.join(root,'native-output/receiving-result.json'),'utf8'));
 need(result.state==='COMPLETE'&&result.comparisonId==='1e596687-510e-47bd-8cd0-cc27c93d3214'&&result.exportId==='8128e1aa-4363-43c4-ba3b-c3567089a66e','Original briefing did not complete');
 const header=JSON.parse(await fs.readFile(path.join(directory,'workspace.json'),'utf8'));
 need(header.id===ORIGINAL&&header.revision===61&&header.restoredFrom?.revision===60,'Received source revision changed during report');
 const receivedArtifacts=[];
 async function retainReturn(source,name,expected={}){
  const relative=path.relative(root,source);
  need(relative!==''&&relative!=='..'&&!relative.startsWith('../')&&!path.isAbsolute(relative),'Native return source leaves original operation');
  const info=await fs.lstat(source);need(info.isFile()&&!info.isSymbolicLink(),'Native return requires an original regular file');
  need(info.size<=16*1024*1024,'Native return exceeds its declared original output allowance');
  const bytes=await helpers.readPrivate(source,info.size+1),sha256=hash(bytes);
  need(bytes.length===info.size&&(expected.size===undefined||bytes.length===expected.size)&&(!expected.sha256||sha256===expected.sha256),'Original native return identity differs');
  const destination=path.join(out,name);await exact(destination,bytes);
  const verified=await helpers.hashPrivate(destination,bytes.length+1);
  need(verified.bytes===bytes.length&&verified.hash===sha256,'Retained native return differs');
  receivedArtifacts.push({path:path.relative(root,destination),bytes:bytes.length,sha256,source:relative});
 }
 await retainReturn(result.output.archive.path,'customer-briefing.tar.gz',result.output.archive);
 await retainReturn(path.join(result.output.directory,'manifest.json'),'customer-briefing-manifest.json',{sha256:result.output.manifestSha256});
 const history=[];
 async function retainHistory(directory){
  for(const entry of (await fs.readdir(directory,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
   const source=path.join(directory,entry.name);
   if(entry.isDirectory()){if(entry.name!=='qa'&&entry.name!=='downloads')await retainHistory(source);continue;}
   if(!entry.name.endsWith('.json'))continue;
   need(entry.isFile(),'Original JSON receiving history is not a regular file');
   const bytes=await helpers.readPrivate(source,8*1024*1024);
   history.push({path:path.relative(root,source),bytes:bytes.length,sha256:hash(bytes),content:bytes.toString('utf8')});
  }
 }
 await retainHistory(path.join(root,'native-output'));
 const historyBytes=Buffer.from(JSON.stringify({schema:'fiscal-briefing-native-history.v1',operationId:OP,files:history},null,2)+'\n');
 await exact(path.join(out,'native-cli-history.json'),historyBytes);
 receivedArtifacts.push({path:'worker-output/native-cli-history.json',bytes:historyBytes.length,sha256:hash(historyBytes),files:history.length});
 const expectedScreenshots=new Set(['briefing-desktop.png','removed-observation-desktop.png','briefing-mobile.png','removed-observation-mobile.png']);
 need(Array.isArray(result.screenshotFiles)&&result.screenshotFiles.length===4,'Original four browser views are required');
 for(const source of result.screenshotFiles){
  const name=path.basename(source);need(expectedScreenshots.delete(name),'Original browser view selection differs');
  const relative=path.relative(path.join(root,'native-output','qa'),source);
  need(relative!==''&&relative!=='..'&&!relative.startsWith('../')&&!path.isAbsolute(relative),'Original browser view leaves the private QA directory');
  await retainReturn(source,'qa-'+name);
 }
 need(expectedScreenshots.size===0,'Complete browser view set is missing');
 await step('COMPLETE_NATIVE_RETURN_RETAINED',{artifacts:receivedArtifacts});
 receipt.state='COMPLETE';receipt.completedAt=new Date().toISOString();receipt.sourceReceiving=received;receipt.receivingResult='native-output/receiving-result.json';receipt.archive=result.output.archive;receipt.reportManifestSha256=result.output.manifestSha256;receipt.screenshots=result.screenshotFiles;receipt.artifacts=receivedArtifacts;
 await publish('continuation-result.json',receipt);
 process.stdout.write(JSON.stringify({state:'COMPLETE',result:path.join(out,'continuation-result.json'),archive:receipt.archive})+'\n');
}catch(error){receipt.state='INTERRUPTED';receipt.failedAt=new Date().toISOString();receipt.error={name:error.name,code:error.code,message:error.message,stack:error.stack};await publish('continuation-error.json',receipt).catch(()=>{});throw error;}finally{await unlockRoot?.();}
