// Original installed Applications controller and one retained EPA workspace.
import {readFile,mkdir,open,rename} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const need=(ok,message)=>{if(!ok)throw Object.assign(new Error(message),{code:'EPA_ECHO_APPLICATION_CONTINUATION'});};
const read=async file=>{try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}};
async function saved(file,value){
 const next=file+'.next',handle=await open(next,'w',0o600);
 try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
 await rename(next,file);
}
export async function runEchoApplications({sourceRoot,sourceCommit,artifactDirectory,runtimeDirectory,
 workspace,workspaceId,inboxDirectory,releaseRuntimeFile,receiptId,receivedWorkspaceId}){
 need(runtimeDirectory,'Supply the selected original READY installation containing this complete EPA source.');
 sourceRoot=resolve(sourceRoot);runtimeDirectory=resolve(runtimeDirectory);artifactDirectory=resolve(artifactDirectory);
 await mkdir(artifactDirectory,{recursive:true,mode:0o700});
 const journalFile=join(artifactDirectory,'journal.json'),resultFile=join(artifactDirectory,'result.json');
 const identity={sourceCommit,sourceRoot,runtimeDirectory,workspace,workspaceId,inboxDirectory,releaseRuntimeFile,receiptId,receivedWorkspaceId};
 const journal=await read(journalFile)??{schema:'stellar-forge.epa-echo-applications-journey.v1',...identity,steps:[],runs:{},createdAt:new Date().toISOString()};
 for(const [key,value]of Object.entries(identity))need(journal[key]===value,'Continue the original Applications selection: '+key);
 const completed=await read(resultFile);
 if(completed?.state==='COMPLETE'){need(completed.workspaceId===workspaceId&&completed.sourceCommit===sourceCommit,'Read this original completed Applications result.');return{...completed,reused:true};}
 const save=()=>saved(journalFile,journal);
 const record=async(name,detail={})=>{journal.steps.push({name,...detail,at:new Date().toISOString()});await save();process.stdout.write(JSON.stringify({phase:name,...detail})+'\n');};
 const load=(prefix,file)=>import(pathToFileURL(join(sourceRoot,prefix,file)).href);
 const prefix='stellar/scf-starforge-20261009';
 const [{inspectMerchantRuntime},{createRuntimeWorkspace,openRuntimeWorkspace}]=await Promise.all([
  load(prefix+'/sf46-release','runtime-package.mjs'),load(prefix+'/distribution/runtime-workspace','model.mjs')]);
 const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
 need(runtime.sourceCommit===sourceCommit,'The actual installed Applications source must be the same selected EPA product commit.');
 journal.runtime={directory:runtime.directory,installationId:runtime.installationId,sourceCommit:runtime.sourceCommit,profileId:runtime.profileId,sourceManifestSha256:runtime.sourceManifestSha256};
 const manager=join(artifactDirectory,'operator');
 if(!await read(join(manager,'workspace.json')))await createRuntimeWorkspace({directory:manager});
 let model=await openRuntimeWorkspace({directory:manager}),browser,context;
 const view=async()=>{
  const state=await model.applicationsState();need(state.catalog.filter(c=>c.id==='epa-echo-portfolios').length===1,'The installed registry must advertise the original EPA application exactly once.');
  return state.applications.find(app=>app.id===journal.applicationId);
 };
 async function until(label,predicate){
  const deadline=Date.now()+180000;let current;
  while(Date.now()<deadline){
   current=await view();if(predicate(current))return current;
   need(!current?.error&&!['FAILED','UNAVAILABLE'].includes(current?.phase),label+': '+JSON.stringify({phase:current?.phase,error:current?.error,result:current?.current?.result}));
   await new Promise(done=>setTimeout(done,500));
  }
  journal.waiting={label,current,observedAt:new Date().toISOString()};await save();
  throw Object.assign(new Error('The original Applications operation remains retained: '+label),{code:'EPA_ECHO_APPLICATION_WAITING'});
 }
 async function stopOriginal(requestId){
  const current=await view(),run=current.runs.find(run=>run.id===requestId);
  need(run,'The original application run remains in its own history.');
  if(run.active||['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(run.phase))
   await model.applicationsStop({applicationId:journal.applicationId,operationId:requestId});
  return until('original application stopped',app=>{const r=app?.runs.find(x=>x.id===requestId);return r&&!r.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(r.phase);});
 }
 try{
  if(!journal.runtimeId){const attached=await model.attach({directory:runtimeDirectory,label:'EPA ECHO original equipped runtime'});need(attached.status==='READY','The selected runtime must be READY.');journal.runtimeId=attached.runtimeId;await save();}
  if(!journal.applicationId){
   if(!journal.review){
    journal.review=await model.applicationsReview({runtimeId:journal.runtimeId,kind:'epa-echo-portfolios',
     label:'District wastewater facility portfolio',settings:{workspaceDirectory:workspace,inboxDirectory,releaseRuntimeFile,port:0}});
    journal.saveRequestId=randomUUID();await save();
   }
   const result=await model.applicationsSave({requestId:journal.saveRequestId,reviewId:journal.review.id});
   journal.applicationId=result.applicationId;journal.saved=result;await save();
  }
  let current=await view();
  if(!current.release)await model.applicationsConnect({applicationId:journal.applicationId});
  current=await until('original READY release attachment',app=>Boolean(app?.release));
  await record('ORIGINAL_APPLICATION_SELECTED_AND_CONNECTED',{applicationId:journal.applicationId,runtimeId:journal.runtimeId,
   installationId:runtime.installationId,releaseId:current.release.id,sourceCommit:current.release.sourceCommit});
  const {chromium}=require(process.env.EPA_ECHO_PLAYWRIGHT_MODULE??'/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
  const temporary=join(artifactDirectory,'browser-tmp');await mkdir(temporary,{recursive:true,mode:0o700});
  const environment={...process.env,TMPDIR:temporary};delete environment.SCF_ROUTESCAN_BUYER_SECRET;delete environment.SCF_ROUTESCAN_FEE_SECRET;
  browser=await chromium.launch({executablePath:process.env.EPA_ECHO_CHROMIUM_EXECUTABLE??'/workspace/scratch/705ebf077387/browser-runtime/chrome-headless-shell-linux64/chrome-headless-shell',
   headless:true,env:environment,args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu','--disable-background-networking','--renderer-process-limit=1']});
  context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:true});const page=await context.newPage();
  for(const phase of ['first','reopen']){
   if(phase==='reopen'){await model.close();model=await openRuntimeWorkspace({directory:manager});}
   let run=journal.runs[phase];
   if(!run){
    const reviewed=await model.applicationsStartReview({applicationId:journal.applicationId});
    run={requestId:randomUUID(),reviewId:reviewed.id,state:'PREPARED'};journal.runs[phase]=run;await save();
   }
   if(run.state==='COMPLETE')continue;
   current=await view();let actual=current.runs.find(r=>r.id===run.requestId);
   if(!actual){await model.applicationsStart({applicationId:journal.applicationId,requestId:run.requestId,reviewId:run.reviewId});run.state='DISPATCHED';await save();}
   else if(run.openedProof&&!actual.active&&!['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(actual.phase)){
    run.state='COMPLETE';run.workspaceId=run.openedProof.workspaceId;run.openedRevision=run.openedProof.revision;await save();
    await record('ORIGINAL_APPLICATION_STOP_ADOPTED',{applicationId:journal.applicationId,operationId:run.requestId,workspaceId});
    continue;
   }
   else if(!actual.active&&['PENDING','QUEUED','INTERRUPTED'].includes(actual.phase)){
    journal.recovery={operationId:run.requestId,observedPhase:actual.phase,at:new Date().toISOString()};await save();
    await model.applicationsRecover({applicationId:journal.applicationId,operationId:run.requestId});
   }
   else if(!actual.active){
    journal.waiting={label:'original run closed before its receiving view was observed',operationId:run.requestId,phase:actual.phase,result:actual.result,observedAt:new Date().toISOString()};await save();
    throw Object.assign(new Error('Reconcile the retained original application outcome: '+run.requestId),{code:'EPA_ECHO_APPLICATION_CLOSED_BEFORE_RECEIVING'});
   }
   current=await until('original application ready to open',app=>app?.runs.some(r=>r.id===run.requestId&&r.active&&r.privateUrl));
   actual=current.runs.find(r=>r.id===run.requestId);await page.goto(actual.privateUrl);
   await page.waitForFunction(()=>typeof S!=='undefined'&&S.schema&&S.view&&!S.refreshing);
   const selected=await page.evaluate(()=>({workspaceId:S.view.workspaceId,revision:S.view.revision,receipts:S.view.receipts.map(r=>r.id),received:S.view.receivedWorkspaces.map(r=>r.id)}));
   need(selected.workspaceId===workspaceId&&selected.receipts.includes(receiptId)&&selected.received.includes(receivedWorkspaceId),
    'The managed application must reopen the same original customer and portable workspace.');
   for(const width of [1280,390]){
    await page.setViewportSize({width,height:width===390?844:900});await page.locator('nav [data-view="receiving"]').click();
    const layout=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth}));
    need(layout.pageWidth<=layout.width+1,'The installed original EPA receiving view must fit the selected viewport.');
    await page.screenshot({path:join(artifactDirectory,'applications-'+phase+'-'+width+'.png'),fullPage:true});
   }
   run.openedProof={...selected,at:new Date().toISOString()};await save();
   await stopOriginal(run.requestId);run.state='COMPLETE';run.workspaceId=selected.workspaceId;run.openedRevision=selected.revision;await save();
   await record('ORIGINAL_APPLICATION_'+phase.toUpperCase()+'_OPENED_AND_STOPPED',{applicationId:journal.applicationId,operationId:run.requestId,workspaceId,revision:selected.revision});
  }
  const history=await model.applicationsHistory({applicationId:journal.applicationId,limit:100});
  need(Object.values(journal.runs).every(run=>history.runs.some(r=>r.id===run.requestId&&!r.active)),'Both original stopped application runs must remain in their complete history.');
  const result={schema:journal.schema,state:'COMPLETE',...identity,applicationId:journal.applicationId,runtime:journal.runtime,
   runs:journal.runs,history:{totalRuns:history.totalRuns,runs:history.runs.map(r=>({id:r.id,phase:r.phase,active:r.active}))},completedAt:new Date().toISOString(),journalFile,steps:journal.steps};
  await saved(resultFile,result);return result;
 }catch(error){journal.lastError={code:error.code,message:error.message,at:new Date().toISOString()};await save();throw error;}
 finally{await context?.close();await browser?.close();await model?.close();}
}
