#!/usr/bin/env node
// MIT. Complete original NWConnector source receiving through the shipped GTFS product.
import { readFile, mkdir, open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

const OPERATION='SCF-GTFS-SCHEDULE-MERCHANT-6200-20261012';
const FEED_SHA256='68807e2b9f3b6238b214694fe7787dcb6a28ddcce45600034864c5e59bb4e985';
const FEED_BYTES=826295;
const PRODUCT_COMMIT='71a9cc717d4372f8210ca57c2fa92c3905a76c9b';
const SDK='stellar/scf-starforge-20261009/sf30-seller-sdk';
const PREFIX=SDK+'/gtfs/';
const hash=value=>createHash('sha256').update(value).digest('hex');
const need=(condition,message)=>{if(!condition)throw new Error(message);};
async function exists(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function shaFile(path){
  const file=await open(path,'r'),sum=createHash('sha256'),buffer=Buffer.allocUnsafe(65536);let bytes=0;
  try{for(;;){const row=await file.read(buffer,0,buffer.length,null);if(!row.bytesRead)break;
    sum.update(buffer.subarray(0,row.bytesRead));bytes+=row.bytesRead;}}
  finally{await file.close();}
  return {bytes,sha256:sum.digest('hex')};
}
async function originalSource(root,manifestPath){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  need(manifest.schema==='stellar-forge.gtfs-native-source-manifest.v1'&&manifest.sourceCommit===PRODUCT_COMMIT&&
    Array.isArray(manifest.files)&&manifest.files.length>=16,'Use the complete selected original source manifest.');
  const seen=new Set();
  for(const item of manifest.files){
    need(typeof item.path==='string'&&!item.path.startsWith('/')&&!item.path.split('/').some(v=>!v||v==='.'||v==='..')&&
      !seen.has(item.path)&&/^[a-f0-9]{40}$/.test(item.gitBlobSha),'Invalid original source manifest member.');
    seen.add(item.path);const data=await readFile(join(root,item.path));
    need(createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex')===item.gitBlobSha,
      'Selected source changed: '+item.path);
  }
  need(seen.has(PREFIX+'workspace.mjs')&&seen.has(PREFIX+'archive.py')&&seen.has(SDK+'/frictionless/package.py'),
    'The native source closure is incomplete.');
  return {sourceCommit:manifest.sourceCommit,manifestSha256:hash(await readFile(manifestPath)),files:manifest.files.length};
}
export async function receiveGtfsSchedule({sourceRoot,directory,archive,sourceManifest,browserModule,chromium}){
  sourceRoot=await realpath(resolve(sourceRoot));directory=resolve(directory);archive=resolve(archive);
  sourceManifest=resolve(sourceManifest);
  const selectedSource=await originalSource(sourceRoot,sourceManifest);
  const original=await shaFile(archive);need(original.bytes===FEED_BYTES&&original.sha256===FEED_SHA256,
    'Select the original retained 826295-byte NWConnector feed edition.');
  const paymentFile=join(sourceRoot,SDK,'examples/service.json'),paymentBytes=await readFile(paymentFile);
  need(createHash('sha1').update(Buffer.from('blob '+paymentBytes.length+'\0')).update(paymentBytes).digest('hex')===
    'f44b91dbbafbf8e9ead1eab41d2a30065d286d86','Use the original selected SF30 example payment source.');
  const payment=JSON.parse(paymentBytes).routes[0].definition.payment;
  const module=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const [native,cli,bridge,managed,files,versionModule,merchantModule,publisherModule]=await Promise.all([
    module(PREFIX+'workspace.mjs'),module(PREFIX+'cli.mjs'),module(PREFIX+'source.mjs'),
    module(PREFIX+'application-provider.mjs'),module(SDK+'/postgres/publisher/files.mjs'),
    module(SDK+'/dataset-refresh/versions.mjs'),module(PREFIX+'merchant.mjs'),
    module('stellar-forge/mcp-merchant-operator/publisher.mjs')]);
  await files.privateDirectory(directory,true);
  const releaseOperation=await files.acquireWorkspace(directory);
  const recordFile=join(directory,'operation.json');
  let record;
  try {record=await exists(recordFile)?await files.readJson(recordFile,16*1024*1024):null;}
  catch(error){await releaseOperation();throw error;}
  const selection={operation:OPERATION,...selectedSource,feedSha256:FEED_SHA256,feedBytes:FEED_BYTES,
    paymentSourceBlob:'f44b91dbbafbf8e9ead1eab41d2a30065d286d86'};
  const save=()=>files.atomicJson(directory,'operation.json',record);
  try {
  if(record)need(JSON.stringify(record.selection)===JSON.stringify(selection),'Resume this operation with its exact original source and feed.');
  else{
    record={schema:'stellar-forge.gtfs-native-receiving.v1',selection,createdAt:new Date().toISOString(),
      ids:Object.fromEntries(['workspace','run','export','receivedExport'].map(name=>[name,randomUUID()])),
      requests:{},steps:{},state:'PREPARING'};
    await save();
  }
  } catch(error){await releaseOperation();throw error;}
  if(record.state==='COMPLETE'){await releaseOperation();return record.result;}
  const workspaceDirectory=join(directory,'workspace'),receivedDirectory=join(directory,'received-workspace');
  const releaseStore=join(directory,'seller-releases');
  let service=null,versions=null,merchant=null,borrowedPublisher=null,ownedBrowser=null;
  async function checkpoint(name,value){record.steps[name]=value;record.updatedAt=new Date().toISOString();await save();return value;}
  async function phase(name){record.state='RUNNING';record.phase=name;await save();
    process.stdout.write(JSON.stringify({schema:record.schema,operation:OPERATION,state:'RUNNING',phase:name,pid:process.pid,directory})+'\n');}
  function argumentsFor(root,create){return ['serve','--workspace',root,'--port','0','--expected-workspace-id',record.ids.workspace,
    '--release-store',releaseStore,...(create?['--create-if-missing','--title','NWConnector GTFS Schedule merchant']:[])];}
  async function start(root,create=false){
    const args=argumentsFor(root,create);service=await cli.main(args);
    const identity=await managed.gtfsStartup({command:'gtfs',args},JSON.stringify(service.startup));
    need(identity.workspaceId===record.ids.workspace&&identity.original.directory===root,'Original managed startup identity did not match.');
    return identity;
  }
  async function stop(){if(service){const previous=service;service=null;await previous.close();}}
  async function api(path,body,extra={}){
    const response=await fetch(new URL(path,service.url),{...(body===undefined?{}:{method:'POST',
      headers:{'content-type':'application/json',origin:service.url.replace(/\/$/,'')},body:JSON.stringify(body)}),...extra});
    const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message??value.error),
      {code:value.error,status:response.status});return value;
  }
  async function request(name,payload,revision){
    const previous=record.requests[name];
    if(previous){need(JSON.stringify(previous.payload)===JSON.stringify(payload),'Retained native request payload changed: '+name);return previous;}
    const value={requestId:randomUUID(),expectedRevision:revision,payload};record.requests[name]=value;await save();return value;
  }
  async function action(name,path,payload){
    const current=await api('/api/gtfs/status'),input=await request(name,payload,current.revision);
    return checkpoint(name,await api(path,input));
  }
  async function browserView(name,url){
    if(!browserModule)return null;
    const imported=await import(pathToFileURL(resolve(browserModule)).href),driver=imported.chromium??imported.default?.chromium;
    need(driver,'Use the actual installed Playwright module.');const issues=[];
    ownedBrowser=await driver.launch({headless:true,...(chromium?{executablePath:resolve(chromium)}:{}),
      args:['--no-sandbox','--disable-dev-shm-usage']});
    try{
      const page=await ownedBrowser.newPage({viewport:{width:1440,height:1100}});
      page.on('pageerror',error=>issues.push(error.message));
      const response=await page.goto(url,{waitUntil:'networkidle',timeout:45000});need(response.ok(),'Original browser did not load.');
      await page.waitForSelector('#gtfs-identity',{state:'visible'});
      await page.waitForFunction(()=>document.getElementById('gtfs-row-summary')?.textContent.length>0,undefined,{timeout:20000});
      const image=join(directory,'browser-'+name+'.png');await page.screenshot({path:image,fullPage:true});
      const value={url,title:await page.title(),identity:await page.locator('#gtfs-identity').innerText(),
        rows:await page.locator('#gtfs-row-summary').innerText(),notice:await page.locator('#gtfs-notice').innerText(),
        image,...await shaFile(image),pageErrors:issues};
      need(!issues.length,'Original browser raised: '+issues.join('; '));return checkpoint('browser-'+name,value);
    }finally{await ownedBrowser.close();ownedBrowser=null;}
  }
  async function download(call,kind,id,item,target){
    const partial=target+'.part';
    if(await exists(target)){
      const current=await shaFile(target);need(current.sha256===item.sha256&&current.bytes===item.bytes,'Retained completed download changed.');
      if(await exists(partial)){
        const [named,staged]=await Promise.all([lstat(target),lstat(partial)]);
        need(named.isFile()&&staged.isFile()&&!named.isSymbolicLink()&&!staged.isSymbolicLink()&&
          named.dev===staged.dev&&named.ino===staged.ino&&named.nlink===2,'Reconcile the original retained download staging file.');
        await unlink(partial);await files.syncDirectory(directory);
      }
      return current;
    }
    let file,retained=0,offset=0,readId;
    try{
      file=await open(partial,'a+',0o600);retained=(await file.stat()).size;
      need(retained<=item.bytes,'Retained download prefix exceeds the original file.');
      for(;;){
        const response=await call('merchant_gtfs_file_read',{kind,id,file:item.file,expectedSha256:item.sha256,
          ...(readId?{readId}:{}),offset,limit:65536});
        const value=response.native,chunk=Buffer.from(value.data,'base64');readId=value.readId;
        need(value.file.sha256===item.sha256&&value.file.bytes===item.bytes,'Original downloaded file identity changed.');
        const matched=Math.max(0,Math.min(chunk.length,retained-offset));
        if(matched){const original=Buffer.alloc(matched),got=await file.read(original,0,matched,offset);
          need(got.bytesRead===matched&&original.equals(chunk.subarray(0,matched)),'Retained download prefix changed.');}
        if(matched<chunk.length){await file.write(chunk.subarray(matched));await file.sync();}
        if(value.nextOffset===null)break;
        need(value.nextOffset===offset+chunk.length,'Original file-read offset changed.');offset=value.nextOffset;
      }
      await file.close();file=null;
      const actual=await shaFile(partial);need(actual.sha256===item.sha256&&actual.bytes===item.bytes,'Complete download bytes differ.');
      await link(partial,target);await unlink(partial);await files.syncDirectory(directory);return actual;
    }finally{
      await file?.close();
      if(readId)await call('merchant_gtfs_file_release',{readId}).catch(()=>{});
    }
  }
  try{
    await phase('original-launch');await checkpoint('launch',await start(workspaceDirectory,true));
    if(!record.steps.initialPublicationRecovery){
      need(service.workspace.revision===0,'Resume the original initial receiving state.');
      await stop();
      for(const file of ['initialization.json','workspace.json']){
        const target=join(workspaceDirectory,file),pending=target+'.pending-'+randomUUID();
        await link(target,pending);
      }
      const inspection=await native.inspectGtfsLaunch(workspaceDirectory);
      need(inspection.workspaceId===record.ids.workspace,'Read-only inspection lost the original workspace UUID.');
      need((await lstat(join(workspaceDirectory,'workspace.json'))).nlink===2,'Read-only inspection changed the original publication.');
      await start(workspaceDirectory,true);
      for(const file of ['initialization.json','workspace.json'])
        need((await lstat(join(workspaceDirectory,file))).nlink===1,'Native first-publication recovery is incomplete.');
      await checkpoint('initialPublicationRecovery',{workspaceId:inspection.workspaceId,revision:service.workspace.revision});
    }
    await phase('retain-original-feed');
    const input=await readFile(archive),status=await api('/api/gtfs/status');
    const retain=await request('retainFeed',{title:'NWConnector original feed / 2026-09-30',filename:basename(archive),
      feedSha256:FEED_SHA256,feedBytes:FEED_BYTES},status.revision);
    const query=new URLSearchParams({requestId:retain.requestId,expectedRevision:String(retain.expectedRevision),
      title:retain.payload.title,filename:retain.payload.filename,feedSha256:FEED_SHA256});
    await checkpoint('retainFeed',await api('/api/gtfs/upload?'+query,undefined,{method:'POST',
      headers:{'content-type':'application/zip',origin:service.url.replace(/\/$/,'')},body:input}));
    const feed=await api('/api/gtfs/feed?id='+retain.requestId);
    need(feed.inspection.fixedStopSchedule.available,'Original feed fixed-stop schedule is unavailable.');
    const tables=feed.inspection.tables.filter(row=>row.publishable).map(row=>row.name);
    const recipe={schema:'stellar-forge.gtfs-selection.v1',title:'NWConnector / all agencies / 12–18 October 2026',
      feedSha256:FEED_SHA256,startDate:'2026-10-12',endDate:'2026-10-18',agencyIds:[],routeIds:[],tables,includeSchedule:true,
      authority:{sourceUrl:'https://oregon-gtfs.trilliumtransit.com/gtfs_data/tillamookcounty-or-us/tillamookcounty-or-us.zip',
        licenseUrl:'',licenseName:'',attribution:'Trillium Solutions Inc.',retrievedAt:''},
      note:'Retained original public feed edition, with all selected physical source tables.'};
    await phase('complete-service-editions');
    const all=await action('allAgencies','/api/gtfs/edition',{feedId:retain.requestId,recipe});
    const tillamook=await action('tillamook','/api/gtfs/edition',{feedId:retain.requestId,
      recipe:{...recipe,title:'NWConnector / Tillamook 22 / 12–18 October 2026',agencyIds:['22']}});
    const allEdition=await api('/api/gtfs/edition?id='+all.edition.id),selectedEdition=await api('/api/gtfs/edition?id='+tillamook.edition.id);
    const rows=(edition,name)=>edition.edition.resources.find(item=>item.resource===name)?.rows;
    const actualCounts={allTrips:rows(allEdition,'Derived_ScheduledTrips'),allCalls:rows(allEdition,'Derived_ScheduledCalls'),
      selectedTrips:rows(selectedEdition,'Derived_ScheduledTrips'),selectedCalls:rows(selectedEdition,'Derived_ScheduledCalls'),
      originalTables:tables.length,retainedMembers:feed.inspection.members.length};
    need(actualCounts.allTrips===651&&actualCounts.allCalls===9022&&actualCounts.selectedTrips===406&&actualCounts.selectedCalls===5894,
      'Native counts differ from the original source owner’s retained complete feed calculation.');
    await checkpoint('serviceCounts',actualCounts);
    const comparison=await action('comparison','/api/gtfs/compare',{beforeId:all.edition.id,afterId:tillamook.edition.id,
      beforeSha256:all.edition.editionSha256,afterSha256:tillamook.edition.editionSha256});
    await action('decision','/api/gtfs/decision',{subject:{kind:'comparison',id:comparison.comparison.id,
      sha256:comparison.comparison.reportSha256},verdict:'accept',reviewer:'6200 original source receiving',
      note:'Complete original feed and all selected physical tables retained; 651/9022 all-agency trips/calls and 406/5894 Tillamook trips/calls match the original source edition.'});
    await action('selection','/api/gtfs/select',{editionId:tillamook.edition.id,editionSha256:tillamook.edition.editionSha256});
    const routePage=await api('/api/gtfs/source-rows?'+new URLSearchParams({feedId:retain.requestId,resource:'routes.txt',offset:'0',limit:'100'}));
    await checkpoint('originalRoutePage',routePage);
    await phase('native-publication');
    const publisher=service.workspace.publisher,source=await publisher.source();
    const queryName=Object.entries(source.queries).find(([,value])=>value.resource==='Derived_ScheduledTrips')?.[0];
    need(queryName,'The selected original scheduled-trip query is missing.');
    let plan;
    if(record.steps.plan){plan=publisher.plan(record.steps.plan.id);need(plan.data.digest===record.steps.plan.data.digest,'Original plan changed.');}
    else{
      const payload=await cli.makeGtfsPlan(service.workspace,queryName);
      payload.title='GTFS '+record.ids.workspace+' / Derived_ScheduledTrips';
      let matching=[];
      for(let offset=0;;offset+=100){const page=publisher.status({limit:100,plansOffset:offset});
        matching.push(...page.plans.filter(item=>item.data.title===payload.title&&item.data.sourceHash===payload.sourceHash));
        if(page.pages.plans.next===null)break;}
      need(matching.length<=1,'Reconcile the original matching saved plans before continuing.');
      plan=matching[0]??await publisher.savePlan(payload);await checkpoint('plan',plan);
    }
    let run;
    try{run=publisher.run(record.ids.run);}catch(error){if(error.code!=='RUN_NOT_FOUND')throw error;}
    if(!run){const started=publisher.startExtraction(plan.id,{id:record.ids.run});await started.completion;run=publisher.run(started.id);}
    if(['INTERRUPTED','PUBLICATION_UNKNOWN'].includes(run.state))run=await publisher.recover(run.id);
    need(['READY','REVIEWED','PUBLISHED'].includes(run.state),'Original extraction requires recovery: '+run.state);
    const preview=await api('/api/run?'+new URLSearchParams({id:run.id,query:'limit=25'}));
    need(preview.preview.page.total===406&&preview.preview.rows.length===25,'Original native query preview lost the selected full dataset.');
    if(run.state!=='PUBLISHED'){
      if(run.state!=='REVIEWED')run=await publisher.review(run.id,{reviewer:'6200 original source receiving',
        note:'Publish the exact retained Tillamook service-date edition with 406 scheduled trip instances.',initialize:true});
      run=await publisher.publish(run.id,run.data.review.id);
    }
    need(run.state==='PUBLISHED','Original native publication did not complete.');
    await checkpoint('publication',run);
    versions=await versionModule.openDatasetVersions({directory:join(workspaceDirectory,'dataset')});
    const published=versions.status();need(versions.describe().rowCount===406&&published.current===run.data.publication.snapshot,
      'Original version store differs from the published candidate.');
    await checkpoint('versionStore',published);await versions.close();versions=null;
    await phase('complete-merchant-source-package');
    const prepared=await action('release','/api/gtfs/release-prepare',{runId:run.id,payment,
      origin:'https://transit.example.com',path:'/schedule'});
    await action('stage','/api/gtfs/release-stage',{releaseId:prepared.release.id,releaseSha256:prepared.release.releaseSha256,
      id:'gtfs-nwconnector-'+record.ids.workspace.slice(0,8),label:'NWConnector original native receiving',runtime:{port:0}});
    const html=await(await fetch(service.url)).text();need(html.includes('/gtfs.mjs')&&html.includes('/app.mjs'),
      'The original publisher browser and GTFS controls are not served together.');
    for(const path of ['/app.mjs','/schedules.mjs','/style.css','/gtfs.mjs','/gtfs.css']){
      const response=await fetch(new URL(path,service.url));need(response.ok,'Original browser asset missing: '+path);await response.arrayBuffer();
    }
    await browserView('published',service.url);
    const beforeArchive=await api('/api/gtfs/status');
    if(record.exportRevision===undefined){record.exportRevision=beforeArchive.revision;await save();}
    const exported=await api('/api/gtfs/export',{requestId:record.ids.export,expectedRevision:record.exportRevision});
    const repeated=await api('/api/gtfs/export',{requestId:record.ids.export,expectedRevision:record.exportRevision});
    need(repeated.reused&&repeated.archiveSha256===exported.archiveSha256,'Original export request recovery changed the complete file.');
    await checkpoint('export',exported);await stop();

    await phase('native-merchant-client-and-download');
    const connectionFile=join(directory,'gtfs-connection.json');
    const connection={schema:merchantModule.GTFS_CONNECTION_SCHEMA,workspaces:{transit:{directory:workspaceDirectory,
      workspaceId:record.ids.workspace,label:'Original NWConnector',releaseStore,
      inputs:{original:{file:join(directory,'unavailable-original-input',basename(archive)),label:'Original source input'}}}}};
    if(!await exists(connectionFile))await files.createFile(connectionFile,files.bytes(connection));
    else need((await readFile(connectionFile)).equals(files.bytes(connection)),'The original receiving merchant connection changed.');
    const configured=await merchantModule.readGtfsWorkspaceConfiguration(connectionFile);
    borrowedPublisher=new publisherModule.MerchantPublisher({});
    merchant=new merchantModule.MerchantGtfsWorkspaces({gtfsWorkspaces:configured},borrowedPublisher);
    const call=(name,args={})=>merchant.call(name,{workspace:'transit',...args});
    const opened=await call('merchant_gtfs_open');
    const recoveredImport=await call('merchant_gtfs_import',{input:'original',title:retain.payload.title,
      requestId:retain.requestId,expectedRevision:retain.expectedRevision,expectedSha256:FEED_SHA256,expectedBytes:FEED_BYTES});
    need(recoveredImport.native.reused&&recoveredImport.native.feed.id===retain.requestId,'Saved source retry did not recover before missing host input.');
    const inspected=await call('merchant_gtfs_publisher_inspect',{runId:run.id,query:'limit=25'});
    need(inspected.native.preview.page.total===406,'Borrowed original merchant publisher lost its selected dataset.');
    const feedManifest=(await call('merchant_gtfs_manifest',{kind:'feed',id:retain.requestId,limit:100})).native;
    const zip=feedManifest.files.find(item=>item.file==='original.gtfs.zip');
    need(zip.sha256===FEED_SHA256,'Original merchant feed manifest changed.');
    const zipDownload=await download(call,'feed',retain.requestId,zip,join(directory,'received-original.gtfs.zip'));
    const archiveManifest=(await call('merchant_gtfs_manifest',{kind:'archive',id:record.ids.export,limit:100})).native;
    const archiveItem=archiveManifest.files[0],downloadPath=join(directory,'received-complete-workspace.tar.gz');
    need(archiveItem.sha256===exported.archiveSha256,'Original merchant archive manifest changed.');
    const archiveDownload=await download(call,'archive',record.ids.export,archiveItem,downloadPath);
    await checkpoint('merchantClient',{workspaceId:opened.workspaceId,instanceId:opened.instanceId,sourceRetry:recoveredImport.native,
      zipDownload,archiveDownload,archiveManifest});
    await call('merchant_gtfs_close',{instanceId:opened.instanceId});await merchant.close();merchant=null;
    await borrowedPublisher.close();borrowedPublisher=null;

    await phase('independent-whole-workspace-receiving');
    const inspectedArchive=await bridge.runGtfsArchiveCommand(['inspect','--archive',downloadPath,'--sha256',exported.archiveSha256]);
    need(inspectedArchive.workspaceJsonSha256===exported.workspaceJsonSha256,'Archive source identity changed.');
    const received=await bridge.runGtfsArchiveCommand(['receive','--archive',downloadPath,'--sha256',exported.archiveSha256,
      '--output',receivedDirectory,'--workspace-id',record.ids.workspace]);
    await checkpoint('receiving',received);
    await checkpoint('receivedLaunch',await start(receivedDirectory));
    const reopened=await api('/api/gtfs/status'),restoredEdition=await api('/api/gtfs/edition?id='+tillamook.edition.id);
    need(reopened.id===record.ids.workspace&&reopened.revision>=beforeArchive.revision&&
      restoredEdition.record.editionSha256===tillamook.edition.editionSha256,'Original received workspace identity or edition changed.');
    need(service.workspace.publisher.run(run.id).data.publication.snapshot===run.data.publication.snapshot,'Original publication history changed on receive.');
    versions=await versionModule.openDatasetVersions({directory:join(receivedDirectory,'dataset')});
    need(versions.status().current===published.current&&versions.describe().rowCount===406,'Received native dataset generation changed.');
    await checkpoint('receivedVersionStore',versions.status());await versions.close();versions=null;
    const after=await action('receivedDecision','/api/gtfs/decision',{subject:{kind:'edition',id:tillamook.edition.id,
      sha256:tillamook.edition.editionSha256},verdict:'accept',reviewer:'6200 original receiving operator',
      note:'Original publication, complete GTFS capture, source decisions and native version store reopened from the full verified workspace archive.'});
    await browserView('received',service.url);await stop();
    const again=await bridge.runGtfsArchiveCommand(['receive','--archive',downloadPath,'--sha256',exported.archiveSha256,
      '--output',receivedDirectory,'--workspace-id',record.ids.workspace]);
    need(again.recovered&&again.currentRevision===after.revision,'Same receiving reply recovery overwrote later original operator work.');
    await checkpoint('receivingRetry',again);
    await start(receivedDirectory);
    const finalState=await api('/api/gtfs/status');
    if(record.receivedExportRevision===undefined){record.receivedExportRevision=finalState.revision;await save();}
    const finalExport=await api('/api/gtfs/export',{requestId:record.ids.receivedExport,expectedRevision:record.receivedExportRevision});
    await checkpoint('receivedExport',finalExport);await stop();
    const result={schema:'stellar-forge.gtfs-native-receiving-result.v1',state:'COMPLETE',operation:OPERATION,
      ...selection,workspaceId:record.ids.workspace,directory,workspaceDirectory,receivedDirectory,
      counts:actualCounts,selectedEdition:tillamook.edition,comparison:comparison.comparison,
      nativePlanId:plan.id,nativeRunId:run.id,publishedSnapshot:published.current,
      release:prepared.release,archive:exported,receivedArchive:finalExport,
      receiving:received,receivingRetry:again,downloads:record.steps.merchantClient,
      views:Object.fromEntries(Object.entries(record.steps).filter(([name])=>name.startsWith('browser-'))),
      completedAt:new Date().toISOString()};
    await files.atomicJson(directory,'result.json',result);
    record.state='COMPLETE';record.phase='COMPLETE';record.result=result;await save();return result;
  }catch(error){
    record.state='INTERRUPTED';record.error={code:error.code??null,message:error.message,stack:error.stack?.slice(0,8000)};
    await save().catch(()=>{});throw error;
  }finally{
    await ownedBrowser?.close().catch(()=>{});await versions?.close().catch(()=>{});
    await stop().catch(()=>{});await merchant?.close().catch(()=>{});await borrowedPublisher?.close().catch(()=>{});
    await releaseOperation();
  }
}
async function main(argv){
  const known={'--source-root':'sourceRoot','--directory':'directory','--archive':'archive','--source-manifest':'sourceManifest',
    '--browser-module':'browserModule','--chromium':'chromium'},args={};
  for(let index=0;index<argv.length;index+=2){need(Object.hasOwn(known,argv[index])&&argv[index+1]&&!args[known[argv[index]]],
    'Use --source-root ROOT --directory PRIVATE_OPERATION --archive ORIGINAL_ZIP --source-manifest JSON [--browser-module FILE --chromium FILE].');
    args[known[argv[index]]]=argv[index+1];}
  for(const name of ['sourceRoot','directory','archive','sourceManifest'])need(args[name],name+' is required.');
  const result=await receiveGtfsSchedule(args);process.stdout.write(JSON.stringify(result)+'\n');
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main(process.argv.slice(2)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'GTFS_NATIVE_RECEIVING_FAILED',
    message:error.message,stack:error.stack})+'\n');process.exitCode=1;});
