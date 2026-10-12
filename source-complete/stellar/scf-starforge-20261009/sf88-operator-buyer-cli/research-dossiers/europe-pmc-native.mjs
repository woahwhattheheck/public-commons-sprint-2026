// MIT. Executed phase of the original Europe PMC customer receiving.
import {readFile,open,rename,unlink,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {startDossierWorkspace} from './server.mjs';
import {ResearchWorkspaceClient} from './workspace-client.mjs';
import {runEuropePmcWorkflow,verifyEuropePmcReopened} from './europe-pmc-journey.mjs';
import {runEuropePmcMerchant} from './europe-pmc-merchant.mjs';
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const bytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
async function atomic(path,value){const candidate=path+'.pending-'+randomUUID(),handle=await open(candidate,'wx',0o600);
 try{try{await handle.writeFile(bytes(value));await handle.sync();}finally{await handle.close();}await rename(candidate,path);}
 finally{await unlink(candidate).catch(error=>{if(error.code!=='ENOENT')throw error;});}}
async function read(path){try{return JSON.parse(await readFile(path));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function seedQuestions(client,selection){
 const file=join(selection.runDirectory,'questions.private.json'),metadata=await client.metadata(selection.dossierId);
 let seed=await read(file);
 if(!seed){
  need(metadata.revision===selection.expectedRevision,'EUROPE_PMC_NATIVE_ORIGINAL_DOSSIER_REVISION_CHANGED');
  seed={schema:'stellar-forge.europe-pmc-original-questions.v1',dossierId:selection.dossierId,
   originalRevision:metadata.revision,originalQuestionIds:metadata.questions.map(row=>row.id),requests:{},questionIds:{}};
  await atomic(file,seed);
 }
 need(seed.schema==='stellar-forge.europe-pmc-original-questions.v1'&&seed.dossierId===selection.dossierId&&
  seed.originalRevision===selection.expectedRevision,'EUROPE_PMC_NATIVE_QUESTION_SEED_CHANGED');
 const texts={
  baseline:'How is the Europe PMC in 2023 resource paper represented in the retained original Europe PMC metadata?',
  expanded:'What changes when the original Europe PMC resource-paper query includes the EMBL-EBI in 2023 paper as a second exact DOI?'
 };
 for(const [name,text]of Object.entries(texts)){
  if(seed.questionIds[name]){
   const current=await client.metadata(selection.dossierId);
   need(current.questions.some(row=>row.id===seed.questionIds[name]&&row.text===text),'EUROPE_PMC_NATIVE_ORIGINAL_QUESTION_CHANGED');continue;
  }
  let prepared=seed.requests[name];
  if(!prepared){const before=await client.metadata(selection.dossierId);
   prepared={text,expectedRevision:before.revision,beforeQuestionIds:before.questions.map(row=>row.id)};
   seed.requests[name]=prepared;await atomic(file,seed);
  }
  need(prepared.text===text,'EUROPE_PMC_NATIVE_QUESTION_INPUT_CHANGED');
  const current=await client.metadata(selection.dossierId);
  if(current.revision===prepared.expectedRevision)
   await client.addQuestion(selection.dossierId,{text:prepared.text,expectedRevision:prepared.expectedRevision});
  else need(current.revision>prepared.expectedRevision,'EUROPE_PMC_NATIVE_QUESTION_REVISION_REGRESSED');
  // Recover the actual original commit after a lost addQuestion response.
  const original=await client.metadata(selection.dossierId,{revision:prepared.expectedRevision+1});
  const added=original.questions.filter(row=>!prepared.beforeQuestionIds.includes(row.id));
  need(added.length===1&&added[0].text===text&&original.questions.length===prepared.beforeQuestionIds.length+1&&
   prepared.beforeQuestionIds.every(id=>original.questions.some(row=>row.id===id)),'EUROPE_PMC_NATIVE_QUESTION_RECONCILIATION_REQUIRED');
  seed.questionIds[name]=added[0].id;seed.revisions??={};seed.revisions[name]=original.revision;await atomic(file,seed);
 }
 return seed;
}
export async function runEuropePmcNativePhase({phase,selectionFile}){
 need(['operate','reopen'].includes(phase)&&isAbsolute(selectionFile),'EUROPE_PMC_NATIVE_PHASE_INVALID');
 const selectionBytes=await readFile(selectionFile),selection=JSON.parse(selectionBytes);
 need(selection.schema==='stellar-forge.europe-pmc-native-selection.v1'&&typeof selection.dossierId==='string'&&
  Number.isSafeInteger(selection.expectedRevision)&&selection.expectedRevision>=1,'EUROPE_PMC_NATIVE_SELECTION_INVALID');
 for(const path of [selection.workspaceDirectory,selection.runDirectory,selection.inputDirectory,selection.playwrightModule,selection.chromiumExecutable])
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'EUROPE_PMC_NATIVE_ABSOLUTE_PATH_REQUIRED');
 await mkdir(selection.runDirectory,{recursive:true,mode:0o700});
 const info=await lstat(selection.runDirectory);need(info.isDirectory()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'EUROPE_PMC_NATIVE_PRIVATE_DIRECTORY_REQUIRED');
 const phaseFile=join(selection.runDirectory,phase+'-result.private.json'),prior=await read(phaseFile);
 if(prior){need(prior.selectionSha256===sha(selectionBytes)&&prior.phase===phase,'EUROPE_PMC_NATIVE_PHASE_SELECTION_CHANGED');
  for(const file of prior.result.nativeOutputs??[]){const body=await readFile(file.path);need(body.length===file.bytes&&sha(body)===file.sha256,'EUROPE_PMC_NATIVE_RETAINED_OUTPUT_CHANGED');}
  return prior;
 }
 const listening=await read(join(selection.runDirectory,'listener.private.json'));
 let app,context,client,closing,signal=false;
 const close=()=>closing??=(async()=>{try{await context?.close();}finally{try{await client?.close();}finally{await app?.close();}}})();
 const stop=()=>{signal=true;close().then(()=>process.exit(130),()=>process.exit(130));};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 try{
  app=await startDossierWorkspace({directory:selection.workspaceDirectory,port:listening?.port??0,
   clinicalTrialsPython:selection.pythonExecutable??'python3'});
  const port=Number(new URL(app.origin).port);
  if(listening)need(listening.port===port&&listening.workspaceId===app.workspaceId,'EUROPE_PMC_NATIVE_LISTENER_CHANGED');
  await atomic(join(selection.runDirectory,'listener.private.json'),{port,workspaceId:app.workspaceId,url:app.url,instanceId:app.instanceId});
  client=new ResearchWorkspaceClient({url:app.url});
  let result;
  if(phase==='operate'){
   const seed=await seedQuestions(client,selection);
   const loaded=await import(pathToFileURL(selection.playwrightModule).href),chromium=loaded.chromium??loaded.default?.chromium;
   need(chromium?.launchPersistentContext,'EUROPE_PMC_NATIVE_PLAYWRIGHT_REQUIRED');
   context=await chromium.launchPersistentContext(join(selection.runDirectory,'browser-profile'),{
    executablePath:selection.chromiumExecutable,headless:true,acceptDownloads:true,serviceWorkers:'block',
    viewport:{width:1440,height:1000},args:['--no-sandbox','--disable-dev-shm-usage','--disk-cache-size=1048576','--media-cache-size=1048576']
   });
   need(!signal,'EUROPE_PMC_NATIVE_INTERRUPTED');
   result=await runEuropePmcWorkflow({url:app.url,dossierId:selection.dossierId,questionIds:seed.questionIds,
    runDirectory:selection.runDirectory,inputDirectory:selection.inputDirectory,browser:context,
    merchant:args=>runEuropePmcMerchant({...args,workspaceDirectory:selection.workspaceDirectory})});
  }else result=await verifyEuropePmcReopened({url:app.url,runDirectory:selection.runDirectory});
  need(!signal,'EUROPE_PMC_NATIVE_INTERRUPTED');await close();
  const completed={schema:'stellar-forge.europe-pmc-native-phase.v1',phase,selectionSha256:sha(selectionBytes),completedAt:new Date().toISOString(),
   workspaceId:app.workspaceId,instanceId:app.instanceId,result};
  need(!bytes(completed).includes(Buffer.from(app.token)),'EUROPE_PMC_NATIVE_SESSION_IN_RESULT');
  await atomic(phaseFile,completed);return completed;
 }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);await close();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2);need(args.length===4&&args[0]==='--phase'&&args[2]==='--selection','EUROPE_PMC_NATIVE_ARGUMENTS_REQUIRED');
 runEuropePmcNativePhase({phase:args[1],selectionFile:resolve(args[3])})
  .then(value=>process.stdout.write(JSON.stringify({phase:value.phase,state:'COMPLETE',workspaceId:value.workspaceId,outputs:value.result.nativeOutputs.length})+'\n'))
  .catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'EUROPE_PMC_NATIVE_PHASE_FAILED'})+'\n');process.exitCode=1;});
}
