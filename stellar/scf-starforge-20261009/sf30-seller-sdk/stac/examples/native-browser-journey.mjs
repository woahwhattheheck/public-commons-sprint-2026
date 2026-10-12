#!/usr/bin/env node
import {mkdir,readFile,writeFile,rename,stat,mkdtemp,rm} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {openStacWorkspace} from '../workspace.mjs';
import {startStacServer} from '../server.mjs';
import {stacItemKey,canonicalJson} from '../provider.mjs';

const require=createRequire(import.meta.url);
const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonicalJson(value)).digest('hex');
const now=()=>new Date().toISOString();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const exists=async path=>stat(path).then(()=>true,()=>false);
const allowedImage=mime=>['image/png','image/jpeg','image/webp','image/gif'].includes(String(mime||'').split(';')[0].toLowerCase());
async function atomicJSON(path,value){
  const temporary=path+'.'+randomUUID()+'.partial';
  await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});
  await rename(temporary,path);
}
async function fileDigest(path){
  const hash=createHash('sha256');let bytes=0;
  for await(const chunk of createReadStream(path)){hash.update(chunk);bytes+=chunk.length;}
  return {bytes,sha256:hash.digest('hex')};
}
async function until(check,message,timeout=30_000){
  const end=Date.now()+timeout;
  while(Date.now()<end){if(await check())return;await new Promise(resolve=>setTimeout(resolve,120));}
  throw new Error(message);
}
function safeError(value){
  return String(value?.message||value||'Operation failed').replace(/https?:\/\/[^\s"'<>]+/g,raw=>{
    try{const u=new URL(raw);return u.origin+u.pathname;}catch{return '[URL]';}
  }).slice(0,3000);
}
async function freshProcessState(directory){
  const moduleURL=new URL('../workspace.mjs',import.meta.url).href;
  const program="import {openStacWorkspace} from "+JSON.stringify(moduleURL)+";import {createHash} from 'node:crypto';"+
    "const w=await openStacWorkspace({directory:"+JSON.stringify(directory)+",create:false});"+
    "try{const s=await w.getState();const assets=[];for(const a of s.assets.filter(x=>x.status==='COMPLETE')){const f=await w.getAssetFile(a.id);assets.push({id:a.id,bytes:f.metadata.bytes,sha256:f.metadata.sha256});}"+
    "process.stdout.write(JSON.stringify({id:s.id,revision:s.revision,editionIds:s.editions.map(e=>e.id).sort(),decisionDigest:createHash('sha256').update(JSON.stringify(s.decisions)).digest('hex'),assets}));}finally{await w.close();}";
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['ignore','pipe','pipe']});
    let output='',error='';
    child.stdout.on('data',chunk=>{output+=chunk;if(output.length>4*1024*1024)child.kill('SIGTERM');});
    child.stderr.on('data',chunk=>{error+=chunk;});
    child.once('error',reject);
    child.once('exit',code=>{if(code!==0)return reject(new Error('Fresh receiving process failed: '+safeError(error)));try{resolve(JSON.parse(output));}catch(e){reject(e);}});
  });
}

/**
 * Inspect one already captured STAC workspace through its real browser.
 * This function performs no provider acquisition. Source writes are one
 * retained request review and a new staff review on an unreviewed scene.
 * Original decisions are preserved. Receiving uses the actual browser export.
 * Screenshots stay in outputDirectory for internal inspection.
 *
 * A caller may pass its existing workspace object to keep one native operation.
 * playwrightModule/chromiumPath select the installed host browser; no download
 * or browser installation is performed.
 */
