// MIT. Original WRI edition through the Datasette publisher, seller, interfaces and receiving.
import { createServer as reserveServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, readdir, lstat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatasetteWorkspace } from './workspace.mjs';
import { startDatasetteServer } from './server.mjs';
import { createDatasetteClient, DATASETTE_OPERATIONS } from './client.mjs';
import { MerchantDatasetteWorkspaces, readDatasetteWorkspaceConfiguration } from './provider.mjs';
import { runDatasetteCLI } from './cli.mjs';
import { receiveDatasetteWorkspace } from './archive.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../dataset-refresh/service.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { prepareDatasetBuyer } from '../dataset-refresh/buyer-handoff.mjs';

const EXPECTED_ARCHIVE = '53f2486406d61f18c9e1c9ceaac659c265bbad7afe2fe54b1a17f43307cb0ca0';
const EXPECTED_EDITION = 'ee34942e0c4c090d4e5cab66eeb51dda49c5cf8852f86d9dfa299913b4115616';
const hash = raw => createHash('sha256').update(raw).digest('hex');
const same = (left,right) => JSON.stringify(left) === JSON.stringify(right);
const check = (condition,message) => { if (!condition) throw new Error(message); };
const delay = ms => new Promise(done=>setTimeout(done,ms));
function argumentsFor(argv) {
  const options={};
  for(let index=0;index<argv.length;index+=2) {
    const name=argv[index],value=argv[index+1];
    if(!['--directory','--archive','--payment-file','--origin'].includes(name) || !value ||
       Object.hasOwn(options,name.slice(2))) throw new Error('Use --directory ABS --archive ABS --payment-file ABS [--origin HTTPS_ORIGIN].');
    options[name.slice(2)]=value;
  }
  for(const name of ['directory','archive','payment-file']) {
    check(typeof options[name]==='string','The complete original directory, edition archive and public payment file are required.');
    options[name]=resolve(options[name]);
  }
  options.origin ??='https://datasette.example';
  return options;
}
async function privateJson(path,value) {
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.partial-'+randomUUID(),handle=await open(temporary,'wx',0o600);
  try { await handle.writeFile(JSON.stringify(value,null,2)+'\n'); await handle.sync(); }
  finally { await handle.close(); }
  try { await rename(temporary,path); }
  catch(error) { await unlink(temporary).catch(()=>{}); throw error; }
  const parent=await open(dirname(path),'r');
  try { await parent.sync(); } finally { await parent.close(); }
}
async function exists(path) {
  try { await lstat(path); return true; } catch(error) { if(error.code==='ENOENT')return false; throw error; }
}
async function jsonIfPresent(path) {
  try { return JSON.parse(await readFile(path,'utf8')); }
  catch(error) { if(error.code==='ENOENT')return null; throw error; }
}
async function retainedJourney(directory,inputs) {
  const file=join(directory,'publisher-programme-state.json');
  let state=await jsonIfPresent(file);
  if(state) {
    check(state.schema==='stellar-forge.datasette-publisher-programme-state.v1'&&
      state.directory===directory&&same(state.inputs,inputs),'The retained programme belongs to different original inputs.');
    check(/^[a-f0-9-]{36}$/.test(state.runId)&&/^[a-f0-9-]{36}$/.test(state.requestId)&&
      typeof state.buyerIntentId==='string'&&Number.isInteger(state.sellerPort),'The retained programme identities are incomplete.');
  } else {
    const startedAt=new Date().toISOString();
    state={schema:'stellar-forge.datasette-publisher-programme-state.v1',directory,inputs,
      startedAt,runId:randomUUID(),requestId:randomUUID(),buyerIntentId:'datasette-wri-'+randomUUID(),
      sellerPort:await freePort(),phase:'CREATED',
      report:{schema:'stellar-forge.datasette-publisher-programme.v1',startedAt,node:process.version,
        source:{archiveSha256:EXPECTED_ARCHIVE,editionSha256:EXPECTED_EDITION},checks:{}}};
    const handle=await open(file,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(state,null,2)+'\n'); await handle.sync(); }
    finally { await handle.close(); }
    const parent=await open(directory,'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
  const save=async phase=>{
    state.phase=phase;state.updatedAt=new Date().toISOString();delete state.error;
    await privateJson(file,state);
  };
  return {state,file,save};
}
async function reopenBuyer(directory,runId,offer,buyerIntentId) {
  const expected=prepareDatasetBuyer(offer,{intentId:buyerIntentId,acceptIndex:0,offerSha256:offer.offerSha256});
  const folder=join(directory,'publisher','runs',runId);
  const names=(await readdir(folder)).filter(name=>/^buyer-[a-f0-9-]+\.json$/.test(name)).sort();
  for(const name of names) {
    const path=join(folder,name),raw=await readFile(path);
    if(hash(raw)===expected.configSha256)
      return {...expected,path,retainedPreparationReopened:true};
  }
  return null;
}
function programmeSummary(report,reportFile) {
  return {schema:report.schema,startedAt:report.startedAt,completedAt:report.completedAt,node:report.node,
    checks:report.checks,runId:report.extraction.run.id,planId:report.plan.id,snapshot:report.buyer.snapshot,reportFile,
    archive:{file:report.archive.archiveFile,sha256:report.archive.sha256,bytes:report.archive.bytes},
    editedArchive:report.editedArchive};
}
async function freePort() {
  const server=reserveServer();
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const port=server.address().port;
  await new Promise((done,fail)=>server.close(error=>error?fail(error):done()));
  return port;
}
async function command(argv) {
  let output='',errors='';
  const code=await runDatasetteCLI(argv,{stdout:{write:text=>{output+=text;}},stderr:{write:text=>{errors+=text;}}});
  check(code===0,'Original Datasette CLI failed: '+errors);
  return {code,value:JSON.parse(output),stderr:errors};
}
async function observed(client,action) {
  const reads=[];
  let completed=false;
  const execution=Promise.resolve().then(action).then(value=>({value}),error=>({error})).finally(()=>{completed=true;});
  do {
    const [health,status]=await Promise.all([client.health(),client.status()]);
    reads.push({workspaceId:health.workspaceId,active:status.active,
      publisherState:status.publisher?.active??null,plans:status.publisher?.plans?.length??0});
    if(!completed) await delay(10);
  } while(!completed);
  const result=await execution;
  if(result.error)throw result.error;
  return {value:result.value,reads};
}
async function launchCLI(directory,expectedWorkspaceId) {
  const child=spawn(process.execPath,[fileURLToPath(new URL('./cli.mjs',import.meta.url)),
    'serve','--directory',directory,'--expected-workspace-id',expectedWorkspaceId,
    '--startup-format','managed','--port','0'],{stdio:['ignore','pipe','pipe']});
  let stderr='',stdout='';
  child.stderr.on('data',chunk=>{stderr+=chunk.toString();});
  const completion=new Promise((done,fail)=>{
    child.once('error',fail);
    child.once('close',(code,signal)=>done({code,signal,stderr,stdout}));
  });
  let timer;
  const announcement=await new Promise((done,fail)=>{
    timer=setTimeout(()=>{child.kill('SIGTERM');fail(new Error('The original CLI did not announce its native workspace.'));},10000);
    const failed=(code,signal)=>fail(new Error('The original CLI exited before startup: '+code+' '+signal+' '+stderr));
    child.once('close',failed);
    child.stdout.on('data',chunk=>{
      stdout+=chunk.toString();
      if(stdout.length>65536){child.kill('SIGTERM');fail(new Error('The CLI startup output exceeded its complete record limit.'));return;}
      const end=stdout.indexOf('\n');
      if(end>=0){
        clearTimeout(timer);child.removeListener('close',failed);
        try{done(JSON.parse(stdout.slice(0,end)));}catch(error){fail(error);}
      }
    });
  });
  check(announcement.schema==='stellar-forge.datasette-server.v1'&&announcement.workspaceId===expectedWorkspaceId,
    'The original CLI announcement changed the workspace identity.');
  return {child,announcement,completion,async close(){
    child.kill('SIGTERM');const result=await completion;
    check(result.code===0,'Original CLI shutdown failed: '+result.stderr);
    check(result.stdout.trim().split('\n').length===1,'The CLI emitted more than one startup announcement.');
    return result;
  }};
}
async function datasetSeller(directory,payment,origin,port) {
  const versions=await openDatasetVersions({directory});
  let seller;
  try{
    const config=await buildDatasetSellerConfig(versions,{payment,origin,path:'/data'});
    config.routes[0].definition.queryParameters.push(DATASET_SNAPSHOT_PARAMETER);
    seller=await startVersionedDatasetSeller({versions,config,port,controlTransport:'loopback'});
    return seller;
  }catch(error){if(!seller)await versions.close();throw error;}
}
async function execute(options) {
  const directory=options.directory;
  await mkdir(directory,{mode:0o700,recursive:true});
  const input=await readFile(options.archive);
  check(hash(input)===EXPECTED_ARCHIVE,'The programme must use the already qualified original WRI edition archive.');
  const paymentBytes=await readFile(options['payment-file']),payment=JSON.parse(paymentBytes.toString('utf8'));
  const journey=await retainedJourney(directory,{archiveSha256:EXPECTED_ARCHIVE,
    editionSha256:EXPECTED_EDITION,paymentSha256:hash(paymentBytes),origin:options.origin});
  const {state,save}=journey,report=state.report;
  const {runId,requestId,buyerIntentId,sellerPort}=state;
  const originalDirectory=join(directory,'workspace'),receivedDirectory=join(directory,'received');
  const preservedDirectory=join(directory,'original-preserved'),sellerUrl='http://127.0.0.1:'+sellerPort;
  const resource=options.origin+'/data',reportFile=join(directory,'publisher-programme-result.json');
  let workspace,server,provider,seller,received,cliServer;
  if(state.phase==='COMPLETE') {
    for(const item of [report.archive,report.editedArchive])
      check(hash(await readFile(item.archiveFile))===item.sha256,'A completed programme archive changed.');
    await privateJson(reportFile,report);
    console.log(JSON.stringify({...programmeSummary(report,reportFile),reused:true}));
    return;
  }
  try {
    if(!report.archive) {
      check(!await exists(preservedDirectory),'The original root was relocated before its archive result was retained.');
      workspace=await openDatasetteWorkspace({directory:originalDirectory,create:true,seller:sellerUrl,resource});
      if(state.workspaceId)check(state.workspaceId===workspace.workspaceId,'The original workspace identity changed during programme recovery.');
      state.workspaceId=workspace.workspaceId;
      await save('ORIGINAL_OPEN');
      const imported=await workspace.dispatch('source.receive',{archiveFile:options.archive,sha256:EXPECTED_ARCHIVE,id:'wri-geothermal'});
      check(imported.editionSha256===EXPECTED_EDITION,'The native source receiving changed the reviewed edition.');
      await workspace.dispatch('source.select',{editionId:'wri-geothermal'});
      const retainedInput=join(originalDirectory,'imports','wri-geothermal.sfds.gz');
      if(await exists(retainedInput))check(hash(await readFile(retainedInput))===EXPECTED_ARCHIVE,'The retained original edition archive changed.');
      else await writeFile(retainedInput,input,{flag:'wx',mode:0o600});
      server=await startDatasetteServer({workspace,host:'127.0.0.1',port:0});
      const announcement={schema:'stellar-forge.datasette-server.v1',url:server.url,workspaceId:server.workspaceId,
        instanceId:server.instanceId,directory:server.directory,pid:process.pid};
      const launchFile=join(directory,'datasette-server.json'),configFile=join(directory,'datasette-connection.json');
      await privateJson(launchFile,announcement);
      await privateJson(configFile,{schema:'stellar-forge.datasette-workspace-connection.v1',
        workspaces:{wri:{label:'Original WRI geothermal edition',urlFile:launchFile,expectedWorkspaceId:workspace.workspaceId}}});
      provider=new MerchantDatasetteWorkspaces({datasetteWorkspaces:await readDatasetteWorkspaceConfiguration(configFile)});
      const client=createDatasetteClient({url:server.url,expectedWorkspaceId:workspace.workspaceId});
      const [health,operations,providerHealth]=await Promise.all([client.health(),client.operations(),
        provider.call('merchant_datasette_health',{workspace:'wri'})]);
      check(health.workspaceId===workspace.workspaceId&&providerHealth.native.workspaceId===health.workspaceId,'SDK and provider selected different workspaces.');
      check(DATASETTE_OPERATIONS.length===31&&DATASETTE_OPERATIONS.every(name=>operations.some(item=>item.operation===name)),
        'The installed interfaces do not expose every original operation.');
      report.checks.originalWorkspaceIdentity=true;
      report.operationCatalog=operations;
      const planInput={title:'WRI geothermal original-source publication',requestId};
      const planned=await observed(client,()=>command(['--url-file',launchFile,'--operation','publisher.plan','--input',JSON.stringify(planInput)]));
      const plan=planned.value.value;
      check(Number.isSafeInteger(plan.id)&&plan.id>0,'The original publisher did not retain a plan.');
      const replay=await client.dispatch('publisher.plan',planInput);
      check(replay.id===plan.id&&replay.data.digest===plan.data.digest,'Plan request replay created a different original plan.');
      if(report.plan)check(report.plan.id===plan.id&&report.plan.digest===plan.data.digest,'Recovery selected a different saved plan.');
      report.plan={id:plan.id,folder:plan.folder,digest:plan.data.digest,requestId,statusReads:planned.reads};
      await save('PLANNED');
      const extracted=await observed(client,()=>provider.call('merchant_datasette_operation',
        {workspace:'wri',operation:'publisher.extract',input:{planId:plan.id,runId}}));
      let run=extracted.value.native.run;
      if(['INTERRUPTED','FAILED','CANCELLED','PUBLICATION_UNKNOWN'].includes(run.state))
        run=await client.dispatch('publisher.recover',{runId});
      check(run.id===runId&&['READY','REVIEWED','PUBLISHED'].includes(run.state),
        'The original extraction has no complete recoverable candidate: '+run.state);
      check(run.data.candidate?.dataset?.rowCount===189,'The original WRI extraction did not retain all189 rows.');
      const inspect=await client.dispatch('publisher.inspect',{runId});
      report.extraction??={run,inspect,statusReads:extracted.reads};
      await save('EXTRACTED');
      let review;
      if(run.state==='READY')review=await client.dispatch('publisher.review',{runId,reviewer:'Datasette integrated programme',
        note:'Original WRI edition, complete retained capture and publisher candidate reviewed before initialization.',initialize:true});
      else review=run;
      check(['REVIEWED','PUBLISHED'].includes(review.state)&&typeof review.data.review?.id==='string','The original candidate review was not retained.');
      report.review??=review;
      await save('REVIEWED');
      const publication=await observed(client,()=>client.dispatch('publisher.publish',{runId,reviewId:review.data.review.id}));
      check(publication.value.state==='PUBLISHED','The original publisher did not initialize its dataset version store.');
      report.publication??={run:publication.value,statusReads:publication.reads};
      await save('PUBLISHED');
      seller=await datasetSeller(join(originalDirectory,'dataset'),payment,options.origin,sellerPort);
      check(seller.url===sellerUrl&&seller.mode==='CHALLENGE_ONLY','The original seller did not start with its declared local metadata mode.');
      const target=await client.dispatch('publisher.target',{});
      check(target.connected===true&&target.versions.current===publication.value.data.publication.snapshot,'The original target did not expose the published snapshot.');
      const offer=await client.dispatch('publisher.buyer-offer',{runId,query:'limit=5'});
      const buyer=await reopenBuyer(originalDirectory,runId,offer,buyerIntentId) ??
        await client.dispatch('publisher.prepare-buyer',{runId,intentId:buyerIntentId,
          acceptIndex:0,offerSha256:offer.offerSha256,query:'limit=5'});
      check(buyer.mode==='ORIGINAL_SF88_CONFIG_PREPARED'&&buyer.snapshot===target.versions.current,'The original buyer preparation did not bind the published snapshot.');
      report.seller={url:seller.url,mode:seller.mode,target,offer};
      report.buyer={...buyer,configText:undefined};
      await save('BUYER_PREPARED');
      const prepared=await client.dispatch('release.prepare',{runId,outputDirectory:join(originalDirectory,'exports','wri-release'),
        payment,origin:options.origin,path:'/data'});
      report.release={...report.release,prepared};
      await save('RELEASE_PREPARED');
      const staged=await client.dispatch('release.stage',{packageDirectory:prepared.directory,releaseDirectory:join(originalDirectory,'releases'),
        id:'wri-geothermal',label:'WRI geothermal original edition',runtime:{port:0}});
      report.release={prepared,staged,role:'ORIGINAL_STAGED_RELEASE_HISTORY'};
      report.publisherBefore=await client.dispatch('publisher.status',{limit:100});
      await save('RELEASE_STAGED');
      await seller.close();seller=null;
      const exported=await observed(client,()=>client.dispatch('workspace.export',{outputFile:join(directory,'complete-workspace.zip')}));
      const archive=exported.value;
      check(archive.manifest.files.some(file=>file.path==='publisher/publisher.sqlite'),'The complete archive omitted the original publisher database.');
      check(!archive.manifest.files.some(file=>['dataset/control.json','dataset/control.sock'].includes(file.path)),
        'A transient dataset control member entered the complete source archive.');
      report.archive={...archive,statusReads:exported.reads};
      await save('ORIGINAL_ARCHIVED');
      await provider.close();provider=null;
      await server.close();server=null;
      await workspace.close();workspace=null;
    }
    const archive=report.archive,target=report.seller.target,buyer=report.buyer;
    check(hash(await readFile(archive.archiveFile))===archive.sha256,'The retained complete workspace archive changed.');
    if(await exists(originalDirectory)) {
      check(!await exists(preservedDirectory),'Both original workspace paths are occupied.');
      await rename(originalDirectory,preservedDirectory);
    }
    check(await exists(preservedDirectory),'The complete original workspace history is missing.');
    await save('ORIGINAL_RENAMED');
    const restored=await receiveDatasetteWorkspace({archiveFile:archive.archiveFile,directory:receivedDirectory,sha256:archive.sha256});
    received=await openDatasetteWorkspace({directory:receivedDirectory});
    const after=await received.dispatch('publisher.status',{limit:100}),before=report.publisherBefore;
    check(same(after.plans,before.plans)&&same(after.runs,before.runs)&&same(after.history,before.history),
      'Receiving changed the original publisher plans, runs or event history.');
    const settings=JSON.parse(await readFile(join(receivedDirectory,'publisher','workspace.json'),'utf8'));
    check(settings.sourceFile===join(receivedDirectory,'selected-source.json')&&settings.targetDirectory===join(receivedDirectory,'dataset'),
      'The received native publisher execution paths did not relocate.');
    const dbPin=archive.manifest.files.find(file=>file.path==='publisher/publisher.sqlite');
    const dbOriginal=await readFile(join(receivedDirectory,restored.preimagesDirectory,'publisher','publisher.sqlite'));
    check(hash(dbOriginal)===dbPin.sha256,'The original SQLite preimage was not retained exactly.');
    const inspected=await received.dispatch('publisher.inspect',{runId});
    report.receiving={...restored,manifest:undefined,publisher:after,candidate:inspected};
    await save('RECEIVED_OPENED');
    seller=await datasetSeller(join(receivedDirectory,'dataset'),payment,options.origin,sellerPort);
    const preview=await datasetControl(join(receivedDirectory,'dataset'),'preview',{query:'limit=5'});
    check(preview.dataset.snapshot===target.versions.current,'The independent received seller opened a different original snapshot.');
    const receivedOffer=await received.dispatch('publisher.buyer-offer',{runId,query:'limit=5'});
    check(receivedOffer.snapshot===buyer.snapshot,'The received buyer offer changed the original published snapshot.');
    const receivedRelease=await received.dispatch('release.prepare',{runId,outputDirectory:join(receivedDirectory,'exports','received-wri-release'),
      payment,origin:options.origin,path:'/data'});
    const receivedStage=await received.dispatch('release.stage',{packageDirectory:receivedRelease.directory,
      releaseDirectory:join(receivedDirectory,'received-releases'),id:'wri-geothermal',label:'WRI geothermal received edition',runtime:{port:0}});
    check(receivedRelease.snapshot===report.release.prepared.snapshot,'The received release selected a different published snapshot.');
    report.receivedMerchant={role:'RECEIVED_RELEASE_PREPARED_BY_ORIGINAL_SF82',preview,offer:receivedOffer,
      release:receivedRelease,stage:receivedStage,originalStagedHistory:report.release.staged,
      publishedSnapshot:receivedRelease.snapshot};
    await save('RECEIVED_MERCHANT');
    await seller.close();seller=null;
    const receiveId=received.workspaceId;
    await received.close();received=null;
    cliServer=await launchCLI(receivedDirectory,receiveId);
    const nativeCLI=createDatasetteClient({url:cliServer.announcement.url,expectedWorkspaceId:receiveId});
    const cliHealth=await nativeCLI.health();
    const cliStatus=await command(['status','--url',cliServer.announcement.url,'--expected-workspace-id',receiveId]);
    check(cliHealth.workspaceId===receiveId&&cliStatus.value.workspaceId===receiveId,'The actual CLI server could not reopen the complete received workspace.');
    const changed=await nativeCLI.dispatch('source.select',{editionId:'wri-geothermal',query:'receiving-edit'});
    check(changed.query==='receiving-edit','The independent received source could not be edited.');
    const terminal=await cliServer.close();cliServer=null;
    report.cli={announcement:cliHealth,shutdown:{code:terminal.code,signal:terminal.signal,stderr:terminal.stderr}};
    await save('CLI_EDITED');
    const replayReceive=await command(['receive-workspace','--archive-file',archive.archiveFile,'--sha256',archive.sha256,
      '--destination',receivedDirectory]);
    check(replayReceive.value.reused===true,'Standalone CLI receiving did not reconcile the original completed transfer.');
    received=await openDatasetteWorkspace({directory:receivedDirectory});
    check((await received.status()).selection.query==='receiving-edit','Receive replay overwrote the later edit.');
    const last=await received.dispatch('workspace.export',{outputFile:join(directory,'editable-received-workspace.zip')});
    await received.close();received=null;
    report.cli.receiveReused=replayReceive.value.reused;
    report.editedArchive={archiveFile:last.archiveFile,sha256:last.sha256,bytes:last.bytes,snapshotSha256:last.snapshotSha256};
    report.checks={...report.checks,originalOperationCatalog:true,retainedProgrammeIdentities:true,
      planReplay:true,originalExtraction:true,allOriginalRowsPublished:true,
      concurrentPublisherStatus:true,reviewedNativePublication:true,originalSellerMetadata:true,
      originalBuyerPreparation:true,sourceRetainingRelease:true,originalStagedReleaseHistoryRetained:true,
      completePublisherDatabase:true,publisherHistoryUnchanged:true,relocatedPublisherReopened:true,
      sqlitePreimageRetained:true,independentVersionStore:true,
      receivedReleasePreparedFromSameSnapshot:true,nativeCLIServer:true,
      standaloneCLIReceiving:true,receivedSourceEditable:true,replayPreservesEdits:true};
    report.completedAt=new Date().toISOString();
    await privateJson(reportFile,report);
    await save('COMPLETE');
    console.log(JSON.stringify(programmeSummary(report,reportFile)));
  } catch(error) {
    state.error={code:error.code??error.name,message:error.message,at:new Date().toISOString(),
      runId,requestId,workspaceId:state.workspaceId??null};
    await privateJson(journey.file,state);
    await privateJson(reportFile,{...report,phase:state.phase,error:state.error});
    throw error;
  } finally {
    const handles=[cliServer,provider,server,seller,received,workspace].filter(Boolean);
    for(const handle of handles)try{await handle.close();}catch(error){
      process.stderr.write(JSON.stringify({schema:'stellar-forge.datasette-programme-cleanup.v1',
        error:error.code??error.name,message:error.message,runId})+'\n');
    }
  }
}
await execute(argumentsFor(process.argv.slice(2)));
