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
const issue=error=>({code:error.code??error.name,message:error.message});
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
  repository,sourceRef='04e77d53a1a56fe45d74022ab2cd9f54acb0349a',publisherProgrammeDirectory,outputDirectory,
  playwrightModule='playwright',browserExecutable,port=53173,receivedPort=53174,
  offline=false,npmCache,python='python3',npm='npm',
}={}) {
  for(const [name,value] of Object.entries({repository,publisherProgrammeDirectory,outputDirectory}))
    absolute(value,name);
  need(/^[a-f0-9]{40}$/.test(sourceRef??''),'DATASETTE_INSTALLED_SOURCE_REF');
  need(Number.isInteger(port)&&port>0&&port<65536&&Number.isInteger(receivedPort)&&receivedPort>0&&receivedPort<65536&&port!==receivedPort,
    'DATASETTE_INSTALLED_EXPLICIT_PORTS');
  need(Number(process.versions.node.split('.')[0])>=24,'DATASETTE_INSTALLED_NODE_24');
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  need(await realpath(outputDirectory)===outputDirectory,'DATASETTE_INSTALLED_CANONICAL_DIRECTORY');
  const programme=await readJSON(join(publisherProgrammeDirectory,'publisher-programme-result.json'));
  const sourceState=await readJSON(join(publisherProgrammeDirectory,'publisher-programme-state.json'));
  need(sourceState.phase==='COMPLETE'&&programme.sourceRefresh?.state==='COMPLETE'&&programme.mcpReceiving?.passed&&
    programme.managedUpload?.resumed?.state==='COMPLETE','DATASETTE_INSTALLED_COMPLETED_ORIGINAL_PROGRAMME',
    'Continue the completed original publisher programme and its retained received workspace.');
  const workspaceDirectory=absolute(programme.receiving.directory,'Original received workspace');
  const sourceDeclaration=await readJSON(join(workspaceDirectory,'workspace.json'));
  const input={repository,sourceRef,publisherProgrammeDirectory,outputDirectory,workspaceDirectory,
    workspaceId:sourceDeclaration.workspaceId,port,receivedPort,playwrightModule,browserExecutable:browserExecutable??null};
  const stateFile=join(outputDirectory,'installed-browser-journey.json');
  let state=await exists(stateFile)?await readJSON(stateFile):null;
  if(state)need(same(state.input,input),'DATASETTE_INSTALLED_ORIGINAL_INPUT_CHANGED');
  else state={schema:'stellar-forge.datasette-installed-browser-journey.v1',id:randomUUID(),input,
    startedAt:stamp(),phase:'CREATED',checks:{},applications:{},runs:[],browserErrors:[],artifacts:[]};
  const save=async phase=>{state.phase=phase;state.updatedAt=stamp();await retain(stateFile,state);
    process.stderr.write(JSON.stringify({operation:'datasette-installed-browser',phase,at:state.updatedAt})+'\n');};
  if(state.phase==='COMPLETE'){
    for(const file of state.artifacts)need(sha(await readFile(file.file))===file.sha256,'DATASETTE_INSTALLED_ARTIFACT_CHANGED');
    return {state:'COMPLETE',reused:true,report:stateFile,checks:state.checks,artifacts:state.artifacts};
  }
  const fromRepo=path=>import(pathToFileURL(join(repository,path)).href);
  let apps,context,activeApp=null,stopActive=null;
  try{
    await save('ORIGINAL_PROGRAMME_RETAINED');
    const {buildDistribution}=await fromRepo(DIST+'build.mjs');
    state.build=await buildDistribution({repository,ref:sourceRef,output:join(outputDirectory,'build'),
      selection:'datasette',offline:true,resume:true,python,onProgress:event=>{
        if(['selected','materializing','packaged','reused'].includes(event.phase))
          process.stderr.write(JSON.stringify({operation:'datasette-installed-build',...event})+'\n');
      }});
    need(state.build.sourceCommit===sourceRef&&typeof state.build.archive==='string','DATASETTE_INSTALLED_BUILD_SOURCE');
    if(!state.artifacts.some(file=>file.file===state.build.archive))state.artifacts.push({file:state.build.archive,bytes:state.build.archiveBytes,sha256:state.build.sha256});
    await save('BUILT');
    const installer=await fromRepo(DIST+'runtime-install.mjs'),runtimeDirectory=join(outputDirectory,'runtime');
    if(!await exists(join(runtimeDirectory,'runtime-install.json')))
      state.prepared=await installer.prepareRuntimeInstall({directory:runtimeDirectory,archive:state.build.archive,
        sha256:state.build.sha256,native:false,features:[],operator:false,python});
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
    const runtimeModel=await fromInstalled(DIST+'runtime-workspace/model.mjs'),appsDirectory=join(outputDirectory,'applications');
    if(!await exists(join(appsDirectory,'workspace.json')))await runtimeModel.createRuntimeWorkspace({directory:appsDirectory});
    apps=await runtimeModel.openRuntimeWorkspace({directory:appsDirectory});
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
      need(!item.saved.connectionError,'DATASETTE_INSTALLED_APPLICATION_CONNECTION',JSON.stringify(item.saved.connectionError));
      const selected=await waitFor(async()=>(await apps.applicationsState()).applications.find(app=>app.id===item.saved.applicationId),
        value=>Boolean(value?.release)||['FAILED','UNAVAILABLE','INTERRUPTED'].includes(value?.phase),
        'The original managed runtime adoption did not settle.',300000);
      need(selected.release,'DATASETTE_INSTALLED_APPLICATION_ADOPTION',JSON.stringify(selected));
      return item;
    };
    const startApplication=async item=>{
      let selected=(await apps.applicationsState()).applications.find(app=>app.id===item.saved.applicationId);
      if(selected?.phase!=='RUNNING'){
        need(!selected?.current?.active,'DATASETTE_INSTALLED_APPLICATION_OWNER',JSON.stringify(selected));
        const review=await apps.applicationsStartReview({applicationId:item.saved.applicationId});
        const run={applicationId:item.saved.applicationId,requestId:randomUUID(),reviewId:review.id,startedAt:stamp()};
        state.runs.push(run);await save('APPLICATION_START_RETAINED');
        await apps.applicationsStart({applicationId:run.applicationId,requestId:run.requestId,reviewId:run.reviewId});
        selected=await waitFor(async()=>(await apps.applicationsState()).applications.find(app=>app.id===item.saved.applicationId),
          value=>['RUNNING','FAILED','UNAVAILABLE','INTERRUPTED'].includes(value?.phase),
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
    const stopApplication=async()=>{
      if(!activeApp)return;
      const stopping=activeApp;
      await apps.applicationsStop(stopping);
      const stopped=await waitFor(async()=>(await apps.applicationsState()).applications.find(app=>app.id===stopping.applicationId),
        value=>!value?.current?.active&&['STOPPED','FAILED','CANCELLED'].includes(value?.phase),
        'The original managed application did not stop.',30000);
      need(stopped.phase==='STOPPED','DATASETTE_INSTALLED_APPLICATION_STOP',JSON.stringify(stopped));
      state.stops??=[];state.stops.push({at:stamp(),...stopping,result:stopped.current.result});
      activeApp=null;await save('APPLICATION_STOPPED');
    };
    stopActive=stopApplication;
    const sourceApp=await ensureApplication('source',workspaceDirectory,port);
    let announcement=await startApplication(sourceApp);
    const {createDatasetteClient}=await fromInstalled(SDK+'client.mjs');
    let native=createDatasetteClient({url:announcement.url,expectedWorkspaceId:input.workspaceId});
    const baseline=await native.dispatch('editions.inspect',{id:'wri-geothermal',offset:0,limit:250});
    need(baseline.editionSha256===EDITION_SHA&&baseline.rows.length===189&&same(baseline.columns,COLUMNS),
      'DATASETTE_INSTALLED_ORIGINAL_EDITION');
    const moduleName=isAbsolute(playwrightModule)?pathToFileURL(playwrightModule).href:playwrightModule;
    const browser=await import(moduleName);
    need(browser.chromium?.launchPersistentContext,'DATASETTE_INSTALLED_BROWSER_RUNTIME');
    const openBrowser=async(url,width=1440,height=1000)=>{
      context=await browser.chromium.launchPersistentContext(join(outputDirectory,'browser-profile'),{
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
      state.checks.exactBrowserRows=true;state.checks.reviewedAliasesRetained=true;state.checks.wriSelectionReusable=true;
      await page.screenshot({path:join(outputDirectory,'desktop-source.png'),fullPage:true});
      await save('BROWSER_SOURCE_REVIEWED');
    }
    const editionId='browser-received-wri';
    if(!state.uploadResponse){
      await page.route('**/api/upload?**',async route=>{
        if(route.request().method()!=='POST'){await route.continue();return;}
        const response=await route.fetch(),value=await response.json();
        if(value.state==='COMPLETE'&&!state.uploadResponse){
          state.uploadResponse=value;await save('BROWSER_UPLOAD_NATIVE_COMPLETE');
          await route.abort('connectionreset');
        }else await route.fulfill({response});
      });
      await page.locator('#ds-receive-kind').selectOption('source');
      await page.locator('#ds-receive-id').fill(editionId);
      await page.locator('#ds-receive-sha').fill(ARCHIVE_SHA);
      await page.locator('#ds-receive-file').setInputFiles(join(runtime.sourceRoot,WRI));
      await page.locator('#ds-receive-submit').click();
      await waitFor(()=>journalFromBrowser(page),records=>records.some(record=>record.input?.uploadId===state.uploadResponse?.uploadId&&record.state==='UNCERTAIN'),
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
        await page.route('**/api/operation',async route=>{
          const body=route.request().postDataJSON();
          if(body?.operation!=='source.select'||state.selectionResponse){await route.continue();return;}
          const response=await route.fetch(),value=await response.json();
          need(response.status()===200,'DATASETTE_BROWSER_SELECTION_HTTP',JSON.stringify(value));
          state.selectionInput=body.input;state.selectionResponse=value;await save('BROWSER_SELECTION_NATIVE_COMPLETE');
          await route.abort('connectionreset');
        });
        await page.locator('#ds-select-edition').click();
        await waitFor(()=>journalFromBrowser(page),records=>records.some(record=>record.input?.requestId===state.selectionInput?.requestId&&record.state==='UNCERTAIN'),
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
      state.sourceDownload=await browserDownload(page,'#ds-export-result',join(outputDirectory,'browser-source.sfds.gz'));
      need(state.sourceDownload.sha256===receipt.sha256,'DATASETTE_BROWSER_SOURCE_DOWNLOAD');
      state.artifacts.push(state.sourceDownload);await save('BROWSER_SOURCE_DOWNLOADED');
    }
    if(!state.workspaceDownload){
      await page.locator('#ds-export-workspace').click();await waitBrowser(page);
      const receipt=JSON.parse(await page.locator('#ds-workspace-export-result pre').textContent());
      state.workspaceDownload=await browserDownload(page,'#ds-workspace-export-result',join(outputDirectory,'browser-workspace.zip'));
      need(state.workspaceDownload.sha256===receipt.sha256,'DATASETTE_BROWSER_WORKSPACE_DOWNLOAD');
      state.workspaceExport=receipt;state.artifacts.push(state.workspaceDownload);await save('BROWSER_WORKSPACE_DOWNLOADED');
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
    need(state.browserErrors.length===0,'DATASETTE_BROWSER_RUNTIME_ERRORS',JSON.stringify(state.browserErrors));
    state.checks={...state.checks,managedReviewSaveStart:true,managedStopReopen:true,stableBrowserOrigin:true,
      completeSourceBrowserDownload:true,completeWorkspaceBrowserDownload:true,completeWorkspaceBrowserReceiving:true,
      receivedApplicationReopened:true,installedCommandReopened:true,mobileOperatorLayout:true};
    state.completedAt=stamp();await save('COMPLETE');
    return {state:'COMPLETE',report:stateFile,sourceCommit:sourceRef,workspaceId:input.workspaceId,
      checks:state.checks,installedRuntime:runtimeDirectory,receivedWorkspace:browserReceivedDirectory,artifacts:state.artifacts};
  }catch(error){state.error=issue(error);state.phase='INTERRUPTED';state.updatedAt=stamp();await retain(stateFile,state);throw error;}
  finally{
    if(context)await context.close().catch(error=>process.stderr.write(JSON.stringify(issue(error))+'\n'));
    if(activeApp&&apps)await (stopActive?stopActive():apps.applicationsStop(activeApp)).catch(error=>process.stderr.write(JSON.stringify(issue(error))+'\n'));
    await apps?.close();
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{
    need(process.argv.length===4&&process.argv[2]==='--input'&&isAbsolute(process.argv[3]),
      'DATASETTE_INSTALLED_INPUT','Use --input ABSOLUTE_JSON_FILE.');
    process.stdout.write(JSON.stringify(await runInstalledDatasetteBrowser(await readJSON(process.argv[3])))+'\n');
  }catch(error){process.stderr.write(JSON.stringify(issue(error))+'\n');process.exitCode=1;}
}
