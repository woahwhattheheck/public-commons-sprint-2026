// MIT. Original WRI edition through the Datasette publisher, seller, interfaces and receiving.
import { createServer as reserveServer } from 'node:net';
import { request as rawHttpRequest } from 'node:http';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, open, readdir, lstat, unlink } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatasetteWorkspace } from './workspace.mjs';
import { startDatasetteServer } from './server.mjs';
import { createDatasetteClient, DATASETTE_OPERATIONS } from './client.mjs';
import { readDatasetteWorkspaceConfiguration } from './provider.mjs';
import { MerchantDatasetteWorkspaces } from '../../../../stellar-forge/mcp-merchant-operator/datasette-workspace.mjs';
import { runDatasetteCLI } from './cli.mjs';
import { receiveDatasetteWorkspace } from './archive.mjs';
import { readDatasetteEdition } from './editions.mjs';
import { openDatasetVersions, DATASET_SNAPSHOT_PARAMETER } from '../dataset-refresh/versions.mjs';
import { startVersionedDatasetSeller, datasetControl } from '../dataset-refresh/service.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { prepareDatasetBuyer } from '../dataset-refresh/buyer-handoff.mjs';
import { runDatasetteMcpReceiving } from '../../../../operations/scf-datasette-mcp-receiving-20261012/run-receiving.mjs';

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
      selectionRequestId:randomUUID(),reviewRequestId:randomUUID(),buyerRequestId:randomUUID(),receivedSelectionRequestId:randomUUID(),
      sellerPort:await freePort(),uploadId:randomUUID(),shutdownUploadId:randomUUID(),refreshOperationId:'wri-refresh-'+randomUUID(),refreshEditionId:'wri-geothermal-refresh',phase:'CREATED',
      report:{schema:'stellar-forge.datasette-publisher-programme.v1',startedAt,node:process.version,
        source:{archiveSha256:EXPECTED_ARCHIVE,editionSha256:EXPECTED_EDITION},checks:{}}};
    const handle=await open(file,'wx',0o600);
    try { await handle.writeFile(JSON.stringify(state,null,2)+'\n'); await handle.sync(); }
    finally { await handle.close(); }
    const parent=await open(directory,'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
  for(const name of ['selectionRequestId','reviewRequestId','buyerRequestId','receivedSelectionRequestId']) state[name]??=randomUUID();
  state.uploadId??=state.runId;
  state.shutdownUploadId??=randomUUID();
  state.refreshOperationId??='wri-refresh-'+state.runId;
  state.refreshEditionId??='wri-geothermal-refresh';
  const save=async phase=>{
    state.phase=phase;state.updatedAt=new Date().toISOString();delete state.error;
    await privateJson(file,state);
  };
  return {state,file,save};
}
function programmeSummary(report,reportFile) {
  return {schema:report.schema,startedAt:report.startedAt,completedAt:report.completedAt,node:report.node,
    checks:report.checks,runId:report.extraction.run.id,planId:report.plan.id,snapshot:report.buyer.snapshot,reportFile,
    archive:{file:report.archive.archiveFile,sha256:report.archive.sha256,bytes:report.archive.bytes},
    editedArchive:report.editedArchive,mcpReceiving:{state:report.mcpReceiving?.state??null,
      report:report.mcpReceiving?.report??null,exportId:report.mcpReceiving?.exportId??null,
      files:report.mcpReceiving?.result?.downloadFiles??null},sourceRefresh:{state:report.sourceRefresh?.state??null,
      operationId:report.sourceRefresh?.operationId??null,error:report.sourceRefresh?.error??null}};
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
    const startedAt=new Date().toISOString();
    child.kill('SIGTERM');
    let timer;
    const ended=await Promise.race([completion.then(result=>({result})),
      new Promise(done=>{timer=setTimeout(()=>done({timedOut:true}),10000);})]);
    clearTimeout(timer);
    if(ended.timedOut) {
      child.kill('SIGKILL');
      const terminal=await completion;
      throw Object.assign(new Error('The managed Datasette CLI did not drain its original upload within ten seconds.'),
        {code:'DATASETTE_CLI_SHUTDOWN_TIMEOUT',shutdown:{startedAt,terminal}});
    }
    const result={...ended.result,startedAt,completedAt:new Date().toISOString()};
    check(result.code===0,'Original CLI shutdown failed: '+result.stderr);
    check(result.stdout.trim().split('\n').length===1,'The CLI emitted more than one startup announcement.');
    return result;
  }};
}
function incompleteUpload(url,workspaceId,declaration,raw,offset) {
  const target=new URL('/api/upload',url);
  const selected={...declaration,offset:String(offset),length:String(raw.length-offset)};
  for(const [name,value] of Object.entries(selected)) target.searchParams.set(name,value);
  let request,resolveResult,finished=false,responseStatus=null,responseBody='';
  const result=new Promise(done=>{resolveResult=done;});
  const finish=value=>{if(!finished){finished=true;resolveResult({responseStatus,responseBody,...value});}};
  request=rawHttpRequest(target,{method:'POST',headers:{
    'X-Datasette-Workspace-ID':workspaceId,'Content-Type':'application/octet-stream',
    'Content-Length':selected.length,
  }});
  request.once('error',error=>finish({error:{code:error.code??error.name,message:error.message}}));
  request.once('close',()=>finish({closed:true}));
  request.once('response',response=>{
    responseStatus=response.statusCode;
    response.on('data',chunk=>{if(responseBody.length<4096)responseBody+=chunk.toString('utf8').slice(0,4096-responseBody.length);});
    response.once('error',error=>finish({error:{code:error.code??error.name,message:error.message}}));
    response.once('end',()=>finish({ended:true}));
  });
  request.flushHeaders();
  const offered=raw.subarray(offset,Math.min(raw.length,offset+97));
  request.write(offered);
  return {request,result,input:selected,offeredBytes:offered.length};
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
  if(state.phase==='COMPLETE'&&report.sourceRefresh?.state==='COMPLETE'&&report.mcpReceiving?.passed&&report.managedUpload?.resumed) {
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
      check(same([...DATASETTE_OPERATIONS].sort(),operations.map(item=>item.operation).sort()),
        'The installed interfaces do not expose every original operation.');
      report.checks.originalWorkspaceIdentity=true;
      report.operationCatalog=operations;
      const declaration={uploadId:state.uploadId,name:'wri-geothermal.sfds.gz',
        bytes:String(input.length),sha256:EXPECTED_ARCHIVE},split=Math.floor(input.length/2);
      const firstInput={...declaration,offset:'0',length:String(split)};
      const first=await client.uploadChunk(firstInput,input.subarray(0,split));
      check(Number(first.receivedBytes)>=split&&first.uploadId===state.uploadId,
        'The first original upload chunk did not retain its prefix.');
      if(first.receivedBytes===String(split))
        check(first.prefixSha256===hash(input.subarray(0,split)),'The original upload prefix hash changed.');
      const prefixReplay=await client.uploadChunk(firstInput,input.subarray(0,split));
      check(prefixReplay.replayed===true&&prefixReplay.receivedBytes===first.receivedBytes&&
        prefixReplay.prefixSha256===first.prefixSha256,'The exact original upload chunk replay changed its durable prefix.');
      const prefixStatus=await client.uploadStatus({uploadId:state.uploadId});
      check(prefixStatus.receivedBytes===first.receivedBytes&&prefixStatus.prefixSha256===first.prefixSha256,
        'Upload status selected a different durable prefix.');
      let completion=await client.uploadChunk({...declaration,offset:String(split),length:String(input.length-split)},
        input.subarray(split));
      if(completion.state==='FINALIZABLE')
        completion=await client.uploadChunk({...declaration,offset:String(input.length),length:'0'},Buffer.alloc(0));
      const finalStatus=await client.uploadStatus({uploadId:state.uploadId});
      check(completion.state==='COMPLETE'&&finalStatus.state==='COMPLETE'&&finalStatus.sha256===EXPECTED_ARCHIVE&&
        finalStatus.receivedBytes===String(input.length)&&typeof finalStatus.archiveFile==='string'&&
        typeof finalStatus.retainedFile?.path==='string','The original upload did not publish its complete exact archive.');
      report.upload??={declaration,first,prefixReplay,prefixStatus,completion,finalStatus};
      await save('ORIGINAL_UPLOADED');
      const imported=await client.dispatch('source.receive',{archiveFile:finalStatus.archiveFile,
        sha256:finalStatus.sha256,id:'wri-geothermal'});
      check(imported.editionSha256===EXPECTED_EDITION,'The native source receiving changed the reviewed edition.');
      state.selectionInput??={editionId:'wri-geothermal',requestId:state.selectionRequestId,
        expectedSelectionHash:(await client.status()).selectionHash};
      await save('SOURCE_SELECTION_PREPARED');
      const selection=await client.dispatch('source.select',state.selectionInput);
      check(same(selection,await client.dispatch('source.select',state.selectionInput)),
        'The retained source selection request did not return its original result.');
      report.checks.nativeResumableUpload=true;
      const sourceFile=await provider.call('merchant_datasette_file',{workspace:'wri',
        path:finalStatus.retainedFile.path,sha256:EXPECTED_ARCHIVE});
      check(sourceFile.native.sha256===EXPECTED_ARCHIVE&&Number(sourceFile.native.bytes)===input.length,
        'The installed provider did not inspect the exact retained source archive.');
      const downloadUrl=new URL('/api/download',server.url);
      downloadUrl.searchParams.set('path',finalStatus.retainedFile.path);
      downloadUrl.searchParams.set('sha256',EXPECTED_ARCHIVE);
      const downloaded=await fetch(downloadUrl,{redirect:'error',signal:AbortSignal.timeout(30000),
        headers:{'X-Datasette-Workspace-ID':workspace.workspaceId}});
      check(downloaded.status===200&&downloaded.headers.get('x-datasette-sha256')===EXPECTED_ARCHIVE,
        'The original pinned HTTP download did not return the selected archive.');
      const receivedInput=Buffer.from(await downloaded.arrayBuffer());
      check(receivedInput.length===input.length&&hash(receivedInput)===EXPECTED_ARCHIVE,
        'The complete HTTP archive bytes differ from the retained original edition.');
      report.interfaces={provider:'ORIGINAL_COMPOSED_DATASETTE_PROVIDER',sourceFile,
        download:{bytes:receivedInput.length,sha256:hash(receivedInput),status:downloaded.status}};
      report.checks.nativeComposedProvider=true;
      report.checks.completePinnedHTTPDownload=true;
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
      state.reviewInput??={runId,requestId:state.reviewRequestId,reviewer:'Datasette integrated programme',
        note:'Original WRI edition, complete retained capture and publisher candidate reviewed before initialization.',initialize:true};
      await save('REVIEW_PREPARED');
      const review=await client.dispatch('publisher.review',state.reviewInput);
      check(same(review,await client.dispatch('publisher.review',state.reviewInput)),
        'Review replay created a different original review or run result.');
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
      state.buyerInput??={runId,requestId:state.buyerRequestId,intentId:buyerIntentId,
        acceptIndex:0,offerSha256:offer.offerSha256,query:'limit=5'};
      await save('BUYER_REQUEST_PREPARED');
      const buyer=await client.dispatch('publisher.prepare-buyer',state.buyerInput);
      check(same(buyer,await client.dispatch('publisher.prepare-buyer',state.buyerInput)),
        'Buyer request replay created a different original configuration or file.');
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
      report.requests={};
      for(const requestId of [state.selectionRequestId,state.requestId,state.reviewRequestId,state.buyerRequestId]) {
        const original=await client.dispatch('requests.inspect',{requestId});
        check(original.state==='COMPLETE'&&original.requestId===requestId,
          'An original operator request has no complete retained native result.');
        report.requests[requestId]=original;
      }
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
    let nativeCLI=createDatasetteClient({url:cliServer.announcement.url,expectedWorkspaceId:receiveId});
    const cliHealth=await nativeCLI.health();
    const cliStatus=await command(['status','--url',cliServer.announcement.url,'--expected-workspace-id',receiveId]);
    check(cliHealth.workspaceId===receiveId&&cliStatus.value.workspaceId===receiveId,'The actual CLI server could not reopen the complete received workspace.');
    const shutdownDeclaration={uploadId:state.shutdownUploadId,name:'wri-geothermal.sfds.gz',
      bytes:String(input.length),sha256:EXPECTED_ARCHIVE},shutdownSplit=Math.floor(input.length/2);
    await save('CLI_SHUTDOWN_UPLOAD_PREPARED');
    if(!report.managedUpload?.resumed) {
      const prefix=await nativeCLI.uploadChunk({...shutdownDeclaration,offset:'0',length:String(shutdownSplit)},
        input.subarray(0,shutdownSplit));
      if(!report.managedUpload?.shutdown) {
        check(prefix.state==='RECEIVING'&&prefix.receivedBytes===String(shutdownSplit)&&
          prefix.prefixSha256===hash(input.subarray(0,shutdownSplit)),
          'The managed upload did not retain its original first chunk.');
        const pending=incompleteUpload(cliServer.announcement.url,receiveId,shutdownDeclaration,input,shutdownSplit);
        let activeStatus,terminal;
        try {
          const deadline=Date.now()+10000;
          while(Date.now()<deadline) {
            const current=await nativeCLI.status({signal:AbortSignal.timeout(2000)});
            if(current.active?.operation==='files.upload'&&current.active.operationId===state.shutdownUploadId) {
              activeStatus={workspaceId:current.workspaceId,active:current.active};break;
            }
            await delay(10);
          }
          check(activeStatus,'The native CLI did not admit the original incomplete upload.');
          terminal=await cliServer.close();cliServer=null;
        } finally { pending.request.destroy(); }
        report.managedUpload={declaration:shutdownDeclaration,prefix,
          interrupted:{input:pending.input,offeredBytes:pending.offeredBytes,active:activeStatus,
            transport:await pending.result},
          shutdown:{code:terminal.code,signal:terminal.signal,stderr:terminal.stderr,
            startedAt:terminal.startedAt,completedAt:terminal.completedAt,
            instanceId:cliHealth.instanceId,workspaceId:receiveId}};
        await save('CLI_UPLOAD_INTERRUPTED');
      }
      if(!cliServer) {
        cliServer=await launchCLI(receivedDirectory,receiveId);
        nativeCLI=createDatasetteClient({url:cliServer.announcement.url,expectedWorkspaceId:receiveId});
      }
      const restarted=await nativeCLI.health(),durable=await nativeCLI.uploadStatus({uploadId:state.shutdownUploadId});
      check(restarted.workspaceId===receiveId&&
        restarted.instanceId!==report.managedUpload.shutdown.instanceId,
        'Managed restart did not reopen the same original workspace in a new instance.');
      if(durable.state==='FINALIZABLE') {
        check(durable.receivedBytes===shutdownDeclaration.bytes&&durable.prefixSha256===EXPECTED_ARCHIVE,
          'The original finalizable managed upload changed its complete prefix.');
        await nativeCLI.uploadChunk({...shutdownDeclaration,offset:shutdownDeclaration.bytes,length:'0'},Buffer.alloc(0));
      } else if(durable.state!=='COMPLETE') {
        check(durable.state==='RECEIVING'&&durable.receivedBytes===String(shutdownSplit)&&
          durable.prefixSha256===hash(input.subarray(0,shutdownSplit)),
          'Managed shutdown changed the original durable upload prefix.');
        const completion=await nativeCLI.uploadChunk({...shutdownDeclaration,offset:durable.receivedBytes,
          length:String(input.length-Number(durable.receivedBytes))},input.subarray(Number(durable.receivedBytes)));
        if(completion.state==='FINALIZABLE')
          await nativeCLI.uploadChunk({...shutdownDeclaration,offset:shutdownDeclaration.bytes,length:'0'},Buffer.alloc(0));
      }
      const resumed=await nativeCLI.uploadStatus({uploadId:state.shutdownUploadId});
      check(resumed.state==='COMPLETE'&&resumed.uploadId===state.shutdownUploadId&&
        resumed.sha256===EXPECTED_ARCHIVE&&resumed.receivedBytes===String(input.length),
        'The same managed upload did not finish with all original archive bytes.');
      report.managedUpload={...report.managedUpload,restarted,durable,resumed};
      await save('CLI_UPLOAD_RESUMED');
    } else {
      const original=await nativeCLI.uploadStatus({uploadId:state.shutdownUploadId});
      check(original.state==='COMPLETE'&&original.sha256===EXPECTED_ARCHIVE&&
        original.receivedBytes===String(input.length),'The completed managed upload changed during programme recovery.');
    }
    state.receivedSelectionInput??={editionId:'wri-geothermal',query:'receiving-edit',
      requestId:state.receivedSelectionRequestId,expectedSelectionHash:(await nativeCLI.status()).selectionHash};
    await save('RECEIVED_EDIT_PREPARED');
    const changed=await nativeCLI.dispatch('source.select',state.receivedSelectionInput);
    check(changed.query==='receiving-edit','The independent received source could not be edited.');
    const terminal=await cliServer.close();cliServer=null;
    report.cli={announcement:cliHealth,shutdown:{code:terminal.code,signal:terminal.signal,stderr:terminal.stderr}};
    await save('CLI_EDITED');
    const replayReceive=await command(['receive-workspace','--archive-file',archive.archiveFile,'--sha256',archive.sha256,
      '--destination',receivedDirectory]);
    check(replayReceive.value.reused===true,'Standalone CLI receiving did not reconcile the original completed transfer.');
    received=await openDatasetteWorkspace({directory:receivedDirectory});
    check((await received.status()).selection.query==='receiving-edit','Receive replay overwrote the later edit.');
    const oldChoice=await received.dispatch('source.select',state.selectionInput);
    check(oldChoice.query==='data'&&(await received.status()).selection.query==='receiving-edit',
      'Replaying an older completed source request overwrote the later reviewed choice.');
    for(const [requestId,before] of Object.entries(report.requests)) {
      const original=await received.dispatch('requests.inspect',{requestId});
      check(original.state==='COMPLETE'&&original.requestHash===before.requestHash&&
        same(original.input,before.input)&&same(original.result,before.result),
        'Receiving changed the original accepted request or its complete native result.');
    }
    if(report.sourceRefresh?.state!=='COMPLETE') {
      const attemptedAt=new Date().toISOString(),operationId=state.refreshOperationId;
      await save('SOURCE_REFRESH_STARTED');
      const progress={operationId,editionId:state.refreshEditionId,attemptedAt};
      try {
        const baseline=await readDatasetteEdition(join(receivedDirectory,'editions','wri-geothermal','edition.json'),
          {expectedSha256:EXPECTED_EDITION});
        progress.capture=await received.dispatch('source.capture',{operationId,selection:baseline.capture.selection});
        progress.review=await received.dispatch('source.review',{operationId,
          key:baseline.review.key.columns,projection:baseline.review.projection});
        progress.edition=await received.dispatch('editions.create',{id:state.refreshEditionId,operationId,
          name:'WRI geothermal current original-source edition',key:baseline.review.key.columns,
          projection:baseline.review.projection});
        progress.comparison=await received.dispatch('editions.compare',{left:'wri-geothermal',right:state.refreshEditionId});
        report.sourceRefresh={...progress,state:'COMPLETE',completedAt:new Date().toISOString()};
      } catch(error) {
        report.sourceRefresh={...progress,state:'FAILED',completedAt:new Date().toISOString(),
          error:{code:error.code??error.name,message:error.message,status:error.status??null,
            cause:error.cause?{code:error.cause.code??error.cause.name,message:error.cause.message}:null}};
      }
      await save('SOURCE_REFRESH_RETAINED');
    }
    const unchanged=await received.status();
    check(unchanged.selection.editionSha256===EXPECTED_EDITION&&unchanged.selection.query==='receiving-edit',
      'The fresh source comparison changed the original selected publication.');
    if(!report.mcpReceiving?.passed) {
      server=await startDatasetteServer({workspace:received,host:'127.0.0.1',port:state.mcpNativePort??0});
      const mcpPort=Number(new URL(server.url).port);
      if(state.mcpNativePort!==undefined)check(state.mcpNativePort===mcpPort,'The original receiving listener port changed.');
      state.mcpNativePort=mcpPort;
      const connectionFile=join(directory,'mcp-native-server.json');
      await privateJson(connectionFile,{schema:'stellar-forge.datasette-server.v1',url:server.url,
        workspaceId:server.workspaceId,instanceId:server.instanceId,directory:server.directory,pid:process.pid});
      const originalEdition=await readDatasetteEdition(join(receivedDirectory,'editions','wri-geothermal','edition.json'),
        {expectedSha256:EXPECTED_EDITION});
      const workspaceArchive=await received.dispatch('files.inspect',{
        path:report.receiving.originalArchive,sha256:report.archive.sha256});
      const originalDatabase=await received.dispatch('files.inspect',{path:'publisher/publisher.sqlite'});
      const receivingInput={sourceRoot:resolve(dirname(fileURLToPath(import.meta.url)),'../../../..'),
        connectionFile,outputDirectory:join(directory,'mcp-receiving'),workspaceAlias:'wri',
        expectedWorkspaceId:receiveId,editionId:'wri-geothermal',expectedEditionSha256:EXPECTED_EDITION,
        captureId:originalEdition.capture.operationId,expectedCaptureSha256:originalEdition.captureSha256,
        expectedRows:189,workspaceArchive:{path:workspaceArchive.path,bytes:workspaceArchive.bytes,sha256:workspaceArchive.sha256},
        requiredNativeFiles:[{path:originalDatabase.path,bytes:originalDatabase.bytes,sha256:originalDatabase.sha256}],
        originalUpload:report.upload.declaration};
      if(state.mcpReceivingInput)check(same(state.mcpReceivingInput,receivingInput),
        'The original MCP receiving operation selected different retained inputs.');
      else state.mcpReceivingInput=receivingInput;
      await privateJson(join(directory,'mcp-receiving-input.json'),state.mcpReceivingInput);
      await save('MCP_RECEIVING_PREPARED');
      report.mcpReceiving=await runDatasetteMcpReceiving(state.mcpReceivingInput);
      check(report.mcpReceiving.passed&&report.mcpReceiving.state==='COMPLETE',
        'The original MCP receiving did not retain its complete source files.');
      await save('MCP_RECEIVED');
      await server.close();server=null;
    }
    if(report.sourceRefresh?.state!=='COMPLETE') {
      await save('SOURCE_REFRESH_REQUIRED');
      throw Object.assign(new Error('Continue the original source acquisition '+state.refreshOperationId+
        ' to complete its fresh edition and comparison; the publisher and receiving results are retained.'),
        {code:'DATASETTE_SOURCE_REFRESH_INCOMPLETE'});
    }
    const last=await received.dispatch('workspace.export',{outputFile:join(directory,'editable-received-workspace.zip')});
    await received.close();received=null;
    report.cli.receiveReused=replayReceive.value.reused;
    report.editedArchive={archiveFile:last.archiveFile,sha256:last.sha256,bytes:last.bytes,snapshotSha256:last.snapshotSha256};
    report.checks={...report.checks,originalOperationCatalog:true,retainedProgrammeIdentities:true,
      planReplay:true,originalRequestHistory:true,sourceSelectionReplay:true,reviewRequestReplay:true,buyerRequestReplay:true,
      earlierRequestPreservesLaterSelection:true,originalExtraction:true,allOriginalRowsPublished:true,
      concurrentPublisherStatus:true,reviewedNativePublication:true,originalSellerMetadata:true,
      originalBuyerPreparation:true,sourceRetainingRelease:true,originalStagedReleaseHistoryRetained:true,
      completePublisherDatabase:true,publisherHistoryUnchanged:true,relocatedPublisherReopened:true,
      sqlitePreimageRetained:true,independentVersionStore:true,
      receivedReleasePreparedFromSameSnapshot:true,nativeCLIServer:true,
      standaloneCLIReceiving:true,receivedSourceEditable:true,replayPreservesEdits:true,
      managedCLIUploadShutdown:true,sameUploadPrefixResumed:true,completeMcpReceiving:true,
      interruptedDownloadResumed:true,allSeventeenMerchantTools:true,
      freshOriginalSourceAttemptRetained:true,freshOriginalSourceComparisonComplete:true,
      originalPublicationSelectionPreserved:true};
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
