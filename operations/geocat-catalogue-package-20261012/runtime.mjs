#!/usr/bin/env node
// Original distribution and installed STAC application receiving. No provider acquisition.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';
const [inputFile,outputFile]=process.argv.slice(2);
const input=JSON.parse(await readFile(inputFile,'utf8'));
const DIST='stellar/scf-starforge-20261009/distribution';
const STAC='stellar/scf-starforge-20261009/sf30-seller-sdk/stac';
const need=(v,code)=>{if(!v)throw Object.assign(new Error(code),{code});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const moduleAt=(root,path)=>import(pathToFileURL(join(root,path)).href);
const execute=promisify(execFile);
const json=value=>JSON.stringify(value,null,2)+'\n';
async function nativeCLI(entry,args,cwd){
 const result=await execute(process.execPath,[entry,...args],{cwd,env:process.env,maxBuffer:16*1024*1024,timeout:120000});
 return JSON.parse(result.stdout);
}
async function startHost(entry,args,cwd,selection,managed){
 const child=spawn(process.execPath,[entry,...args],{cwd,env:process.env,stdio:['ignore','pipe','pipe']});
 let text='',diagnostic='',stopped=false;
 const completion=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>resolve({code,signal}));});
 completion.catch(()=>{});
 child.stderr.on('data',b=>{diagnostic=(diagnostic+b.toString()).slice(-32768);});
 let startup;
 try{
  startup=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>finish(new Error('INSTALLED_STAC_STARTUP_TIMEOUT')),30000);
   const onExit=()=>finish(new Error('INSTALLED_STAC_EXITED_BEFORE_READY'));
   const onError=error=>finish(error);
   function finish(error,value){clearTimeout(timer);child.off('exit',onExit);child.off('error',onError);child.stdout.off('data',onData);error?reject(error):resolve(value);}
   function onData(chunk){
    text+=chunk.toString();
    if(text.length>1024*1024)return finish(new Error('INSTALLED_STAC_STARTUP_TOO_LARGE'));
    let at;
    while((at=text.indexOf('\n'))>=0){
     const line=text.slice(0,at);text=text.slice(at+1);
     try{const value=JSON.parse(line);if(value.schema==='stellar-forge.stac-managed-startup.v1')return finish(null,value);}catch{}
    }
   }
   child.stdout.on('data',onData);child.once('exit',onExit);child.once('error',onError);
  });
  child.stdout.resume();
  need(startup.status==='STAC_READY'&&Number.isSafeInteger(startup.pid)&&startup.pid>0,'INSTALLED_STAC_READY_IDENTITY');
  need(startup.selectionSha256===managed.stacSelectionDigest(selection),'INSTALLED_STAC_SELECTION_CHANGED');
  const checked=await managed.verifyStacManagedHost({url:startup.url,selection});
  need(checked.workspaceId===startup.workspaceId&&checked.catalogueWorkspaceId===startup.catalogueWorkspaceId,'INSTALLED_STAC_HOST_CHANGED');
  return {startup,dispatcherPid:child.pid,async close(){
   if(stopped)return;stopped=true;
   if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
   let timer;
   const ended=await Promise.race([completion,new Promise(resolve=>{timer=setTimeout(()=>resolve(null),15000);})]);
   clearTimeout(timer);
   if(!ended){child.kill('SIGKILL');await completion;throw new Error('INSTALLED_STAC_CLOSE_TIMEOUT');}
   need(ended.code===0,'INSTALLED_STAC_CLOSE_FAILED');
  }};
 }catch(error){
  if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
  const deadline=setTimeout(()=>child.kill('SIGKILL'),15000);
  await completion.catch(()=>{});clearTimeout(deadline);
  throw error;
 }
}
async function main(){
 if(input.action==='build'){
  const {buildDistribution}=await moduleAt(input.sourceRoot,DIST+'/build.mjs');
  return buildDistribution({repository:input.repository,ref:input.commit,output:input.output,
   selection:'geocat-catalogue',offline:true,python:input.python,
   onProgress:value=>{process.stderr.write(JSON.stringify(value)+'\n');}});
 }
 const installer=await moduleAt(input.sourceRoot,DIST+'/runtime-install.mjs');
 if(input.action==='prepare')return installer.prepareRuntimeInstall({directory:input.directory,
  archive:input.archive,sha256:input.sha256,native:true,features:['schema','openapi','mcp'],
  pins:{'@stellar/stellar-sdk':'16.3.1'},operator:true,python:input.python});
 if(input.action==='validate-lock'){
  const {describeRuntimeLock}=await moduleAt(input.sourceRoot,DIST+'/runtime-transfer-lock.mjs');
  const lock=JSON.parse(await readFile(join(input.directory,'package-lock.json'),'utf8'));
  const pkg=JSON.parse(await readFile(join(input.directory,'package.json'),'utf8'));
  const description=describeRuntimeLock(lock,pkg);
  need(description.supported&&description.problems.length===0,'COMPOSED_LOCK_PROFILE_NOT_SUPPORTED');
  return {...description,lockSha256:sha(await readFile(join(input.directory,'package-lock.json'))),
   packageJsonSha256:sha(await readFile(join(input.directory,'package.json')))};
 }
 if(input.action==='adopt')return installer.adoptRuntimeDependencies({directory:input.directory});
 if(input.action==='inspect')return installer.inspectRuntimeInstall({directory:input.directory,load:true,source:true,python:input.python});
 need(input.action==='application','PACKAGE_RECEIVING_ACTION_UNKNOWN');
 const root=input.installedSourceRoot;
 const entry=join(root,DIST,'cli.mjs');
 const workspace=join(input.customerDirectory,'stac');
 const catalogue=join(input.customerDirectory,'catalogue');
 await mkdir(input.customerDirectory,{recursive:false,mode:0o700});
 const initial=await nativeCLI(entry,['stac','init','--workspace',workspace,'--title','GeoCat catalogue receiving'],input.directory);
 need(initial.schema==='scf-stac-workspace/v1'&&initial.revision===0&&initial.editions.length===0,'INSTALLED_STAC_INITIAL_IDENTITY');
 const initialCatalogue=await nativeCLI(entry,['stac','catalogue-state','--workspace',workspace,'--catalogue-workspace',catalogue],input.directory);
 need(initialCatalogue.schema==='starforge.stac-geonetwork.v1'&&initialCatalogue.stacWorkspaceId===initial.id,'INSTALLED_CATALOGUE_INITIAL_IDENTITY');
 const managed=await moduleAt(root,STAC+'/managed.mjs');
 const flags={workspace,port:'0','startup-json':true,'catalogue-workspace':catalogue};
 const selection=await managed.inspectStacManagedSelection({command:'serve',flags,sourceDirectory:join(root,STAC)});
 const args=['stac','serve','--workspace',workspace,'--port','0','--startup-json','--catalogue-workspace',catalogue,
  '--managed-selection',JSON.stringify(selection)];
 let host,browser,context;
 const observations=[],launches=[];
 const recordLaunch=value=>launches.push({dispatcherPid:value.dispatcherPid,nativeHostPid:value.startup.pid,
  instanceId:value.startup.instanceId,selectionSha256:value.startup.selectionSha256,sourceSha256:value.startup.sourceSha256});
 try{
  host=await startHost(entry,args,input.directory,selection,managed);
  recordLaunch(host);
  const {chromium}=await import(pathToFileURL(input.playwrightModule).href);
  browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage'],
   ...(input.chromiumExecutable?{executablePath:input.chromiumExecutable}:{})});
  context=await browser.newContext({viewport:{width:1280,height:900},acceptDownloads:false});
  for(const width of [1280,390]){
   const page=await context.newPage();
   await page.setViewportSize({width,height:900});
   await page.goto(host.startup.url,{waitUntil:'domcontentloaded',timeout:30000});
   await page.getByRole('tab',{name:'Catalogue receiving',exact:true}).click();
   await page.getByRole('navigation',{name:'Catalogue workflow'}).waitFor({state:'visible'});
   const heading=await page.locator('.catalogue-header').innerText();
   need(heading.includes(initialCatalogue.id),'INSTALLED_CATALOGUE_BROWSER_IDENTITY');
   for(const tab of ['Installation','Collection source','Harvest plan','Record review','Handover','Operations']){
    await page.getByRole('tab',{name:tab,exact:true}).click();
    await page.locator('.catalogue-content').waitFor({state:'visible'});
   }
   const size=await page.evaluate(()=>({client:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth}));
   need(size.scroll<=size.client+1,'INSTALLED_CATALOGUE_DOCUMENT_OVERFLOW');
   observations.push({viewportWidth:width,catalogueWorkspaceId:initialCatalogue.id,tabsOpened:6,documentWidth:size.client,scrollWidth:size.scroll});
   await page.close();
  }
  const firstInstance=host.startup.instanceId;
  await host.close();host=null;
  const reopenedSelection=await managed.inspectStacManagedSelection({command:'serve',flags,sourceDirectory:join(root,STAC)});
  need(reopenedSelection.workspace.id===initial.id&&reopenedSelection.catalogue.workspaceId===initialCatalogue.id,'INSTALLED_STAC_REOPEN_SELECTION');
  host=await startHost(entry,['stac','serve','--workspace',workspace,'--port','0','--startup-json','--catalogue-workspace',catalogue,
   '--managed-selection',JSON.stringify(reopenedSelection)],input.directory,reopenedSelection,managed);
  recordLaunch(host);
  need(host.startup.instanceId!==firstInstance,'INSTALLED_STAC_NEW_PROCESS_REQUIRED');
  const page=await context.newPage();
  await page.goto(host.startup.url,{waitUntil:'domcontentloaded',timeout:30000});
  await page.getByRole('tab',{name:'Catalogue receiving',exact:true}).click();
  await page.getByRole('navigation',{name:'Catalogue workflow'}).waitFor({state:'visible'});
  need((await page.locator('.catalogue-header').innerText()).includes(initialCatalogue.id),'INSTALLED_CATALOGUE_BROWSER_REOPEN_IDENTITY');
  await page.close();
  await host.close();host=null;
  const after=await nativeCLI(entry,['stac','state','--workspace',workspace],input.directory);
  const afterCatalogue=await nativeCLI(entry,['stac','catalogue-state','--workspace',workspace,'--catalogue-workspace',catalogue],input.directory);
  need(after.id===initial.id&&after.revision===initial.revision&&after.editions.length===0,'INSTALLED_STAC_RECEIVING_CHANGED_SOURCE');
  need(afterCatalogue.id===initialCatalogue.id&&afterCatalogue.revision===initialCatalogue.revision,'INSTALLED_CATALOGUE_RECEIVING_CHANGED_STATE');
  return {schema:'starforge.geocat-installed-application-receiving.v1',status:'COMPLETED',
   sourceCommit:input.commit,workspaceId:after.id,catalogueWorkspaceId:afterCatalogue.id,
   originalManagedLaunch:true,launches,openedTabs:observations,reopenedInFreshProcess:true,
   stacRevision:after.revision,catalogueRevision:afterCatalogue.revision,
   sourceAcquisitions:0,geoNetworkRequests:0,
   nativeCatalogueCustomer:{operationId:'SCF-GEOCAT-NATIVE-CUSTOMER-20261012-33E6',status:'SEPARATE_ORIGINAL_REQUEST'}};
 }finally{
  await context?.close().catch(()=>{});await browser?.close().catch(()=>{});
  await host?.close();
 }
}
try{
 const result=await main();
 await writeFile(outputFile,json(result),{flag:'wx',mode:0o600});
 process.stdout.write(JSON.stringify({status:'completed',action:input.action,output:outputFile})+'\n');
}catch(error){
 const value={status:'failed',action:input.action,code:error.code??error.name??'ERROR',message:String(error.message).slice(0,1600)};
 await writeFile(outputFile,json(value),{flag:'wx',mode:0o600}).catch(()=>{});
 process.stderr.write(JSON.stringify(value)+'\n');process.exitCode=1;
}
