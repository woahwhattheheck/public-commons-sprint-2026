// MIT. Original WRI edition through the Datasette publisher, seller, interfaces and receiving.
import { createServer as reserveServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
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
  await writeFile(path,JSON.stringify(value,null,2)+'\n',{mode:0o600});
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
  const startedAt=new Date().toISOString(),directory=options.directory;
  await mkdir(directory,{mode:0o700,recursive:true});
  const input=await readFile(options.archive);
  check(hash(input)===EXPECTED_ARCHIVE,'The programme must use the already qualified original WRI edition archive.');
  const payment=JSON.parse(await readFile(options['payment-file'],'utf8'));
  const sellerPort=await freePort(),sellerUrl='http://127.0.0.1:'+sellerPort;
  const originalDirectory=join(directory,'workspace'),receivedDirectory=join(directory,'received');
  const resource=options.origin+'/data',runId=randomUUID(),requestId=randomUUID();
  let workspace,server,provider,seller,received,reopenedServer,cliServer;
  const report={schema:'stellar-forge.datasette-publisher-programme.v1',startedAt,node:process.version,
    source:{archiveSha256:EXPECTED_ARCHIVE,editionSha256:EXPECTED_EDITION},operations:[],checks:{}};
  try{
    workspace=await openDatasetteWorkspace({directory:originalDirectory,create:true,seller:sellerUrl,resource});
    const imported=await workspace.dispatch('source.receive',{archiveFile:options.archive,sha256:EXPECTED_ARCHIVE,id:'wri-geothermal'});
    check(imported.editionSha256===EXPECTED_EDITION,'The native source receiving changed the reviewed edition.');
    await workspace.dispatch('source.select',{editionId:'wri-geothermal'});
    await writeFile(join(originalDirectory,'imports','wri-geothermal.sfds.gz'),input,{mode:0o600});
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
    check(operations.length===31&&DATASETTE_OPERATIONS.every(name=>operations.some(item=>item.operation===name)),'The installed interfaces do not expose the original31 operations.');
    report.checks.originalWorkspaceIdentity=true;
    const planInput={title:'WRI geothermal original-source publication',requestId};
    const planned=await observed(client,()=>command(['--url-file',launchFile,'--operation','publisher.plan','--input',JSON.stringify(planInput)]));
    const plan=planned.value.value;
    check(Number.isSafeInteger(plan.id)&&plan.id>0,'The original publisher did not retain a plan.');
    const replay=await client.dispatch('publisher.plan',planInput);
    check(replay.id===plan.id&&replay.data.digest===plan.data.digest,'Plan request replay created a different original plan.');
    report.plan={id:plan.id,folder:plan.folder,digest:plan.data.digest,requestId,statusReads:planned.reads};
    const extracted=await observed(client,()=>provider.call('merchant_datasette_operation',
      {workspace:'wri',operation:'publisher.extract',input:{planId:plan.id,runId}}));
    const run=extracted.value.native.run;
    check(run.id===runId&&run.state==='READY','The original extraction did not finish READY.');
    const inspect=await client.dispatch('publisher.inspect',{runId});
    report.extraction={run,inspect,statusReads:extracted.reads};
    const review=await client.dispatch('publisher.review',{runId,reviewer:'Datasette integrated programme',
      note:'Original WRI edition, complete retained capture and publisher candidate reviewed before initialization.',initialize:true});
    check(review.state==='REVIEWED'&&typeof review.data.review.id==='string','The original candidate review was not retained.');
    const publication=await observed(client,()=>client.dispatch('publisher.publish',{runId,reviewId:review.data.review.id}));
    check(publication.value.state==='PUBLISHED','The original publisher did not initialize its dataset version store.');
    report.publication={run:publication.value,statusReads:publication.reads};
    seller=await datasetSeller(join(originalDirectory,'dataset'),payment,options.origin,sellerPort);
    check(seller.url===sellerUrl&&seller.mode==='CHALLENGE_ONLY','The original seller did not start with its declared local metadata mode.');
    const target=await client.dispatch('publisher.target',{});
    check(target.connected===true&&target.versions.current===publication.value.data.publication.snapshot,'The original target did not expose the published snapshot.');
    const offer=await client.dispatch('publisher.buyer-offer',{runId,query:'limit=5'});
    const buyer=await client.dispatch('publisher.prepare-buyer',{runId,intentId:'datasette-wri-'+randomUUID(),
      acceptIndex:0,offerSha256:offer.offerSha256,query:'limit=5'});
    check(buyer.mode==='ORIGINAL_SF88_CONFIG_PREPARED'&&buyer.snapshot===target.versions.current,'The original buyer preparation did not bind the published snapshot.');
    const prepared=await client.dispatch('release.prepare',{runId,outputDirectory:join(originalDirectory,'exports','wri-release'),
      payment,origin:options.origin,path:'/data'});
    const staged=await client.dispatch('release.stage',{packageDirectory:prepared.directory,releaseDirectory:join(originalDirectory,'releases'),
      id:'wri-geothermal',label:'WRI geothermal original edition',runtime:{port:0}});
    report.seller={url:seller.url,mode:seller.mode,target,offer};
    report.buyer={...buyer,configText:undefined};
    report.release={prepared,staged};
    const before=await client.dispatch('publisher.status',{limit:100});
    await seller.close();seller=null;
    const exported=await observed(client,()=>client.dispatch('workspace.export',{outputFile:join(directory,'complete-workspace.zip')}));
    const archive=exported.value;
    check(archive.manifest.files.some(file=>file.path==='publisher/publisher.sqlite'),'The complete archive omitted the original publisher database.');
    check(!archive.manifest.files.some(file=>['dataset/control.json','dataset/control.sock'].includes(file.path)),'A transient dataset control member entered the complete source archive.');
    report.archive={...archive,manifest:undefined,statusReads:exported.reads};
    await provider.close();provider=null;
    await server.close();server=null;
    await workspace.close();workspace=null;
    await rename(originalDirectory,join(directory,'original-preserved'));
    const restored=await receiveDatasetteWorkspace({archiveFile:archive.archiveFile,directory:receivedDirectory,sha256:archive.sha256});
    received=await openDatasetteWorkspace({directory:receivedDirectory});
    const after=await received.dispatch('publisher.status',{limit:100});
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
    seller=await datasetSeller(join(receivedDirectory,'dataset'),payment,options.origin,sellerPort);
    const preview=await datasetControl(join(receivedDirectory,'dataset'),'preview',{query:'limit=5'});
    check(preview.dataset.snapshot===target.versions.current,'The independent received seller opened a different original snapshot.');
    const receivedOffer=await received.dispatch('publisher.buyer-offer',{runId,query:'limit=5'});
    check(receivedOffer.snapshot===buyer.snapshot,'The received buyer offer changed the original published snapshot.');
    const receivedRelease=await received.dispatch('release.prepare',{runId,outputDirectory:join(receivedDirectory,'exports','received-wri-release'),
      payment,origin:options.origin,path:'/data'});
    const receivedStage=await received.dispatch('release.stage',{packageDirectory:receivedRelease.directory,
      releaseDirectory:join(receivedDirectory,'received-releases'),id:'wri-geothermal',label:'WRI geothermal received edition',runtime:{port:0}});
    report.receivedMerchant={preview,offer:receivedOffer,release:receivedRelease,stage:receivedStage};
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
    const replayReceive=await command(['receive-workspace','--archive-file',archive.archiveFile,'--sha256',archive.sha256,
      '--destination',receivedDirectory]);
    check(replayReceive.value.reused===true,'Standalone CLI receiving did not reconcile the original completed transfer.');
    received=await openDatasetteWorkspace({directory:receivedDirectory});
    check((await received.status()).selection.query==='receiving-edit','Receive replay overwrote the later edit.');
    const last=await received.dispatch('workspace.export',{outputFile:join(directory,'editable-received-workspace.zip')});
    await received.close();received=null;
    report.cli={announcement:cliHealth,shutdown:{code:terminal.code,signal:terminal.signal,stderr:terminal.stderr},
      receiveReused:replayReceive.value.reused};
    report.editedArchive={archiveFile:last.archiveFile,sha256:last.sha256,bytes:last.bytes,snapshotSha256:last.snapshotSha256};
    report.checks={...report.checks,originalOperationCatalog:true,planReplay:true,originalExtraction:true,
      concurrentPublisherStatus:true,reviewedNativePublication:true,originalSellerMetadata:true,
      originalBuyerPreparation:true,sourceRetainingRelease:true,completePublisherDatabase:true,
      publisherHistoryUnchanged:true,relocatedPublisherReopened:true,sqlitePreimageRetained:true,
      independentVersionStore:true,receivedMerchantRelease:true,nativeCLIServer:true,
      standaloneCLIReceiving:true,receivedSourceEditable:true,replayPreservesEdits:true};
    report.completedAt=new Date().toISOString();
    const reportFile=join(directory,'publisher-programme-result.json');
    await privateJson(reportFile,report);
    console.log(JSON.stringify({schema:report.schema,startedAt,completedAt:report.completedAt,node:process.version,
      checks:report.checks,runId,planId:plan.id,snapshot:buyer.snapshot,reportFile,
      archive:{file:archive.archiveFile,sha256:archive.sha256,bytes:archive.bytes},
      editedArchive:report.editedArchive}));
  }finally{
    await cliServer?.close();
    await provider?.close();
    await reopenedServer?.close();
    await server?.close();
    await seller?.close();
    await received?.close();
    await workspace?.close();
  }
}
await execute(argumentsFor(process.argv.slice(2)));
