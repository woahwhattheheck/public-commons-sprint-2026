#!/usr/bin/env node
// MIT. One complete original-source producer, browser, package and cold receiving operation.
import {dirname,join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {readFile,mkdir} from 'node:fs/promises';
import {readJson,writeJson,exists,privateDirectory} from '../../sf88-operator-buyer-cli/node/store.mjs';
import {need,identifier,digest,hash,clone,timestamp} from './model.mjs';
import {retainJson,fileDescriptor,MAX_METADATA_BYTES} from './files.mjs';
import {withNativeLease,runNative,readRuntime} from './native.mjs';
import {openPMTilesWorkspace} from './workspace.mjs';
import {buildPMTilesRuntime} from './build-runtime.mjs';
import {servePMTilesWorkspace} from './server.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const SAMPLE_SHA='b96efe3ea10b98632c0c0dc229d000b604ebdad6b2f1321ea11d9de931df1ce5';
const SAMPLE_BYTES=716052;
async function capture(path,value){await retainJson(path,value);return value;}
async function readOptional(path){try{return await readJson(path,MAX_METADATA_BYTES);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function nativeResult(root,name,argv,{signal,leaseFd}={}){
  const selected=join(root,'commands',identifier(name));
  const native=await runNative(selected,argv,{signal,leaseFd,timeoutMs:600000});
  const bytes=await readFile(join(selected,native.stdout.path));
  const text=bytes.toString('utf8').trim();
  const value=JSON.parse(text);
  need(!value.error,'PMTILES_RECEIVING_CLI_FAILED',JSON.stringify(value.error));
  return {native,value};
}
export async function receiveOriginalPMTilesProduct(input,{signal}={}){
  input=clone(input);identifier(input.operationId);
  need(input.schema==='starforge.pmtiles-native-receiving.v1','PMTILES_RECEIVING_INPUT_REQUIRED');
  for(const key of ['directory','playwrightModule','chromiumExecutable'])need(isAbsolute(input[key]),'PMTILES_RECEIVING_PATH_REQUIRED',key);
  need(typeof input.reviewer==='string'&&input.reviewer.trim(),'PMTILES_RECEIVING_REVIEWER_REQUIRED');
  const root=await privateDirectory(resolve(input.directory));
  await privateDirectory(join(root,'locks'));await privateDirectory(join(root,'steps'));await privateDirectory(join(root,'browser-records'));
  await retainJson(join(root,'original-input.json'),input);
  const requestSha256=digest(input);
  return withNativeLease(join(root,'locks'),'whole-receiving',async leaseFd=>{
    const completed=await readOptional(join(root,'native-result.json'));
    if(completed){
      need(completed.requestSha256===requestSha256,'PMTILES_ORIGINAL_RECEIVING_INPUT_CHANGED');
      const archive=await fileDescriptor(completed.package.archive.path,{limit:34359738368,signal});
      need(archive.bytes===completed.package.archive.bytes&&archive.sha256===completed.package.archive.sha256,'PMTILES_RECEIVING_PACKAGE_CHANGED');
      return {...completed,reused:true};
    }
    async function step(name,work){
      const path=join(root,'steps',identifier(name)+'.json'),prior=await readOptional(path);
      if(prior){need(prior.requestSha256===requestSha256,'PMTILES_RECEIVING_STEP_CHANGED');return prior.result;}
      signal?.throwIfAborted();process.stdout.write(JSON.stringify({operationId:input.operationId,phase:name,at:timestamp()})+'\n');
      const result=await work();
      await capture(path,{requestSha256,result,completedAt:timestamp()});return result;
    }
    const runtimeResult=await step('original-runtime',async()=>{
      if(input.runtimeProfile){
        need(isAbsolute(input.runtimeProfile),'PMTILES_RUNTIME_PROFILE_PATH_REQUIRED');
        const runtime=await readRuntime(input.runtimeProfile);return {profilePath:resolve(input.runtimeProfile),runtime};
      }
      need(input.runtimeBuild,'PMTILES_EXISTING_RUNTIME_OR_BUILD_REQUIRED');
      return buildPMTilesRuntime(input.runtimeBuild,{signal});
    });
    const runtime=await readRuntime(runtimeResult.profilePath);
    const samplePath=join(HERE,'sources','stamen-toner-z0-z3.pmtiles'),stylePath=join(HERE,'sources','sample-raster-style.json');
    const [sample,style,sourceContract]=await Promise.all([
      fileDescriptor(samplePath,{signal}),fileDescriptor(stylePath,{signal}),readJson(join(HERE,'sources','sample.json'),MAX_METADATA_BYTES)]);
    need(sample.bytes===SAMPLE_BYTES&&sample.sha256===SAMPLE_SHA&&sourceContract.sha256===SAMPLE_SHA&&sourceContract.bytes===SAMPLE_BYTES,
      'PMTILES_ORIGINAL_SAMPLE_CHANGED');
    const sourceSelection=await step('original-source-selection',async()=>({archive:{path:samplePath,...sample},style:{path:stylePath,...style},
      sourceCommit:sourceContract.sourceCommit,sourceBlob:sourceContract.blob,license:sourceContract.license}));
    need(digest(sourceSelection.archive)===digest({path:samplePath,...sample})&&digest(sourceSelection.style)===digest({path:stylePath,...style}),
      'PMTILES_ORIGINAL_RECEIVING_SOURCE_CHANGED');
    let workspace,server,context,page;
    const browserErrors=[],nativeTileResponses=[];
    const browserOptions={executablePath:resolve(input.chromiumExecutable),headless:true,acceptDownloads:true,
      viewport:{width:1360,height:960},args:['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage',
        '--disable-background-networking','--disable-extensions','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']};
    const playwright=await import(pathToFileURL(resolve(input.playwrightModule)).href);
    need(playwright.chromium&&typeof playwright.chromium.launchPersistentContext==='function','PMTILES_EXISTING_PLAYWRIGHT_REQUIRED');
    const browserIdentity={module:await fileDescriptor(resolve(input.playwrightModule),{signal}),
      executable:await fileDescriptor(resolve(input.chromiumExecutable),{limit:1073741824,signal}),node:process.version,platform:process.platform};
    await step('original-browser-runtime',async()=>browserIdentity);
    async function browserAt(targetServer,directory){
      const opened=await playwright.chromium.launchPersistentContext(directory,browserOptions);
      const current=opened.pages()[0]??await opened.newPage();
      current.on('pageerror',error=>browserErrors.push({phase:'PAGE',message:String(error.message),at:timestamp()}));
      current.on('response',response=>{if(/\/preview\/[a-f0-9]{64}\/tiles\//.test(response.url()))
        nativeTileResponses.push({url:response.url(),status:response.status(),at:timestamp()});});
      await current.goto(targetServer.url,{waitUntil:'domcontentloaded',timeout:30000});
      await current.waitForFunction(id=>document.querySelector('#identity')?.textContent.includes(id),targetServer.workspaceId,{timeout:30000});
      return {context:opened,page:current};
    }
    async function openNativeMap(current,targetServer,releaseId,attribution='Map tiles by Stamen Design'){
      const active=targetServer.controller.state().preview;
      if(!active?.alive||active.releaseId!==releaseId)
        await targetServer.controller.execute('preview',{requestId:'receiving-preview-'+digest({releaseId}).slice(0,32),
          expectedWorkspaceId:targetServer.workspaceId,releaseId},{signal});
      await current.locator('#refresh').click();
      await current.waitForFunction(release=>document.querySelector('#mapStatus')?.textContent.includes(release),releaseId,{timeout:30000});
      await current.waitForFunction(()=>document.querySelector('#mapStatus')?.dataset.state==='ready',null,{timeout:60000});
      await current.locator('#map canvas').first().waitFor({state:'visible',timeout:30000});
      await current.waitForFunction(()=>[...document.querySelectorAll('#map canvas')].some(canvas=>canvas.width>0&&canvas.height>0),null,{timeout:30000});
      await current.locator('#rights').getByText(attribution,{exact:false}).waitFor({state:'visible'});
    }
    async function savedBrowserState(current,target){
      const value=await current.evaluate(()=>({origin:location.origin,entries:Object.fromEntries(Object.keys(localStorage)
        .filter(key=>key.startsWith('pmtiles.browser.v1:')).map(key=>[key,localStorage.getItem(key)]))}));
      await writeJson(target,value);return value;
    }
    async function uiAction(name,action,button,{before,afterCommit,dropResponse=false}={}){
      const inputPath=join(root,'browser-records',name+'-request.json'),resultPath=join(root,'browser-records',name+'-response.json');
      const existing=await readOptional(inputPath);
      if(existing){
        const selected=server.controller.workspace.getRequest(existing.requestId);
        let result=selected?.status==='COMPLETE'?selected.result:await server.controller.execute(action,existing,{signal});
        const saved=await readOptional(resultPath);
        if(saved)result=saved.result;
        else await capture(resultPath,{action,result,recoveredFromOriginalRequest:true});
        await page.locator('#refresh').click();
        return {input:existing,result,reused:true};
      }
      let notifyCommit,notifyError,releaseResponse,deadline;
      const committed=new Promise((resolve,reject)=>{notifyCommit=resolve;notifyError=reject;});
      const responseGate=new Promise(resolve=>{releaseResponse=resolve;});
      const pattern='**/api/actions/'+action;
      let handled=false;
      const handler=async route=>{
        if(handled){await route.continue();return;}handled=true;
        try{
          const body=route.request().postDataJSON();
          need(body.expectedWorkspaceId===server.workspaceId,'PMTILES_BROWSER_WORKSPACE_CHANGED');
          await capture(inputPath,body);
          const actual=await route.fetch(),raw=await actual.body(),value=JSON.parse(raw);
          need(actual.status()===200&&!value.error,'PMTILES_BROWSER_OPERATION_FAILED',JSON.stringify(value.error??value));
          await capture(resultPath,{action,result:value});
          notifyCommit({input:body,result:value});
          if(dropResponse){await responseGate;await route.abort('failed');}
          else await route.fulfill({response:actual,body:raw});
        }catch(error){notifyError(error);await route.abort('failed').catch(()=>{});}
      };
      await page.route(pattern,handler);
      try{
        if(before)await before();
        await page.locator(button).click();
        const observed=await Promise.race([committed,new Promise((resolve,reject)=>{deadline=setTimeout(()=>reject(new Error('The original browser action did not return.')),600000);})]);
        if(afterCommit)await afterCommit(observed);
        releaseResponse();
        if(!dropResponse)await page.waitForFunction(()=>!document.querySelector('#pending')?.textContent,null,{timeout:30000});
        return observed;
      }finally{clearTimeout(deadline);releaseResponse();await page.unroute(pattern,handler);}
    }
    try{
      workspace=await openPMTilesWorkspace({directory:join(root,'workspace'),title:'Original Stamen regional map receiving'});
      const workspaceId=workspace.state().id;
      const selectedId=await step('original-workspace',async()=>({id:workspaceId,directory:workspace.directory}));
      need(selectedId.id===workspaceId,'PMTILES_RECEIVING_WORKSPACE_CHANGED');
      const common={expectedWorkspaceId:workspaceId};
      const sourceUrl='https://github.com/protomaps/PMTiles/blob/'+sourceContract.sourceCommit+'/'+sourceContract.path;
      const archive=await workspace.importLocal({...common,requestId:'original-stamen-archive',name:'stamen-toner-z0-z3.pmtiles',kind:'pmtiles',
        path:samplePath,rights:{license:'CC-BY-4.0 and ODbL-1.0',attribution:sourceContract.license.attribution,sourceUrl},
        expected:{bytes:SAMPLE_BYTES,sha256:SAMPLE_SHA}},{signal});
      const styleResource=await workspace.importLocal({...common,requestId:'original-stamen-style',name:'sample-raster-style.json',kind:'style',
        path:stylePath,rights:{license:'MIT; embedded map attribution retained',attribution:sourceContract.license.attribution,sourceUrl},
        expected:style},{signal});
      const edition=await workspace.saveEdition({...common,requestId:'original-first-edition',editionId:'original-stamen-toner',expectedVersion:0,
        edition:{name:'Original Stamen Toner',notes:'Original complete licensed archive and style.',style:styleResource.id,
          archives:[{sourceId:'toner',resourceId:archive.id,type:'raster'}],sprite:null,glyphs:[],layerDecisions:[],view:{center:[0,0],zoom:2}}});
      const inspection=await workspace.inspectEdition({...common,requestId:'original-first-inspection',editionId:edition.id,version:edition.version},runtime,{signal});
      const firstReview=await workspace.review({...common,requestId:'original-first-review',editionId:edition.id,version:edition.version,
        inspectionRequestId:'original-first-inspection',expectedCurrentRelease:null,reviewer:input.reviewer,
        note:'Complete original archive, license, style, native diagnostics and known-present tile reviewed.'});
      const firstRelease=await workspace.prepareRelease({...common,requestId:'original-first-release',reviewId:firstReview.id,reviewSha256:firstReview.reviewSha256},{signal});
      const firstPublication=await workspace.publish({...common,requestId:'original-first-publication',releaseId:firstRelease.id,
        manifestSha256:firstRelease.manifestSha256,expectedCurrentRelease:null},{signal});
      await step('first-native-publication',async()=>({edition,inspectionRequestId:'original-first-inspection',inspection,review:firstReview,
        release:firstRelease,publication:firstPublication,archive,style:styleResource}));
      const originalDirectory=workspace.directory;await workspace.close();workspace=null;
      server=await servePMTilesWorkspace({directory:originalDirectory,expectedWorkspaceId:workspaceId,runtime:runtimeResult.profilePath,port:0});
      ({context,page}=await browserAt(server,join(root,'browser-originator')));
      await openNativeMap(page,server,firstRelease.id);
      await page.screenshot({path:join(root,'first-native-map.png'),fullPage:true});
      await step('first-real-map',async()=>({origin:server.origin,preview:server.controller.state().preview,
        screenshot:await fileDescriptor(join(root,'first-native-map.png'),{signal})}));
      const submittedNotes='Second edition submitted through the original browser.';
      const subsequentNotes='Later local edit retained while the original save response was lost.';
      const lostDone=await readOptional(join(root,'steps','lost-save-recovery.json'));
      let secondSaved;
      if(!lostDone){
        const retained=await readOptional(join(root,'browser-records','lost-save-request.json'));
        if(!retained){
          await page.locator('#editions > *').filter({hasText:'version 1'}).getByRole('button',{name:'Open',exact:true}).click();
          await page.waitForFunction(()=>document.querySelector('#expectedVersion').value==='1');
        }
        const lost=await uiAction('lost-save','save-edition','#saveEdition',{
          before:async()=>{await page.locator('#editionNotes').fill(submittedNotes);},
          dropResponse:true,afterCommit:async()=>{
            await page.locator('#editionNotes').fill(subsequentNotes);
            await savedBrowserState(page,join(root,'browser-records','later-edit-storage.json'));
          }
        });
        await page.locator('#refresh').click();
        await page.waitForFunction(({version,notes})=>document.querySelector('#expectedVersion').value===String(version)&&
          document.querySelector('#editionNotes').value===notes,{version:lost.result.version,notes:subsequentNotes},{timeout:30000});
        need(lost.result.version===2,'PMTILES_ORIGINAL_BROWSER_SAVE_VERSION_CHANGED');
        const current=await page.locator('#editionNotes').inputValue();
        secondSaved=await uiAction('subsequent-save','save-edition','#saveEdition');
        need(secondSaved.result.notes===current&&secondSaved.result.version===3,'PMTILES_LATER_BROWSER_EDIT_LOST');
        await step('lost-save-recovery',async()=>({lost,subsequent:secondSaved,laterNotes:current,
          originalRequest:server.controller.workspace.getRequest(lost.input.requestId)}));
      }else secondSaved=lostDone.result.subsequent;
      const next=secondSaved.result;
      const finalInspection=await server.controller.execute('inspect',{...common,requestId:'original-second-inspection',editionId:next.id,version:next.version},{signal});
      const finalReview=await server.controller.execute('review',{...common,requestId:'original-second-review',editionId:next.id,version:next.version,
        inspectionRequestId:'original-second-inspection',expectedCurrentRelease:firstRelease.id,reviewer:input.reviewer,
        note:'The recovered immutable browser version and later retained local edit are the selected second release.'},{signal});
      const secondRelease=await server.controller.execute('prepare-release',{...common,requestId:'original-second-release',
        reviewId:finalReview.id,reviewSha256:finalReview.reviewSha256},{signal});
      const published=await server.controller.execute('publish',{...common,requestId:'original-second-publication',releaseId:secondRelease.id,
        manifestSha256:secondRelease.manifestSha256,expectedCurrentRelease:firstRelease.id},{signal});
      need(!published.previewError,'PMTILES_SECOND_NATIVE_PREVIEW_FAILED',published.previewError?.message);
      await openNativeMap(page,server,secondRelease.id);
      await step('second-native-publication',async()=>({edition:next,inspection:finalInspection,review:finalReview,release:secondRelease,publication:published}));
      const unfinished='Customer draft retained across the original authoring Stop and Start.';
      const originalOrigin=server.origin;
      await page.locator('#editionNotes').fill(unfinished);
      await savedBrowserState(page,join(root,'browser-records','pre-restart-storage.json'));
      await server.close();server=null;
      server=await servePMTilesWorkspace({directory:originalDirectory,expectedWorkspaceId:workspaceId,runtime:runtimeResult.profilePath,port:0});
      need(server.origin===originalOrigin,'PMTILES_AUTHORING_ORIGIN_CHANGED');
      await page.goto(server.url,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForFunction(notes=>document.querySelector('#editionNotes')?.value===notes,unfinished,{timeout:30000});
      need(await page.locator('#expectedVersion').inputValue()==='3','PMTILES_RESTART_DRAFT_VERSION_CHANGED');
      await openNativeMap(page,server,secondRelease.id);
      await step('same-tab-restart',async()=>({origin:originalOrigin,workspaceId,
        draft:await page.locator('#editionNotes').inputValue(),version:await page.locator('#expectedVersion').inputValue(),
        storage:await savedBrowserState(page,join(root,'browser-records','post-restart-storage.json'))}));
      const vectorSource=await readJson(join(HERE,'sources','sample-vector.json'),MAX_METADATA_BYTES);
      need(vectorSource.schema==='starforge.pmtiles-vector-source.v1'&&
        vectorSource.sourceCommit==='aec8fa1341222fdddb3318e9ffa8e18e19b312f7'&&
        vectorSource.blob==='bd5f906fb433787604abbae0ad405f3197b97b49'&&vectorSource.bytes===6601156,
        'PMTILES_ORIGINAL_VECTOR_SOURCE_CHANGED');
      const vectorWorkspace=server.controller.workspace;
      const vectorArchive=await vectorWorkspace.acquire({...common,requestId:'original-florence-acquisition',
        kind:'pmtiles',name:'protomaps-vector-firenze.pmtiles',url:vectorSource.url,maxBytes:vectorSource.bytes,
        rights:{license:vectorSource.license.spdx,attribution:vectorSource.license.attribution,sourceUrl:vectorSource.sourceUrl}},{signal});
      need(vectorArchive.bytes===vectorSource.bytes,'PMTILES_ORIGINAL_VECTOR_LENGTH_CHANGED');
      const gitHash=createHash('sha1').update(Buffer.from('blob '+vectorArchive.bytes+'\0'));
      let vectorBytes=0;
      for await(const chunk of vectorWorkspace.resourceFile(vectorArchive.id).chunks({signal})){
        vectorBytes+=chunk.length;gitHash.update(chunk);
      }
      const observedBlob=gitHash.digest('hex');
      need(vectorBytes===vectorSource.bytes&&observedBlob===vectorSource.blob,'PMTILES_ORIGINAL_VECTOR_BLOB_CHANGED');
      const vectorStylePath=join(HERE,'sources','sample-vector-style.json');
      const vectorStyleBytes=await fileDescriptor(vectorStylePath,{signal});
      const vectorStyle=await vectorWorkspace.importLocal({...common,requestId:'original-florence-style',
        kind:'style',name:'sample-vector-style.json',path:vectorStylePath,expected:vectorStyleBytes,
        rights:{license:vectorSource.style.spdx,attribution:'2021 and later, Protomaps LLC and contributors',
          sourceUrl:'https://github.com/protomaps/PMTiles/blob/'+vectorSource.sourceCommit+'/'+vectorSource.example.path}},{signal});
      const vectorEdition=await vectorWorkspace.saveEdition({...common,requestId:'original-vector-replacement-edition',
        editionId:next.id,expectedVersion:next.version,edition:{name:'Original Florence vector replacement',
          notes:'Complete source and style replacement using the retained official Florence MVT archive and original four-layer example.',
          style:vectorStyle.id,archives:[{sourceId:'example_source',resourceId:vectorArchive.id,type:'vector'}],
          sprite:null,glyphs:[],layerDecisions:[],view:{center:vectorSource.style.center,zoom:vectorSource.style.zoom}}});
      need(vectorEdition.version===4,'PMTILES_ORIGINAL_VECTOR_EDITION_CHANGED');
      const comparison=vectorWorkspace.compare({leftId:next.id,leftVersion:next.version,rightId:vectorEdition.id,rightVersion:vectorEdition.version});
      const vectorInspection=await server.controller.execute('inspect',{...common,requestId:'original-vector-inspection',
        editionId:vectorEdition.id,version:vectorEdition.version},{signal});
      const vectorReview=await server.controller.execute('review',{...common,requestId:'original-vector-review',
        editionId:vectorEdition.id,version:vectorEdition.version,inspectionRequestId:'original-vector-inspection',
        expectedCurrentRelease:secondRelease.id,reviewer:input.reviewer,
        note:'The complete original Florence MVT source, matching four-layer style, actual source-layer metadata and baseline replacement were reviewed.'},{signal});
      const vectorRelease=await server.controller.execute('prepare-release',{...common,requestId:'original-vector-release',
        reviewId:vectorReview.id,reviewSha256:vectorReview.reviewSha256},{signal});
      const vectorPublication=await server.controller.execute('publish',{...common,requestId:'original-vector-publication',
        releaseId:vectorRelease.id,manifestSha256:vectorRelease.manifestSha256,expectedCurrentRelease:secondRelease.id},{signal});
      need(!vectorPublication.previewError,'PMTILES_VECTOR_NATIVE_PREVIEW_FAILED',vectorPublication.previewError?.message);
      await openNativeMap(page,server,vectorRelease.id,vectorSource.license.attribution);
      await page.screenshot({path:join(root,'original-florence-vector-map.png'),fullPage:true});
      await step('original-vector-source-replacement',async()=>({source:vectorSource,archive:vectorArchive,gitBlobSha1:observedBlob,
        style:vectorStyle,edition:vectorEdition,comparison,inspection:vectorInspection,review:vectorReview,release:vectorRelease,
        publication:vectorPublication,screenshot:await fileDescriptor(join(root,'original-florence-vector-map.png'),{signal})}));
      const packageResult=await uiAction('complete-package','package','#packageWorkspace',{
        before:async()=>{await page.locator('#packageDirectory').fill(join(root,'package-stage'));await page.locator('#packageDestination').fill(join(root,'regional-map-release.zip'));}
      });
      need(packageResult.result.workspaceId===workspaceId&&packageResult.result.workspace.currentRelease===vectorRelease.id,'PMTILES_PACKAGE_WORKSPACE_CHANGED');
      const downloadPath=join(root,'downloaded-regional-map-release.zip');
      if(!await exists(downloadPath)){
        const awaited=page.waitForEvent('download',{timeout:600000});await page.locator('#downloadPackage').click();
        const download=await awaited;await download.saveAs(downloadPath);need(!await download.failure(),'PMTILES_BROWSER_PACKAGE_DOWNLOAD_FAILED');
      }
      const downloaded=await fileDescriptor(downloadPath,{limit:34359738368,signal});
      need(downloaded.sha256===packageResult.result.archive.sha256&&downloaded.bytes===packageResult.result.archive.bytes,'PMTILES_BROWSER_PACKAGE_CHANGED');
      await step('complete-browser-package',async()=>({result:packageResult.result,download:{path:downloadPath,...downloaded}}));
      await page.screenshot({path:join(root,'complete-original-operator.png'),fullPage:true});
      await context.close();context=null;await server.close();server=null;
      const receiveInput={requestId:'original-cold-customer-receiving',archive:packageResult.result.archive.path,
        directory:join(root,'received-product'),workspaceDirectory:join(root,'received-workspace'),
        pythonExecutable:runtime.pythonExecutable.path,expectedArchiveSha256:packageResult.result.archive.sha256,expectedWorkspaceId:workspaceId};
      const receiveInputPath=join(root,'receiving-input.json');await retainJson(receiveInputPath,receiveInput);
      const received=await nativeResult(root,'original-complete-package-receiving',
        [process.execPath,join(HERE,'cli.mjs'),'receive-package','--input',receiveInputPath],{signal,leaseFd});
      need(received.value.status==='COMPLETE'&&received.value.workspaceId===workspaceId&&received.value.currentRelease===vectorRelease.id,
        'PMTILES_COLD_RECEIVING_INCOMPLETE');
      await step('cold-complete-native-receiving',async()=>received);
      server=await servePMTilesWorkspace({directory:receiveInput.workspaceDirectory,expectedWorkspaceId:workspaceId,runtime:received.value.runtimeProfile,port:0});
      ({context,page}=await browserAt(server,join(root,'browser-customer')));
      await openNativeMap(page,server,vectorRelease.id,vectorSource.license.attribution);
      const restoredVector=await uiAction('customer-restore-vector','restore','#restore');
      const previousId=restoredVector.result.restoration?.restoredReleaseId??restoredVector.result.restoredReleaseId;
      need(previousId===secondRelease.id&&server.controller.state().currentRelease===secondRelease.id,'PMTILES_COLD_VECTOR_RESTORE_CHAIN_CHANGED');
      await openNativeMap(page,server,secondRelease.id);
      const restored=await uiAction('customer-restore','restore','#restore');
      const restoredId=restored.result.restoration?.restoredReleaseId??restored.result.restoredReleaseId;
      need(restoredId===firstRelease.id&&server.controller.state().currentRelease===firstRelease.id,'PMTILES_COLD_RESTORE_CHAIN_CHANGED');
      await openNativeMap(page,server,firstRelease.id);
      const coldState=server.controller.state();
      await page.screenshot({path:join(root,'cold-customer-restored-map.png'),fullPage:true});
      await step('cold-customer-restoration',async()=>({receiving:received.value,restoredVector,restored,state:coldState,
        screenshot:await fileDescriptor(join(root,'cold-customer-restored-map.png'),{signal})}));
      await context.close();context=null;await server.close();server=null;
      const cliState=await nativeResult(root,'original-cold-cli-state',[process.execPath,join(HERE,'cli.mjs'),'state',
        '--workspace',receiveInput.workspaceDirectory,'--workspace-id',workspaceId],{signal,leaseFd});
      need(cliState.value.currentRelease===firstRelease.id&&cliState.value.receivedFrom?.handoverSha256===packageResult.result.workspace.sha256,
        'PMTILES_COLD_CLI_STATE_CHANGED');
      need(browserErrors.length===0,'PMTILES_BROWSER_PAGE_ERROR',JSON.stringify(browserErrors));
      need(nativeTileResponses.some(row=>row.status===200),'PMTILES_BROWSER_NATIVE_TILE_NOT_OBSERVED');
      const result={schema:'starforge.pmtiles-native-receiving-result.v1',status:'PMTILES_RECEIVING_COMPLETE',operationId:input.operationId,
        requestSha256,workspaceId,sourceSelection,runtimeSha256:runtime.runtimeSha256,browserIdentity,
        firstReleaseId:firstRelease.id,secondReleaseId:secondRelease.id,vectorReleaseId:vectorRelease.id,
        vectorSource:{...vectorSource,sha256:vectorArchive.sha256,resourceId:vectorArchive.id,gitBlobSha1:observedBlob},restoredReleaseId:firstRelease.id,
        package:packageResult.result,receiving:received.value,cliState:cliState.value,
        browserErrors,nativeTileResponses,completedAt:timestamp()};
      await retainJson(join(root,'native-result.json'),result);return result;
    }finally{
      if(context)await context.close().catch(()=>{});
      if(server)await server.close().catch(()=>{});
      if(workspace)await workspace.close().catch(()=>{});
    }
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const abort=new AbortController(),stop=()=>abort.abort(new Error('PMTILES_NATIVE_RECEIVING_STOPPED'));
  process.once('SIGTERM',stop);process.once('SIGINT',stop);
  try{
    need(process.argv.length===3&&isAbsolute(process.argv[2]),'PMTILES_NATIVE_RECEIVING_INPUT_PATH_REQUIRED');
    const result=await receiveOriginalPMTilesProduct(await readJson(process.argv[2],MAX_METADATA_BYTES),{signal:abort.signal});
    process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }catch(error){
    process.stderr.write(JSON.stringify({status:'PMTILES_RECEIVING_INTERRUPTED',error:{code:error.code??'NATIVE_RECEIVING_FAILED',message:String(error.message??error)},at:timestamp()})+'\n');
    process.exitCode=1;
  }finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);}
}
