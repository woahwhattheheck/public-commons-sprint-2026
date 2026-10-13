// MIT. Continue the completed original Datasette programme through its installed application and browser.
import {readFile, writeFile, mkdir, rename, open, lstat, realpath} from 'node:fs/promises';
import {join, dirname, resolve, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';

const SDK='stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/';
const DIST='stellar/scf-starforge-20261009/distribution/';
const WRI='stellar/scf-starforge-20261009/sf30-seller-sdk/datasette/sources/wri-geothermal-20261012/wri-geothermal.sfds.gz';
const ARCHIVE_SHA='53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0';
const EDITION_SHA='ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616';
const COLUMNS=['rowid','country','country_long','name','gppd_idnr','capacity_mw','latitude','longitude','primary_fuel','other_fuel1','other_fuel2','other_fuel3','commissioning_year','owner','source','url','geolocation_source','wepp_id','year_of_capacity_data','generation_gwh_2013','generation_gwh_2014','generation_gwh_2015','generation_gwh_2016','generation_gwh_2017','generation_data_source','estimated_generation_gwh'];
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const need=(value,code,message=code)=>{if(!value)throw Object.assign(new Error(message),{code});};
const delay=ms=>new Promise(done=>setTimeout(done,ms));
const stamp=()=>new Date().toISOString();
const issue=error=>({code:error.code??error.name,message:error.message,
  ...(error.observed!==undefined?{observed:error.observed}:{}),
  ...(error.result!==undefined?{result:error.result}:{}),
  ...(error.inspection!==undefined?{inspection:error.inspection}:{})});
const readJSON=async file=>JSON.parse(await readFile(file,'utf8'));
const exists=async file=>{try{await lstat(file);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
async function retain(file,value) {
  await mkdir(dirname(file),{recursive:true,mode:0o700});
  const temporary=file+'.pending-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try{await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}finally{await handle.close();}
  await rename(temporary,file);
  const directory=await open(dirname(file),'r');try{await directory.sync();}finally{await directory.close();}
}
async function runCommand(executable,args,options={}) {
  return new Promise((done,fail)=>{
    const child=spawn(executable,args,{cwd:options.cwd,env:process.env,stdio:['ignore','pipe','pipe']});
    let stdout='',stderr='';
    child.stdout.on('data',raw=>{stdout+=raw.toString();});
    child.stderr.on('data',raw=>{stderr+=raw.toString();});
    child.once('error',fail);
    child.once('close',(code,signal)=>code===0?done({code,signal,stdout,stderr}):
      fail(Object.assign(new Error('Installed command failed: '+stderr),{code:'DATASETTE_INSTALLED_COMMAND',result:{code,signal,stdout,stderr}})));
  });
}
async function waitFor(read,accept,label,timeout=120000) {
  const until=Date.now()+timeout;let value;
  do{value=await read();if(accept(value))return value;await delay(150);}while(Date.now()<until);
  throw Object.assign(new Error(label),{code:'DATASETTE_INSTALLED_WAIT',observed:value});
}
async function journalFromBrowser(page) {
  return page.evaluate(async()=>new Promise((done,fail)=>{
    const opened=indexedDB.open('starforge-datasette-operations',1);
    opened.onerror=()=>fail(opened.error);
    opened.onsuccess=()=>{
      const database=opened.result,request=database.transaction('operations').objectStore('operations').getAll();
      request.onerror=()=>{database.close();fail(request.error);};
      request.onsuccess=()=>{const rows=request.result;database.close();done(rows);};
    };
  }));
}
async function waitBrowser(page) {
  await page.waitForFunction(()=>document.querySelector('#ds-active')?.textContent==='Connected',{},{timeout:120000});
}
async function readRenderedRows(page,expected) {
  const rows=[],types=[];
  for(;;){
    await waitBrowser(page);
    const view=await page.locator('#ds-source-rows tbody tr').evaluateAll(records=>records.map(row=>({
      values:[...row.querySelectorAll('.ds-cell-value')].map(cell=>cell.textContent),
      types:[...row.querySelectorAll('.ds-cell-type')].map(cell=>cell.textContent),
    })));
    rows.push(...view.map(row=>row.values));types.push(...view.map(row=>row.types));
    need(rows.length<=expected.rows.length,'DATASETTE_BROWSER_ROWS_OVERFLOW');
    const next=page.locator('#ds-row-pages button').nth(1);
    if(await next.isDisabled())break;
    const wanted=expected.rows[rows.length][0] === '' ? '""' : expected.rows[rows.length][0] === null ? 'null' : String(expected.rows[rows.length][0]);
    await next.click();
    await page.waitForFunction(value=>document.querySelector('#ds-source-rows tbody tr .ds-cell-value')?.textContent===value,wanted,{timeout:120000});
  }
  const textRows=expected.rows.map(row=>row.map(value=>value===''?'""':value===null?'null':String(value)));
  need(same(rows,textRows)&&same(types,expected.cellTypes),'DATASETTE_BROWSER_SOURCE_VALUES_CHANGED');
  return {rows:rows.length,columns:expected.columns.length,exactTypesAndValues:true};
}
async function browserDownload(page,container,destination) {
  const pending=page.waitForEvent('download');
  await page.locator(container).getByRole('button',{name:/Download original package/}).click();
  const download=await pending;
  await download.saveAs(destination);
  const raw=await readFile(destination);
  return {file:destination,name:download.suggestedFilename(),bytes:raw.length,sha256:sha(raw)};
}
function absolute(value,name) {
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value,'DATASETTE_INSTALLED_INPUT',name+' must be an absolute canonical path.');
  return value;
}

/**
 * Input uses the completed publisher-programme-result.json and its same received workspace.
 * This continuation creates its own install and managed Applications records. Source acquisition,
 * extraction, publication, payment and the separate customer Analysis run retain their original owners.
 */
export async function runInstalledDatasetteBrowser({
  repository,sourceRef,publisherProgrammeDirectory,outputDirectory,
  playwrightModule='playwright',browserExecutable,port=53173,receivedPort=53174,
  offline=false,npmCache,python='python3',npm='npm',
}={}) {
  for(const [name,value] of Object.entries({repository,publisherProgrammeDirectory,outputDirectory}))
    absolute(value,name);
  need(Number.isInteger(port)&&port>0&&port<65536&&Number.isInteger(receivedPort)&&receivedPort>0&&receivedPort<65536&&port!==receivedPort,
    'DATASETTE_INSTALLED_EXPLICIT_PORTS');
  need(Number(process.versions.node.split('.')[0])>=24,'DATASETTE_INSTALLED_NODE_24');
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  need(await realpath(outputDirectory)===outputDirectory,'DATASETTE_INSTALLED_CANONICAL_DIRECTORY');
  const stateFile=join(outputDirectory,'installed-browser-journey.json');
  let state=await exists(stateFile)?await readJSON(stateFile):null;
  if(state)need(state.schema==='stellar-forge.datasette-installed-browser-journey.v1',
    'DATASETTE_INSTALLED_JOURNEY_CHANGED');
  let sourceResolution=sourceRef===undefined?'repository-head':'explicit';
  if(sourceRef===undefined){
    if(state){
      sourceRef=state.input?.sourceRef;sourceResolution='retained-original';
    }else{
      const git=await runCommand('git',['-C',repository,'rev-parse','--verify','HEAD^{commit}']);
      sourceRef=git.stdout.trim();
    }
  }
  need(/^[a-f0-9]{40}$/.test(sourceRef??''),'DATASETTE_INSTALLED_SOURCE_REF');
  const programme=await readJSON(join(publisherProgrammeDirectory,'publisher-programme-result.json'));
  const sourceState=await readJSON(join(publisherProgrammeDirectory,'publisher-programme-state.json'));
  need(sourceState.phase==='COMPLETE'&&programme.sourceRefresh?.state==='COMPLETE'&&programme.mcpReceiving?.passed&&
    programme.managedUpload?.resumed?.state==='COMPLETE','DATASETTE_INSTALLED_COMPLETED_ORIGINAL_PROGRAMME',
    'Continue the completed original publisher programme and its retained received workspace.');
  const workspaceDirectory=absolute(programme.receiving.directory,'Original received workspace');
  const sourceDeclaration=await readJSON(join(workspaceDirectory,'workspace.json'));
  const input={repository,sourceRef,publisherProgrammeDirectory,outputDirectory,workspaceDirectory,
    workspaceId:sourceDeclaration.workspaceId,port,receivedPort,playwrightModule,browserExecutable:browserExecutable??null};
  // Host browser paths can change when the same retained workspace moves hosts.
  // Preserve the original input; only these two execution bindings may differ.
  if(state)need(same(state.input,{...input,
    playwrightModule:state.input.playwrightModule,browserExecutable:state.input.browserExecutable}),
    'DATASETTE_INSTALLED_ORIGINAL_INPUT_CHANGED');
  else state={schema:'stellar-forge.datasette-installed-browser-journey.v1',id:randomUUID(),input,
    sourceResolution:{kind:sourceResolution,commit:sourceRef},startedAt:stamp(),phase:'CREATED',checks:{},applications:{},runs:[],browserErrors:[],artifacts:[]};
  const save=async phase=>{state.phase=phase;state.updatedAt=stamp();await retain(stateFile,state);
    process.stderr.write(JSON.stringify({operation:'datasette-installed-browser',phase,at:state.updatedAt})+'\n');};
  if(state.phase==='COMPLETE'){
    for(const file of state.artifacts)need(sha(await readFile(file.file))===file.sha256,'DATASETTE_INSTALLED_ARTIFACT_CHANGED');
    return {state:'COMPLETE',reused:true,report:stateFile,checks:state.checks,artifacts:state.artifacts};
  }
  const fromRepo=path=>import(pathToFileURL(join(repository,path)).href);
  let apps,context,browserAttempt,activeApp=null,stopActive=null,failed=false;
  try{
    const browserRuntime={playwrightModule,browserExecutable:browserExecutable??null};
    state.browserRuntimeSelections??=[{at:state.startedAt,kind:'original',
      selection:{playwrightModule:state.input.playwrightModule,browserExecutable:state.input.browserExecutable}}];
    if(!same(state.browserRuntimeSelections.at(-1).selection,browserRuntime))
      state.browserRuntimeSelections.push({at:stamp(),kind:'host-recovery',
        previous:state.browserRuntimeSelections.at(-1).selection,selection:browserRuntime});
    await save('ORIGINAL_PROGRAMME_RETAINED');
    const {buildDistribution}=await fromRepo(DIST+'build.mjs');
    const buildDirectory=join(outputDirectory,'build');
    state.build=await buildDistribution({repository,ref:sourceRef,output:buildDirectory,
      selection:'datasette',offline:true,resume:await exists(buildDirectory),python,onProgress:event=>{
        if(['selected','materializing','packaged','reused'].includes(event.phase))
          process.stderr.write(JSON.stringify({operation:'datasette-installed-build',...event})+'\n');
      }});
    need(state.build.sourceCommit===sourceRef&&typeof state.build.archive==='string','DATASETTE_INSTALLED_BUILD_SOURCE');
    if(!state.artifacts.some(file=>file.file===state.build.archive))state.artifacts.push({file:state.build.archive,bytes:state.build.archiveBytes,sha256:state.build.sha256});
    await save('BUILT');
    const installer=await fromRepo(DIST+'runtime-install.mjs');
    if(!state.installation){
      state.installation={archive:state.build.archive,sha256:state.build.sha256,
        attempts:[{directory:join(outputDirectory,'runtime'),from:null,createdAt:stamp()}]};
      await save('RUNTIME_PREPARATION_INPUT_RETAINED');
    }
    need(state.installation.archive===state.build.archive&&state.installation.sha256===state.build.sha256,
      'DATASETTE_INSTALLED_PREPARATION_INPUT_CHANGED');
    let preparation=state.installation.attempts.at(-1);
    need(preparation&&isAbsolute(preparation.directory),'DATASETTE_INSTALLED_PREPARATION_REQUIRED');
    let runtimeDirectory=preparation.directory;
    // The original installer creates a private directory before its plan and state.
    // Retain an interrupted directory, and use its original recovery operation in
    // a new, journaled target. Dependency-install retries keep the prepared target.
    while(!await exists(join(runtimeDirectory,'runtime-install.json'))||
      !await exists(join(runtimeDirectory,'install-state.json'))){
      if(await exists(runtimeDirectory)){
        const hasPreparation=await exists(join(runtimeDirectory,'preparation.json'));
        preparation.interruptedAt??=stamp();
        preparation.observed={preparation:hasPreparation,
          plan:await exists(join(runtimeDirectory,'runtime-install.json')),
          state:await exists(join(runtimeDirectory,'install-state.json'))};
        const previousDirectory=runtimeDirectory;
        const recoveryFrom=hasPreparation?previousDirectory:preparation.from;
        runtimeDirectory=join(outputDirectory,'runtime-recovery-'+String(state.installation.attempts.length).padStart(4,'0'));
        preparation={directory:runtimeDirectory,from:recoveryFrom??null,previousDirectory,createdAt:stamp()};
        state.installation.attempts.push(preparation);
        await save('RUNTIME_RECOVERY_INPUT_RETAINED');
        continue;
      }
      const prepared=preparation.from
        ?await installer.recoverRuntime({from:preparation.from,directory:runtimeDirectory,
          install:false,python,offline,npm,cache:npmCache??null})
        :await installer.prepareRuntimeInstall({directory:runtimeDirectory,archive:state.build.archive,
          sha256:state.build.sha256,native:false,features:[],operator:false,python,
          from:preparation.previousDirectory??null});
      need(prepared.directory===runtimeDirectory&&prepared.sourceCommit===sourceRef,
        'DATASETTE_INSTALLED_PREPARATION_RESULT');
      state.prepared=prepared;preparation.result=prepared;preparation.completedAt=stamp();
      await save('RUNTIME_PREPARED');
    }
    state.installation.directory=runtimeDirectory;
    await save('RUNTIME_INSTALL_INPUT_RETAINED');
    state.runtime=await installer.installRuntime({directory:runtimeDirectory,offline,npm,cache:npmCache??null});
    const runtime=await installer.inspectRuntimeInstall({directory:runtimeDirectory,source:true,load:true,python});
    need(runtime.status==='READY'&&runtime.ready&&runtime.sourceCommit===sourceRef,'DATASETTE_INSTALLED_RUNTIME_READY');
    state.runtime=runtime;
    const fromInstalled=path=>import(pathToFileURL(join(runtime.sourceRoot,path)).href);
    const packageRoot=dirname(runtime.sourceRoot),manifest=await readJSON(join(packageRoot,'manifest.json'));
    const packageJSON=await readJSON(join(packageRoot,'package.json'));
    const {readDistributionSpecification}=await fromInstalled(DIST+'specification.mjs');
    const {spec}=await readDistributionSpecification({sourceRoot:runtime.sourceRoot});
    need(manifest.sourceSelection?.id==='datasette','DATASETTE_INSTALLED_SELECTION');
    for(const command of ['datasette','datasette-application','datasette-mcp','datasette-analysis'])
      need(typeof spec.commands[command]==='string','DATASETTE_INSTALLED_COMMAND_MISSING',command);
    for(const entry of ['./seller/datasette/client','./operator/datasette','./merchant/mcp/datasette/client'])
      need(typeof packageJSON.exports[entry]?.types==='string'&&typeof packageJSON.exports[entry]?.import==='string',
        'DATASETTE_INSTALLED_TYPED_EXPORT',entry);
    const rawArchive=await readFile(join(runtime.sourceRoot,WRI));
    need(sha(rawArchive)===ARCHIVE_SHA&&manifest.files.some(file=>file.path===WRI&&file.sha256===ARCHIVE_SHA),
      'DATASETTE_INSTALLED_ORIGINAL_GZIP');
    const pythonTypes=manifest.files.filter(file=>file.path.includes('/datasette-analysis/')&&file.path.endsWith('.pyi'));
    need(pythonTypes.length>0,'DATASETTE_INSTALLED_PYTHON_TYPES');
    state.installedSource={sourceRoot:runtime.sourceRoot,sourceCommit:sourceRef,sourceSelection:manifest.sourceSelection,
      originalArchive:{bytes:rawArchive.length,sha256:sha(rawArchive)},pythonTypes,
      commands:Object.fromEntries(['datasette','datasette-application','datasette-mcp','datasette-analysis'].map(name=>[name,spec.commands[name]]))};
    state.checks={...state.checks,selectedSourceBuilt:true,installedRuntimeReady:true,originalGzipRetained:true,pythonTypesRetained:true,typedClientExports:true};
    await save('INSTALLED_SOURCE_VERIFIED');
    const runtimeModel=await fromInstalled(DIST+'runtime-workspace/model.mjs');
    if(!state.applicationWorkspace){
      state.applicationWorkspace={attempts:[{directory:join(outputDirectory,'applications'),createdAt:stamp()}]};
      await save('APPLICATION_WORKSPACE_INPUT_RETAINED');
    }
    let applicationPreparation=state.applicationWorkspace.attempts.at(-1);
    let appsDirectory=applicationPreparation.directory;
    while(!await exists(join(appsDirectory,'workspace.json'))){
      if(await exists(appsDirectory)){
        need(!Object.values(state.applications).some(item=>item.saved),
          'DATASETTE_INSTALLED_ORIGINAL_APPLICATION_WORKSPACE_MISSING');
        applicationPreparation.interruptedAt??=stamp();
        const previousDirectory=appsDirectory;
        appsDirectory=join(outputDirectory,'applications-recovery-'+
          String(state.applicationWorkspace.attempts.length).padStart(4,'0'));
        applicationPreparation={directory:appsDirectory,previousDirectory,createdAt:stamp()};
        state.applicationWorkspace.attempts.push(applicationPreparation);
        await save('APPLICATION_WORKSPACE_RECOVERY_RETAINED');
        continue;
      }
      applicationPreparation.result=await runtimeModel.createRuntimeWorkspace({directory:appsDirectory});
      applicationPreparation.completedAt=stamp();
      await save('APPLICATION_WORKSPACE_CREATED');
    }
    apps=await runtimeModel.openRuntimeWorkspace({directory:appsDirectory});
    const applicationConfig=await readJSON(join(appsDirectory,'workspace.json'));
    need(!state.applicationWorkspace.workspaceId||
      state.applicationWorkspace.workspaceId===applicationConfig.workspaceId,
      'DATASETTE_INSTALLED_ORIGINAL_APPLICATION_WORKSPACE_CHANGED');
    state.applicationWorkspace.directory=appsDirectory;
    state.applicationWorkspace.workspaceId=applicationConfig.workspaceId;
    applicationPreparation.result??=applicationConfig;
    await save('APPLICATION_WORKSPACE_RETAINED');
    const attachment=await apps.attach({directory:runtimeDirectory,label:'Datasette complete installed receiving'});
    const ensureApplication=async(role,directory,selectedPort)=>{
      let item=state.applications[role];
      if(!item){item=state.applications[role]={requestId:randomUUID(),directory,port:selectedPort};await save('APPLICATION_INPUT_RETAINED');}
      if(!item.review){
        item.review=await apps.applicationsReview({runtimeId:attachment.runtimeId,kind:'datasette',
          label:role==='source'?'Datasette original received publisher':'Datasette browser-received workspace',
          settings:{workspaceDirectory:directory,connectionFile:join(directory,'connection.json'),port:selectedPort}});
        await save('APPLICATION_REVIEWED');
      }
      if(!item.saved){item.saved=await apps.applicationsSave({requestId:item.requestId,reviewId:item.review.id});await save('APPLICATION_SAVED');}
      let selected=(await apps.applicationsState()).applications.find(app=>app.id===item.saved.applicationId);
      if(!selected?.release){
        // Save may have retained the binding before its worker launch returned.
        // applicationsConnect reopens that same adoption, including queued,
        // interrupted and failed worker states; its request identity is native.
        item.connections??=[];
        const connection={at:stamp(),applicationId:item.saved.applicationId};
        item.connections.push(connection);await save('APPLICATION_CONNECTION_RETAINED');
        connection.result=await apps.applicationsConnect({applicationId:item.saved.applicationId});
        await save('APPLICATION_CONNECTING');
        selected=await waitFor(async()=>(await apps.applicationsState()).applications.find(app=>app.id===item.saved.applicationId),
          value=>Boolean(value?.release)||value?.phase==='UNAVAILABLE'||
            !value?.adoption?.active&&['FAILED','INTERRUPTED'].includes(value?.adoption?.phase),
          'The original managed runtime adoption did not settle.',300000);
      }
      need(selected?.release,'DATASETTE_INSTALLED_APPLICATION_ADOPTION',JSON.stringify(selected));
      item.connected={at:stamp(),release:selected.release,home:selected.home};await save('APPLICATION_CONNECTED');
      return item;
    };
    const startApplication=async item=>{
      const applicationId=item.saved.applicationId;
      const readApplication=async()=>(await apps.applicationsState()).applications.find(app=>app.id===applicationId);
      let selected=await readApplication();
      need(selected,'DATASETTE_INSTALLED_APPLICATION_MISSING');
      if(selected.phase==='STOPPING'){
        activeApp={applicationId,operationId:selected.current.id};
        selected=await waitFor(readApplication,value=>!value?.current?.active,
          'The original retained application stop did not settle.',30000);
        activeApp=null;
      }
      if(selected.phase!=='RUNNING'){
        if(selected.current&&(selected.current.active||
          ['PENDING','QUEUED','RUNNING','INTERRUPTED'].includes(selected.current.phase))){
          activeApp={applicationId,operationId:selected.current.id};
          if(!selected.current.active){
            item.recoveries??=[];
            const recovery={...activeApp,at:stamp()};
            item.recoveries.push(recovery);await save('APPLICATION_RECOVERY_RETAINED');
            recovery.result=await apps.applicationsRecover(activeApp);
            await save('APPLICATION_RECOVERING');
          }
        }else{
          // A start input is saved before dispatch. Reuse an input that never
          // reached its native run record after an interrupted response.
          let run=state.runs.findLast(value=>value.applicationId===applicationId&&!value.dispatched&&
            value.requestId!==selected.current?.id&&!state.stops?.some(stop=>stop.operationId===value.requestId));
          if(!run){
            const review=await apps.applicationsStartReview({applicationId});
            run={applicationId,requestId:randomUUID(),reviewId:review.id,startedAt:stamp()};
            state.runs.push(run);await save('APPLICATION_START_RETAINED');
          }
          activeApp={applicationId,operationId:run.requestId};
          run.result=await apps.applicationsStart({applicationId,requestId:run.requestId,reviewId:run.reviewId});
          run.dispatched=stamp();await save('APPLICATION_START_DISPATCHED');
        }
        selected=await waitFor(readApplication,
          value=>['RUNNING','FAILED','UNAVAILABLE','INTERRUPTED','STOPPED'].includes(value?.phase),
          'The managed original Datasette application did not announce its listener.',120000);
      }
      need(selected?.phase==='RUNNING'&&selected.current?.privateUrl,'DATASETTE_INSTALLED_APPLICATION_START',JSON.stringify(selected));
      const url=new URL(selected.current.privateUrl);
      need(url.hostname==='127.0.0.1'&&url.protocol==='http:'&&Number(url.port)===item.port,'DATASETTE_INSTALLED_APPLICATION_ORIGIN');
      activeApp={applicationId:selected.id,operationId:selected.current.id};
      const announcement=await readJSON(join(item.directory,'connection.json'));
      need(announcement.url===url.href&&announcement.workspaceId===input.workspaceId,'DATASETTE_INSTALLED_ANNOUNCEMENT');
      item.starts??=[];item.starts.push({at:stamp(),operationId:selected.current.id,announcement});
      await save('APPLICATION_RUNNING');return announcement;
    };
    const stopApplication=async({cleanup=false}={})=>{
      if(!activeApp)return;
      const stopping=activeApp;
      if(cleanup){
        const selected=(await apps.applicationsState()).applications.find(app=>app.id===stopping.applicationId);
        if(!selected?.current?.active){
          state.cleanupObservations??=[];state.cleanupObservations.push({at:stamp(),...stopping,selected});
          activeApp=null;return;
        }
      }
      await apps.applicationsStop(stopping);
      const stopped=await waitFor(async()=>(await apps.applicationsState()).applications.find(app=>app.id===stopping.applicationId),
        value=>!value?.current?.active&&['STOPPED','FAILED','CANCELLED'].includes(value?.phase),
        'The original managed application did not stop.',30000);
      need(stopped.phase==='STOPPED','DATASETTE_INSTALLED_APPLICATION_STOP',JSON.stringify(stopped));
      state.stops??=[];state.stops.push({at:stamp(),...stopping,result:stopped.current.result});
      activeApp=null;await save('APPLICATION_STOPPED');
    };
    stopActive=()=>stopApplication({cleanup:true});
    const sourceApp=await ensureApplication('source',workspaceDirectory,port);
    let announcement=await startApplication(sourceApp);
    const {createDatasetteClient}=await fromInstalled(SDK+'client.mjs');
    let native=createDatasetteClient({url:announcement.url,expectedWorkspaceId:input.workspaceId});
    const baseline=await native.dispatch('editions.inspect',{id:'wri-geothermal',offset:0,limit:250});
    need(baseline.editionSha256===EDITION_SHA&&baseline.rows.length===189&&same(baseline.columns,COLUMNS),
      'DATASETTE_INSTALLED_ORIGINAL_EDITION');
    const moduleName=isAbsolute(playwrightModule)?pathToFileURL(playwrightModule).href:playwrightModule;
    const browser=await import(moduleName);
    const chromium=browser.chromium??browser.default?.chromium;
    need(typeof chromium?.launchPersistentContext==='function','DATASETTE_INSTALLED_BROWSER_RUNTIME');
    const actualExecutable=browserExecutable??chromium.executablePath();
    const executableVersion=await runCommand(actualExecutable,['--version']);
    browserAttempt={id:randomUUID(),startedAt:stamp(),errorOffset:state.browserErrors.length,
      runtime:{playwrightModule,browserExecutable:actualExecutable,version:executableVersion.stdout.trim()}};
    state.browserAttempts??=[];state.browserAttempts.push(browserAttempt);
    await save('BROWSER_ATTEMPT_RETAINED');
    const openBrowser=async(url,width=1440,height=1000)=>{
      context=await chromium.launchPersistentContext(join(outputDirectory,'browser-profile'),{
        headless:true,viewport:{width,height},acceptDownloads:true,
        ...(browserExecutable?{executablePath:browserExecutable}:{}),args:['--disable-dev-shm-usage']});
      const page=context.pages()[0]??await context.newPage();
      page.on('pageerror',error=>{state.browserErrors.push({at:stamp(),...issue(error)});});
      await page.goto(url,{waitUntil:'domcontentloaded',timeout:120000});
      await waitBrowser(page);return page;
    };
    let page=await openBrowser(announcement.url);
    if(!state.checks.exactBrowserRows){
      await page.locator('#ds-editions button').filter({hasText:baseline.edition.name}).first().click();
      await waitBrowser(page);
      state.browserRows=await readRenderedRows(page,baseline);
      const aliases=await page.locator('#ds-projection input[data-field="name"]').evaluateAll(inputs=>inputs.map(input=>input.value));
      need(same(aliases,Object.keys(baseline.review.projection)),'DATASETTE_BROWSER_REVIEWED_ALIASES');
      await page.locator('#ds-example').click();
      need(same(JSON.parse(await page.locator('#ds-columns').inputValue()),COLUMNS),'DATASETTE_BROWSER_WRI_COLUMNS');
      await page.locator('#ds-use-selection').click();
      need(same(JSON.parse(await page.locator('#ds-columns').inputValue()),COLUMNS),'DATASETTE_BROWSER_REUSED_COLUMNS');
      const window=baseline.capture.consistency.observationWindow;
      const observation=await page.locator('#ds-observation').textContent();
      need(window?.notBefore&&observation.includes(window.notBefore.replace('T',' ').replace(/Z$/,' UTC')),
        'DATASETTE_BROWSER_OBSERVATION_WINDOW');
      await page.screenshot({path:join(outputDirectory,'desktop-source.png'),fullPage:true});
      state.checks.exactBrowserRows=true;state.checks.reviewedAliasesRetained=true;state.checks.wriSelectionReusable=true;
      await save('BROWSER_SOURCE_REVIEWED');
    }
    const editionId='browser-received-wri';
    if(!state.uploadResponse){
      let interceptionError=null;
      await page.route('**/api/upload?**',async route=>{
        try{
          if(route.request().method()!=='POST'){await route.continue();return;}
          const response=await route.fetch(),value=await response.json();
          need(response.status()===200,'DATASETTE_BROWSER_UPLOAD_HTTP',JSON.stringify(value));
          if(value.state==='COMPLETE'&&!state.uploadResponse){
            state.uploadResponse=value;await save('BROWSER_UPLOAD_NATIVE_COMPLETE');
            await route.abort('connectionreset');
          }else await route.fulfill({response});
        }catch(error){interceptionError=error;await route.abort('failed').catch(()=>{});}
      });
      await page.locator('#ds-receive-kind').selectOption('source');
      await page.locator('#ds-receive-id').fill(editionId);
      await page.locator('#ds-receive-sha').fill(ARCHIVE_SHA);
      await page.locator('#ds-receive-file').setInputFiles(join(runtime.sourceRoot,WRI));
      await page.locator('#ds-receive-submit').click();
      await waitFor(()=>{if(interceptionError)throw interceptionError;return journalFromBrowser(page);},
        records=>records.some(record=>state.uploadResponse&&record.input?.uploadId===state.uploadResponse.uploadId&&record.state==='UNCERTAIN'),
        'The browser did not retain the uncertain original completed-upload response.');
      state.browserUploadBeforeRestart=(await journalFromBrowser(page)).find(record=>record.input?.uploadId===state.uploadResponse.uploadId);
      need(state.browserUploadBeforeRestart.receiving.id===editionId,'DATASETTE_BROWSER_RECEIVING_IDENTITY');
      await page.unroute('**/api/upload?**');await save('BROWSER_UPLOAD_RESPONSE_INTERRUPTED');
    }
    if(!state.checks.browserUploadReceivingRecovery){
      await context.close();context=null;await stopApplication();
      const previousInstance=announcement.instanceId;
      announcement=await startApplication(sourceApp);
      need(announcement.instanceId!==previousInstance&&Number(new URL(announcement.url).port)===port,'DATASETTE_BROWSER_SAME_ORIGIN_RESTART');
      native=createDatasetteClient({url:announcement.url,expectedWorkspaceId:input.workspaceId});
      page=await openBrowser(announcement.url);
      need(await page.locator('#ds-receive-file').evaluate(input=>input.files.length)===0,'DATASETTE_BROWSER_FILE_RESELECTED');
      const existingUpload=(await journalFromBrowser(page)).find(record=>record.input?.uploadId===state.uploadResponse.uploadId);
      if(existingUpload?.state!=='COMPLETE'){
        await page.locator('#ds-pending-inspect').click();await waitBrowser(page);
        const uploaded=(await journalFromBrowser(page)).find(record=>record.input?.uploadId===state.uploadResponse.uploadId);
        need(['UPLOADED','RECEIVING','UNCERTAIN'].includes(uploaded?.state)&&!await page.locator('#ds-pending').isHidden(),
          'DATASETTE_BROWSER_UPLOAD_PREMATURELY_FINISHED');
        await page.locator('#ds-pending-retry').click();await waitBrowser(page);
      }
      const actual=await native.dispatch('editions.inspect',{id:editionId,offset:0,limit:250});
      const finished=(await journalFromBrowser(page)).find(record=>record.input?.uploadId===state.uploadResponse.uploadId);
      need(actual.editionSha256===EDITION_SHA&&actual.rows.length===189&&finished?.state==='COMPLETE'&&
        finished.receivingInput.sha256===ARCHIVE_SHA&&finished.receivingInput.id===editionId,
        'DATASETTE_BROWSER_COMPLETE_RECEIVING_RECOVERY');
      state.browserUploadAfterRestart=finished;state.checks.browserUploadReceivingRecovery=true;
      await save('BROWSER_RECEIVING_RECOVERED');
    }
    if(!state.checks.browserNativeRequestRecovery){
      await page.locator('#ds-editions button').filter({hasText:baseline.edition.name}).last().click();
      await waitBrowser(page);
      if(!state.selectionResponse){
        let interceptionError=null;
        await page.route('**/api/operation',async route=>{
          try{
            const body=route.request().postDataJSON();
            if(body?.operation!=='source.select'||state.selectionResponse){await route.continue();return;}
            const response=await route.fetch(),value=await response.json();
            need(response.status()===200,'DATASETTE_BROWSER_SELECTION_HTTP',JSON.stringify(value));
            state.selectionInput=body.input;state.selectionResponse=value;await save('BROWSER_SELECTION_NATIVE_COMPLETE');
            await route.abort('connectionreset');
          }catch(error){interceptionError=error;await route.abort('failed').catch(()=>{});}
        });
        await page.locator('#ds-select-edition').click();
        await waitFor(()=>{if(interceptionError)throw interceptionError;return journalFromBrowser(page);},
          records=>records.some(record=>state.selectionInput?.requestId&&record.input?.requestId===state.selectionInput.requestId&&record.state==='UNCERTAIN'),
          'The original selected-source request was not retained after its response ended.');
        await page.unroute('**/api/operation');
      }
      const pendingSelection=(await journalFromBrowser(page)).find(record=>record.input?.requestId===state.selectionInput.requestId);
      if(pendingSelection?.state!=='COMPLETE'){await page.locator('#ds-pending-inspect').click();await waitBrowser(page);}
      const receipt=await native.dispatch('requests.inspect',{requestId:state.selectionInput.requestId});
      const local=(await journalFromBrowser(page)).find(record=>record.input?.requestId===state.selectionInput.requestId);
      need(receipt.state==='COMPLETE'&&local?.state==='COMPLETE'&&same(receipt.result,state.selectionResponse),
        'DATASETTE_BROWSER_NATIVE_REQUEST_RECOVERY');
      state.selectionReceipt=receipt;state.checks.browserNativeRequestRecovery=true;
      await save('BROWSER_ORIGINAL_REQUEST_RECOVERED');
    }
    if(!state.sourceDownload){
      await page.locator('#ds-export-edition').click();await waitBrowser(page);
      const receipt=JSON.parse(await page.locator('#ds-export-result pre').textContent());
      const downloaded=await browserDownload(page,'#ds-export-result',join(outputDirectory,'browser-source.sfds.gz'));
      need(downloaded.sha256===receipt.sha256,'DATASETTE_BROWSER_SOURCE_DOWNLOAD');
      state.sourceDownload=downloaded;state.artifacts.push(downloaded);await save('BROWSER_SOURCE_DOWNLOADED');
    }
    if(!state.workspaceDownload){
      await page.locator('#ds-export-workspace').click();await waitBrowser(page);
      const receipt=JSON.parse(await page.locator('#ds-workspace-export-result pre').textContent());
      const downloaded=await browserDownload(page,'#ds-workspace-export-result',join(outputDirectory,'browser-workspace.zip'));
      need(downloaded.sha256===receipt.sha256,'DATASETTE_BROWSER_WORKSPACE_DOWNLOAD');
      state.workspaceDownload=downloaded;state.workspaceExport=receipt;state.artifacts.push(downloaded);await save('BROWSER_WORKSPACE_DOWNLOADED');
    }
    const browserReceivedDirectory=join(outputDirectory,'browser-received-workspace');
    if(!state.workspaceReceived){
      await page.locator('#ds-receive-kind').selectOption('workspace');
      await page.locator('#ds-receive-directory').fill(browserReceivedDirectory);
      await page.locator('#ds-receive-sha').fill(state.workspaceDownload.sha256);
      await page.locator('#ds-receive-file').setInputFiles(state.workspaceDownload.file);
      await page.locator('#ds-receive-submit').click();await waitBrowser(page);
      const result=JSON.parse(await page.locator('#ds-receive-result pre').textContent());
      need(result.directory===browserReceivedDirectory&&result.sha256===state.workspaceDownload.sha256,
        'DATASETTE_BROWSER_WORKSPACE_RECEIVING');
      state.workspaceReceived=result;await save('BROWSER_WORKSPACE_RECEIVED');
    }
    await context.close();context=null;await stopApplication();
    const copied=await ensureApplication('received',browserReceivedDirectory,receivedPort);
    const copiedAnnouncement=await startApplication(copied);
    const copiedNative=createDatasetteClient({url:copiedAnnouncement.url,expectedWorkspaceId:input.workspaceId});
    const copiedEdition=await copiedNative.dispatch('editions.inspect',{id:editionId,offset:0,limit:250});
    need(copiedEdition.editionSha256===EDITION_SHA&&same(copiedEdition.rows,baseline.rows),
      'DATASETTE_BROWSER_WORKSPACE_REOPEN');
    const cliCommand=await installer.runtimeCommand({directory:runtimeDirectory,args:['datasette','status',
      '--url-file',join(browserReceivedDirectory,'connection.json'),'--expected-workspace-id',input.workspaceId]});
    const cli=await runCommand(cliCommand.executable,cliCommand.args,{cwd:cliCommand.cwd});
    need(JSON.parse(cli.stdout).workspaceId===input.workspaceId,'DATASETTE_INSTALLED_CLI_REOPEN');
    state.installedCommand={...cliCommand,code:cli.code,workspaceId:input.workspaceId};
    page=await openBrowser(copiedAnnouncement.url,390,844);
    await page.locator('#ds-editions button').filter({hasText:baseline.edition.name}).last().click();await waitBrowser(page);
    const layout=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth,
      tables:[...document.querySelectorAll('.table-wrap')].filter(element=>element.scrollWidth>element.clientWidth).length}));
    need(layout.page<=layout.viewport+1,'DATASETTE_BROWSER_MOBILE_OVERFLOW',JSON.stringify(layout));
    state.mobile={...layout,workspaceId:input.workspaceId,editionSha256:copiedEdition.editionSha256};
    await page.screenshot({path:join(outputDirectory,'mobile-received.png'),fullPage:true});
    await context.close();context=null;await stopApplication();
    for(const name of ['desktop-source.png','mobile-received.png']){
      const file=join(outputDirectory,name),raw=await readFile(file);
      if(!state.artifacts.some(item=>item.file===file))state.artifacts.push({file,bytes:raw.length,sha256:sha(raw)});
    }
    const currentBrowserErrors=state.browserErrors.slice(browserAttempt.errorOffset);
    browserAttempt.endedAt=stamp();browserAttempt.errorCount=currentBrowserErrors.length;
    need(currentBrowserErrors.length===0,'DATASETTE_BROWSER_RUNTIME_ERRORS',JSON.stringify(currentBrowserErrors));
    state.checks={...state.checks,managedReviewSaveStart:true,managedStopReopen:true,stableBrowserOrigin:true,
      completeSourceBrowserDownload:true,completeWorkspaceBrowserDownload:true,completeWorkspaceBrowserReceiving:true,
      receivedApplicationReopened:true,installedCommandReopened:true,mobileOperatorLayout:true};
    state.completedAt=stamp();await save('COMPLETE');
    return {state:'COMPLETE',report:stateFile,sourceCommit:sourceRef,workspaceId:input.workspaceId,
      checks:state.checks,installedRuntime:runtimeDirectory,receivedWorkspace:browserReceivedDirectory,artifacts:state.artifacts};
  }catch(error){
    failed=true;
    if(browserAttempt){browserAttempt.endedAt=stamp();browserAttempt.errorCount=state.browserErrors.length-browserAttempt.errorOffset;}
    state.error=issue(error);state.phase='INTERRUPTED';state.updatedAt=stamp();await retain(stateFile,state);throw error;
  }
  finally{
    if(context)await context.close().catch(error=>process.stderr.write(JSON.stringify(issue(error))+'\n'));
    if(activeApp&&apps)await (stopActive?stopActive():apps.applicationsStop(activeApp)).catch(error=>process.stderr.write(JSON.stringify(issue(error))+'\n'));
    await apps?.close();
    if(failed){state.phase='INTERRUPTED';state.updatedAt=stamp();await retain(stateFile,state);}
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    need(process.argv.length===4&&process.argv[2]==='--input'&&isAbsolute(process.argv[3]),
      'DATASETTE_INSTALLED_INPUT','Use --input ABSOLUTE_JSON_FILE.');
    process.stdout.write(JSON.stringify(await runInstalledDatasetteBrowser(await readJSON(process.argv[3])))+'\n');
  }catch(error){process.stderr.write(JSON.stringify(issue(error))+'\n');process.exitCode=1;}
}