export async function runStacBrowserJourney({
  workspace:providedWorkspace,directory,outputDirectory,sourceCommit,
  actor='B710 analyst',selectionStatus='REVIEW',
  selectionNote='Retain this scene for comparison and delivery review with its original collection and asset references.',
  playwrightModule=process.env.STAC_PLAYWRIGHT_MODULE,
  chromiumPath=process.env.STAC_CHROMIUM_PATH,
  browserEnvironment={},browserArgs=[],profileParent=tmpdir(),
  allowSingleProcess=process.env.STAC_CHROMIUM_SINGLE_PROCESS==='1'
}={}){
  assert(providedWorkspace||directory,'Provide the existing captured workspace or its directory.');
  assert(outputDirectory,'Provide a separate output directory for the browser handover.');
  assert(['SELECTED','REJECTED','REVIEW'].includes(selectionStatus),'Choose a native staff selection status.');
  assert(typeof actor==='string'&&actor.trim(),'Provide the actual assigned reviewer.');
  outputDirectory=resolve(outputDirectory);
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  const resultPath=join(outputDirectory,'browser-journey-result.json');
  const intentPath=join(outputDirectory,'browser-journey-intent.json');
  const journalPath=join(outputDirectory,'browser-journey-progress.json');
  const ownWorkspace=!providedWorkspace;
  const workspace=providedWorkspace||await openStacWorkspace({directory:resolve(directory),create:false});
  const original=await workspace.getState();
  const sourceDirectory=workspace.directory||resolve(directory);
  assert(!outputDirectory.startsWith(sourceDirectory+'/')&&outputDirectory!==sourceDirectory,'Use an output directory outside the original workspace.');
  if(await exists(resultPath)){
    const completed=JSON.parse(await readFile(resultPath,'utf8'));
    if(completed.status==='COMPLETE'&&completed.sourceWorkspaceId===original.id){if(ownWorkspace)await workspace.close();return completed;}
  }
  const completeEditions=original.editions.filter(e=>e.itemsCount>0&&!['RUNNING','PREPARED'].includes(e.status));
  assert(completeEditions.length>=2,'Retain the two actual scene editions before this browser journey.');
  const imageAssets=original.assets.filter(a=>a.status==='COMPLETE'&&allowedImage(a.mime)&&a.bytes>0&&a.bytes<=32*1024*1024);
  assert(imageAssets.length,'Retain one actual acquired public thumbnail before this browser journey.');
  let intent;
  if(await exists(intentPath)){
    intent=JSON.parse(await readFile(intentPath,'utf8'));
    assert(intent.sourceWorkspaceId===original.id,'The browser journal belongs to a different source workspace.');
  }else{
    const asset=imageAssets[0],edition=completeEditions.find(e=>e.id===asset.editionId);
    assert(edition,'The saved thumbnail must belong to one retained scene edition.');
    const other=completeEditions.find(e=>e.id!==edition.id);
    intent={schema:'scf-stac-browser-intent/v1',sourceWorkspaceId:original.id,sourceCommit:sourceCommit||null,
      editionId:edition.id,comparisonEditionId:other.id,assetId:asset.id,itemId:asset.itemId,startedAt:now()};
    await writeFile(intentPath,JSON.stringify(intent,null,2)+'\n',{flag:'wx',mode:0o600});
  }
  const retainedAsset=original.assets.find(a=>a.id===intent.assetId);
  assert(retainedAsset?.status==='COMPLETE','The original browser thumbnail is no longer available.');
  const detail=await workspace.getEdition(intent.editionId);
  const nativeItem=detail.items.find(item=>stacItemKey(item)===intent.itemId);
  assert(nativeItem,'The captured thumbnail must retain its original composite scene identity.');
  const selectedQuery=original.queries.find(q=>q.id===detail.edition.queryId);
  assert(selectedQuery,'The original edition needs its saved query.');
  const protectedDecisions=new Map(original.decisions.map(d=>[d.id,canonicalJson(d)]));
  const logs={pageErrors:[],consoleErrors:[],failedRequests:[],httpErrors:[],blockedProviderActions:[],externalRequests:[]};
  const report={schema:'scf-stac-browser-journey/v1',status:'RUNNING',startedAt:now(),sourceCommit:sourceCommit||null,
    sourceWorkspaceId:original.id,sourceRevision:original.revision,sourceEditionIds:completeEditions.map(e=>e.id),
    originalDecisions:original.decisions.length,catalogCollections:original.collections.length,
    browserProviderCalls:0,steps:[]};
  let context,sourceServer,receivingServer,receivingWorkspace,profile;
  const allowedOrigins=new Set();
  const stage=async(name,result={})=>{report.steps.push({name,completedAt:now(),...result});await atomicJSON(journalPath,{...report,currentStep:name});};
  function attachPage(page,label){
    page.on('pageerror',error=>logs.pageErrors.push({page:label,message:safeError(error)}));
    page.on('console',message=>{if(message.type()==='error')logs.consoleErrors.push({page:label,message:safeError(message.text())});});
    page.on('requestfailed',request=>logs.failedRequests.push({page:label,path:new URL(request.url()).pathname,message:safeError(request.failure()?.errorText)}));
    page.on('response',response=>{if(response.status()>=400)logs.httpErrors.push({page:label,path:new URL(response.url()).pathname,status:response.status()});});
  }
  const metrics=page=>page.evaluate(()=>({viewport:innerWidth,document:document.documentElement.scrollWidth,
    overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),footprints:document.querySelectorAll('svg.footprint').length,
    imageCount:document.querySelectorAll('img.asset-preview').length}));
  async function openApp(page,running){
    await page.goto(running.url,{waitUntil:'domcontentloaded',timeout:30_000});
    await page.getByRole('heading',{name:'Earth Search operations',exact:true}).waitFor();
    await page.locator('.workspace-bar').waitFor();
    assert(!(await page.url()).includes('#session='),'The private browser session fragment should be removed after bootstrap.');
  }
  async function showEdition(page,workspaceState,editionId){
    const edition=workspaceState.editions.find(e=>e.id===editionId);
    const index=workspaceState.queries.findIndex(q=>q.id===edition.queryId);
    assert(index>=0,'The scene edition must have its saved query.');
    await page.locator('.query-card').nth(index).click();
    await page.getByRole('tab',{name:'Scenes & assets',exact:true}).click();
    await page.locator('#active-edition').waitFor();
    await page.locator('#active-edition').selectOption(editionId);
    await page.waitForFunction(id=>document.getElementById('active-edition')?.value===id,editionId);
    await until(async()=>await page.locator('.panel').filter({has:page.getByRole('heading',{name:'Saved acquisition',exact:true})}).innerText().then(text=>text.includes(editionId),()=>false),'The original saved edition did not finish rendering.');
  }
  async function showScene(page,item){
    await page.locator('#scene-status-filter').selectOption('all');
    await page.locator('#scene-filter').fill(item.id);
    await page.getByRole('button',{name:'Table',exact:true}).click();
    const row=page.locator('tbody tr').filter({has:page.getByText(item.id,{exact:true})}).filter({has:page.getByText(item.collection,{exact:true})}).first();
    await row.getByRole('button',{name:'Details',exact:true}).click();
    await page.getByRole('dialog').waitFor();
  }
  async function download(page,action,name){
    const waiting=page.waitForEvent('download',{timeout:30_000});
    await action();
    const saved=await waiting,path=join(outputDirectory,name);
    await saved.saveAs(path);
    const failure=await saved.failure();assert(!failure,'Browser download failed: '+failure);
    return {path,...await fileDigest(path)};
  }
  try{
    sourceServer=await startStacServer({workspace});allowedOrigins.add(sourceServer.origin);
    const playwright=playwrightModule?require(playwrightModule):require('playwright');
    profile=await mkdtemp(join(resolve(profileParent),'stac-browser-'));
    const args=['--no-sandbox','--disable-gpu','--disable-dev-shm-usage',...(allowSingleProcess?['--no-zygote','--single-process']:[]),...browserArgs];
    context=await playwright.chromium.launchPersistentContext(profile,{headless:true,viewport:{width:1365,height:1000},
      acceptDownloads:true,...(chromiumPath?{executablePath:chromiumPath}:{}),args,env:{...process.env,...browserEnvironment}});
    context.setDefaultTimeout(20_000);
    await context.route('**/*',async route=>{
      const request=route.request(),u=new URL(request.url());
      if(!['http:','https:'].includes(u.protocol)){await route.continue();return;}
      if(!allowedOrigins.has(u.origin)){logs.externalRequests.push({origin:u.origin,path:u.pathname});await route.abort('blockedbyclient');return;}
      if(request.method()==='POST'&&['/api/discover','/api/search/acquire','/api/search/resume','/api/assets/acquire'].includes(u.pathname)){
        logs.blockedProviderActions.push({path:u.pathname});await route.abort('blockedbyclient');return;
      }
      await route.continue();
    });
    const page=context.pages()[0]||await context.newPage();attachPage(page,'source');
    await openApp(page,sourceServer);
    const queryIndex=original.queries.findIndex(q=>q.id===selectedQuery.id);
    await page.locator('.query-card').nth(queryIndex).click();
    await page.getByRole('tab',{name:'Catalog & query',exact:true}).click();
    await until(async()=>await page.locator('#query-name').inputValue()===selectedQuery.name,'The retained query form did not load.');
    assert(await page.locator('#query-datetime').inputValue()===selectedQuery.datetime,'The native query time changed in the browser.');
    if(selectedQuery.bbox){
      const bbox=[];for(let i=0;i<4;i++)bbox.push(Number(await page.locator('#query-bbox-'+i).inputValue()));
      assert(canonicalJson(bbox)===canonicalJson(selectedQuery.bbox),'The area-of-interest coordinate order changed.');
    }
    assert(await page.locator('.collection-card').count()===original.collections.length,'The saved collection rights are incomplete in the browser.');
    await page.getByRole('button',{name:'Review search request',exact:true}).click();
    const displayedRequest=JSON.parse(await page.locator('dialog pre').innerText());
    const latestReview=(await workspace.getState()).reviews.at(-1);
    assert(canonicalJson(displayedRequest)===canonicalJson(latestReview.request),'The browser must display the exact retained search request.');
    await page.getByRole('button',{name:'Back',exact:true}).click();
    await stage('catalog-query-and-request-review',{collections:original.collections.length,requestSha256:digest(displayedRequest),
      bbox:selectedQuery.bbox||null,datetime:selectedQuery.datetime,cloudCoverMax:selectedQuery.cloudCoverMax??null});
    await showEdition(page,await workspace.getState(),intent.editionId);
    await page.getByRole('button',{name:'Footprint grid',exact:true}).click();
    await page.locator('.scene-card').first().waitFor();
    const desktopGrid=await metrics(page);assert(desktopGrid.footprints>0,'The native scene footprint grid did not render.');
    await page.screenshot({path:join(outputDirectory,'source-scenes-desktop.png'),fullPage:true});
    await showScene(page,nativeItem);
    const link=page.locator('dialog a[href="/api/assets/'+encodeURIComponent(retainedAsset.id)+'/download"]');
    const assetCard=link.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," asset-info ")][1]');
    await assetCard.getByRole('button',{name:'Preview saved image',exact:true}).click();
    const image=assetCard.locator('img.asset-preview');
    await image.waitFor();await image.evaluate(img=>img.decode());
    const imageResult=await image.evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,complete:img.complete}));
    assert(imageResult.width>0&&imageResult.height>0&&imageResult.complete,'The original thumbnail bytes did not render as a native image.');
    const acquired=await download(page,()=>link.click(),'captured-thumbnail.bin');
    assert(acquired.sha256===retainedAsset.sha256&&acquired.bytes===retainedAsset.bytes,'The actual browser download changed the captured asset bytes.');
    await page.screenshot({path:join(outputDirectory,'source-asset-desktop.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    const mobileAsset=await metrics(page);
    await page.screenshot({path:join(outputDirectory,'source-asset-mobile.png'),fullPage:true});
    await page.getByRole('button',{name:'Close dialog',exact:true}).click();
    await page.getByRole('button',{name:'Footprint grid',exact:true}).click();
    const mobileGrid=await metrics(page);
    await page.screenshot({path:join(outputDirectory,'source-scenes-mobile.png'),fullPage:true});
    assert([desktopGrid,mobileAsset,mobileGrid].every(value=>value.overflow===0),'The scene/asset interface overflows the viewport.');
    await page.setViewportSize({width:1365,height:1000});
    await stage('native-scene-and-asset-review',{desktopGrid,mobileAsset,mobileGrid,image:imageResult,asset:{bytes:acquired.bytes,sha256:acquired.sha256}});
    let candidate,decisionEdition;
    for(const saved of completeEditions){
      const d=await workspace.getEdition(saved.id),reviewed=new Set(d.decisions.map(value=>value.itemId));
      const item=d.items.find(value=>!reviewed.has(stacItemKey(value)));
      if(item){candidate=item;decisionEdition=saved.id;break;}
    }
    if(candidate){
      await showEdition(page,await workspace.getState(),decisionEdition);
      await showScene(page,candidate);
      await page.getByRole('dialog').getByRole('button',{name:'Record selection',exact:true}).click();
      await page.locator('#decision-actor').fill(actor);
      await page.locator('#decision-status').selectOption(selectionStatus);
      await page.locator('#decision-note').fill(selectionNote);
      const ready=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/decisions'&&response.request().method()==='POST');
      await page.getByRole('button',{name:'Save selection',exact:true}).click();
      const response=await ready;assert(response.ok(),'The original staff-selection write failed.');
      await page.locator('dialog').waitFor({state:'detached'});
      const written=(await workspace.getState()).decisions.find(d=>d.editionId===decisionEdition&&d.itemId===stacItemKey(candidate));
      assert(written?.status===selectionStatus,'The saved staff review must retain its selected scene identity.');
      await stage('staff-selection',{mode:'new-unreviewed-scene',editionId:decisionEdition,itemId:stacItemKey(candidate),status:written.status});
    }else await stage('staff-selection',{mode:'all-retained-scenes-already-reviewed',count:(await workspace.getState()).decisions.length});
    await page.getByRole('tab',{name:'Compare editions',exact:true}).click();
    await page.locator('#compare-left').selectOption(intent.editionId);
    await page.locator('#compare-right').selectOption(intent.comparisonEditionId);
    await page.getByRole('button',{name:'Compare saved editions',exact:true}).click();
    await page.getByText('Complete comparison',{exact:true}).waitFor();
    const comparison=await workspace.compare({leftEditionId:intent.editionId,rightEditionId:intent.comparisonEditionId});
    await stage('retained-scene-comparison',{comparableQuery:comparison.comparableQuery,
      added:comparison.added.length,removed:comparison.removed.length,changed:comparison.changed.length,unchanged:comparison.unchanged.length});
    await showEdition(page,await workspace.getState(),intent.editionId);
    await page.getByRole('tab',{name:'Selections & handover',exact:true}).click();
    const exports={};
    for(const format of ['html','csv','json'])exports[format]=await download(page,()=>page.getByRole('button',{name:'Download '+format.toUpperCase(),exact:true}).click(),'operations.'+format);
    const jsonReport=JSON.parse(await readFile(exports.json.path,'utf8'));
    assert(jsonReport.edition.id===intent.editionId,'The report switched source editions.');
    const handover=await download(page,()=>page.getByRole('button',{name:'Export handover',exact:true}).click(),'complete-workspace-handover.json');
    const bundle=JSON.parse(await readFile(handover.path,'utf8'));
    assert(bundle.sourceWorkspaceId===original.id&&bundle.editions.length===original.editions.length,'The complete browser handover lost source editions.');
    assert(bundle.assets.some(a=>a.id===retainedAsset.id&&a.sha256===retainedAsset.sha256),'The handover lost the actual captured thumbnail.');
    const after=await workspace.getState();
    for(const [id,originalDecision]of protectedDecisions)assert(canonicalJson(after.decisions.find(d=>d.id===id))===originalDecision,'An earlier staff decision changed during the browser journey.');
    await stage('native-reports-and-complete-handover',{reportFormats:Object.keys(exports),handoverBytes:handover.bytes,handoverSha256:handover.sha256,
      files:bundle.files.length,editions:bundle.editions.length,assets:bundle.assets.length,decisions:bundle.decisions.length,preservedOriginalDecisions:protectedDecisions.size});
    const receiverDirectory=join(outputDirectory,'receiving-workspace');
    receivingWorkspace=await openStacWorkspace({directory:receiverDirectory,title:'Receiving satellite imagery workspace',create:true});
    const receivingIdentity=(await receivingWorkspace.getState()).id;
    assert(receivingIdentity!==original.id,'The receiver must retain an independent workspace identity.');
    receivingServer=await startStacServer({workspace:receivingWorkspace});allowedOrigins.add(receivingServer.origin);
    const receivingPage=await context.newPage();attachPage(receivingPage,'receiving');
    await openApp(receivingPage,receivingServer);
    await receivingPage.getByRole('button',{name:'Import handover',exact:true}).click();
    await receivingPage.locator('#handover-file').setInputFiles(handover.path);
    const imported=receivingPage.waitForResponse(response=>new URL(response.url()).pathname==='/api/handover/import'&&response.request().method()==='POST');
    await receivingPage.getByRole('button',{name:'Import complete handover',exact:true}).click();
    assert((await imported).ok(),'The native receiving import failed.');
    await receivingPage.locator('dialog').waitFor({state:'detached'});
    const receivingState=await receivingWorkspace.getState();
    assert(receivingState.id===receivingIdentity,'Import replaced the receiving workspace identity.');
    assert(canonicalJson(receivingState.editions.map(e=>e.id).sort())===canonicalJson(bundle.editions.map(e=>e.id).sort()),'Receiving lost an original source edition.');
    assert(canonicalJson(receivingState.decisions)===canonicalJson(bundle.decisions),'Receiving changed a retained staff review.');
    await showEdition(receivingPage,receivingState,intent.editionId);
    await showScene(receivingPage,nativeItem);
    const receivingLink=receivingPage.locator('dialog a[href="/api/assets/'+encodeURIComponent(retainedAsset.id)+'/download"]');
    const receivingCard=receivingLink.locator('xpath=ancestor::*[contains(concat(" ",normalize-space(@class)," ")," asset-info ")][1]');
    await receivingCard.getByRole('button',{name:'Preview saved image',exact:true}).click();
    await receivingCard.locator('img.asset-preview').evaluate(img=>img.decode());
    const receivedImage=await receivingCard.locator('img.asset-preview').evaluate(img=>({width:img.naturalWidth,height:img.naturalHeight,complete:img.complete}));
    assert(receivedImage.width===imageResult.width&&receivedImage.height===imageResult.height,'Receiving changed the original image.');
    await receivingPage.getByRole('button',{name:'Close dialog',exact:true}).click();
    await receivingPage.getByRole('tab',{name:'Selections & handover',exact:true}).click();
    await receivingPage.setViewportSize({width:390,height:844});
    const receivingMobile=await metrics(receivingPage);assert(receivingMobile.overflow===0,'The receiving view overflows its mobile viewport.');
    await receivingPage.screenshot({path:join(outputDirectory,'receiving-selections-mobile.png'),fullPage:true});
    await stage('browser-receiving-import',{workspaceId:receivingIdentity,editionIdentitiesPreserved:true,decisions:receivingState.decisions.length,
      assets:receivingState.assets.length,image:receivedImage,mobile:receivingMobile});
    await context.close();context=null;
    await receivingServer.close();receivingServer=null;
    await receivingWorkspace.close();receivingWorkspace=null;
    await sourceServer.close();sourceServer=null;
    const reopened=await freshProcessState(receiverDirectory);
    assert(reopened.id===receivingIdentity,'Reopening changed the receiving identity.');
    assert(reopened.decisionDigest===createHash('sha256').update(JSON.stringify(bundle.decisions)).digest('hex'),'A fresh process did not retain the imported staff decisions.');
    assert(reopened.assets.some(a=>a.id===retainedAsset.id&&a.sha256===retainedAsset.sha256&&a.bytes===retainedAsset.bytes),'A fresh process did not retain the captured asset.');
    await stage('fresh-process-reopen',{revision:reopened.revision,editions:reopened.editionIds.length,assets:reopened.assets.length,decisionsRetained:true});
    report.errors=logs;
    assert(Object.values(logs).every(values=>values.length===0),'The browser journey recorded an error or an unexpected provider action.');
    report.status='COMPLETE';report.completedAt=now();report.finalSourceRevision=(await workspace.getState()).revision;
    report.outputs={handover:handover.path,reports:Object.fromEntries(Object.entries(exports).map(([format,value])=>[format,value.path])),
      receivingWorkspace:receiverDirectory,thumbnail:acquired.path,internalViews:[
        'source-scenes-desktop.png','source-asset-desktop.png','source-asset-mobile.png','source-scenes-mobile.png','receiving-selections-mobile.png'
      ].map(name=>join(outputDirectory,name))};
    report.resultPath=resultPath;
    await atomicJSON(resultPath,report);return report;
  }catch(error){
    report.status='FAILED';report.failedAt=now();report.error=safeError(error);report.errors=logs;
    await atomicJSON(resultPath,report).catch(()=>{});
    throw Object.assign(new Error(report.error),{resultPath});
  }finally{
    await context?.close().catch(()=>{});
    await receivingServer?.close().catch(()=>{});
    await receivingWorkspace?.close().catch(()=>{});
    await sourceServer?.close().catch(()=>{});
    if(ownWorkspace)await workspace.close().catch(()=>{});
    if(profile)await rm(profile,{recursive:true,force:true}).catch(()=>{});
  }
}

function flags(argv){
  const result={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!key.startsWith('--'))throw new Error('Use named browser-journey options.');const value=argv[i+1];if(value&&!value.startsWith('--')){result[key.slice(2)]=value;i++;}else result[key.slice(2)]=true;}return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const args=flags(process.argv.slice(2));
  if(args.help)process.stdout.write('node examples/native-browser-journey.mjs --workspace DIR --out DIR --source-commit SHA --actor NAME [--playwright-module MODULE] [--chromium PATH] [--single-process]\nConsumes the two retained source editions and an already acquired thumbnail. Provider capture stays with the original source operation.\n');
  else runStacBrowserJourney({directory:args.workspace,outputDirectory:args.out,sourceCommit:args['source-commit'],actor:args.actor||'B710 analyst',
    playwrightModule:args['playwright-module'],chromiumPath:args.chromium,allowSingleProcess:Boolean(args['single-process'])})
    .then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n'))
    .catch(error=>{process.stderr.write(JSON.stringify({error:safeError(error),resultPath:error.resultPath||null})+'\n');process.exitCode=1;});
}
