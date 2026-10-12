// MIT. Receive the original OpenCage product through saved managed Applications.
import {readFile,open,mkdir,link,rename,unlink,realpath,lstat} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {join,resolve,dirname,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {request as httpRequest} from 'node:http';
import {parseArgs} from 'node:util';
import {setTimeout as pause} from 'node:timers/promises';
import {inspectMerchantRuntime} from '../../../sf46-release/runtime-package.mjs';

export const OPENCAGE_APPLICATION_RECEIVING='commons.scf-opencage-application-receiving/v1';
const COMPONENT='stellar/scf-starforge-20261009/sf30-seller-sdk/opencage';
const SHA=/^[a-f0-9]{64}$/;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const need=(value,message)=>{if(!value)throw Error(message);};
const importFile=path=>import(pathToFileURL(path).href);
async function originalFile(path,expected){
  path=resolve(path);
  need(await realpath(path)===path&&(await lstat(path)).isFile(),'Select the original canonical regular file.');
  const bytes=await readFile(path);if(expected)need(sha(bytes)===expected,'Original selected file changed: '+path);
  return bytes;
}
async function optional(path){try{return JSON.parse(await originalFile(path));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function publish(path,value,{immutable=false}={}){
  const bytes=Buffer.isBuffer(value)?value:json(value);await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(immutable){try{need((await originalFile(path)).equals(bytes),'Original receiving output changed.');return;}catch(error){if(error.code!=='ENOENT')throw error;}}
  const temp=path+'.next-'+randomUUID(),handle=await open(temp,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();await handle.close();
    if(immutable){await link(temp,path);await unlink(temp);}else await rename(temp,path);
    const directory=await open(dirname(path),'r');try{await directory.sync();}finally{await directory.close();}
  }finally{await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});}
}
function childPath(root,name){
  const path=resolve(root,name),selected=relative(root,path).split('\\').join('/');
  need(selected===name&&!selected.startsWith('../')&&selected!==''&&!name.startsWith('/'),'Select an original relative file.');
  return path;
}
async function nativeResult(selected){
  need(selected&&SHA.test(selected.requestSha256)&&SHA.test(selected.resultSha256)&&SHA.test(selected.artifactsSha256),
    'Pin the original completed native request, result and artifact inventory.');
  const directory=resolve(selected.record);
  const requestBytes=await originalFile(join(directory,'request.json'),selected.requestSha256);
  const resultBytes=await originalFile(join(directory,'result.json'),selected.resultSha256);
  const artifactsBytes=await originalFile(join(directory,'artifacts.json'),selected.artifactsSha256);
  const request=JSON.parse(requestBytes),result=JSON.parse(resultBytes),artifacts=JSON.parse(artifactsBytes);
  need(Array.isArray(artifacts.files)&&Array.isArray(artifacts.errors)&&artifacts.errors.length===0,
    'Complete the original native artifact retention.');
  need(result.state==='completed'&&result.exit_code===0&&!result.stop_requested,'Use the completed native release continuation.');
  const project=resolve(request.intent.project),args=request.intent.command;
  const at=args.indexOf('--output');need(at>=0&&args[at+1],'Select the original receiving command output.');
  const output=resolve(args[at+1]);need(output===join(project,'run'),'The original receiving output no longer joins its project.');
  const files=new Map(artifacts.files.map(file=>[file.path,file]));
  need(files.size===artifacts.files.length,'Native artifact names must be unique.');
  async function retained(name){
    const path=childPath(output,name),key=relative(project,path).split('\\').join('/'),file=files.get(key);
    need(file,'Select a file from the original native artifact inventory: '+name);
    const bytes=await originalFile(path,file.sha256);need(bytes.length===file.bytes,'Original retained byte count changed.');
    return bytes;
  }
  const report=JSON.parse(await retained('journey.json'));
  need(report.schema==='commons.scf-opencage-release-completion/v1'&&report.outcome==='COMPLETE'&&
    report.receiving.operationId===request.intent.operation_id&&report.receiving.requestSha256===selected.requestSha256,
    'Use the complete original OpenCage release result.');
  const names=new Set(report.stages.map(value=>value.name));
  for(const name of ['original-buyer-and-customer-deliveries-joined','same-mcp-workspaces-and-buyer-reopened',
    'same-package-staged-from-adopted-source','original-price-activated-and-stopped',
    'revised-price-and-original-rollback','managed-native-started-and-stopped',
    'managed-native-same-workspace-reopened','mcp-installed-restart'])need(names.has(name),'Original release stage is missing: '+name);
  const previous=report.original;
  const previousRequestBytes=await originalFile(join(previous.record,'request.json'),previous.requestSha256);
  const previousResultBytes=await originalFile(join(previous.record,'result.json'),previous.resultSha256);
  const previousArtifactsBytes=await originalFile(join(previous.record,'artifacts.json'),previous.artifactsSha256);
  const previousRequest=JSON.parse(previousRequestBytes),previousResult=JSON.parse(previousResultBytes);
  const previousArtifacts=JSON.parse(previousArtifactsBytes);
  need(previousRequest.intent.operation_id===previous.operationId&&previousResult.state==='failed'&&previousResult.exit_code===1&&
    Array.isArray(previousArtifacts.errors)&&previousArtifacts.errors.length===0,'Retain the original completed Buyer/customer history.');
  const previousProject=resolve(previousRequest.intent.project),atPrevious=previousRequest.intent.command.indexOf('--output');
  need(atPrevious>=0,'The original MCP output is absent.');
  const previousOutput=resolve(previousRequest.intent.command[atPrevious+1]);
  const manifestPath=childPath(previousOutput,'received-main/manifest.json');
  const manifestKey=relative(previousProject,manifestPath).split('\\').join('/');
  const entry=previousArtifacts.files.find(file=>file.path===manifestKey);
  need(entry,'The original native run did not retain the customer manifest.');
  const customerManifestBytes=await originalFile(manifestPath,entry.sha256),customerManifest=JSON.parse(customerManifestBytes);
  need(customerManifestBytes.length===entry.bytes&&sha(customerManifestBytes)===previous.customer.manifestSha256,
    'The original complete customer manifest changed.');
  const reopened=JSON.parse(await retained('reopened-status.json'));
  need(reopened.deliveryIdentity===customerManifest.identity&&reopened.responseSha256===previous.buyer.responseSha256,
    'The completed release no longer joins the same customer response.');
  return {report,reopened,customerManifest,customerManifestBytes,binding:{
    operationId:request.intent.operation_id,record:directory,requestSha256:selected.requestSha256,
    resultSha256:selected.resultSha256,artifactsSha256:selected.artifactsSha256,
    previousOperation:previous.operationId,previousRecord:previous.record,
    responseSha256:reopened.responseSha256,deliveryIdentity:reopened.deliveryIdentity}};
}
function sessionRead(address,path,{limit=8388608,authenticated=true}={}){
  const url=new URL(address);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&/^#[a-f0-9]{64}$/.test(url.hash),
    'Use the original authenticated loopback instance.');
  return new Promise((accept,reject)=>{
    const call=httpRequest({hostname:'127.0.0.1',port:Number(url.port||80),method:'GET',path,agent:false,
      headers:authenticated?{authorization:'Bearer '+url.hash.slice(1)}:{}},response=>{
      const parts=[];let bytes=0;
      response.on('data',part=>{bytes+=part.length;if(bytes>limit)call.destroy(Error('The selected output exceeds its original byte limit.'));else parts.push(part);});
      response.once('error',reject);response.once('end',()=>accept({status:response.statusCode,bytes:Buffer.concat(parts)}));
    });
    call.once('error',reject);call.setTimeout(15000,()=>call.destroy(Error('Original listener read timed out.')));call.end();
  });
}
async function closed(address){
  const url=new URL(address);
  try{await new Promise((accept,reject)=>{
    const call=httpRequest({hostname:'127.0.0.1',port:Number(url.port||80),path:'/',agent:false},response=>{response.resume();response.once('end',accept);});
    call.once('error',reject);call.setTimeout(2000,()=>call.destroy(Error('timeout')));call.end();
  });return false;}catch(error){return ['ECONNREFUSED','ECONNRESET'].includes(error.code);}
}
async function waitFor(read,accept,message){
  const start=Date.now();let value;
  while(Date.now()-start<120000){value=await read();if(accept(value))return value;await pause(250);}
  throw Error(message);
}

/** Compose the same saved application, original managed home and receiving files.
 * The caller supplies an existing READY runtime from the cumulative installation. */
export async function receiveOpenCageApplication(input){
  need(input?.schema===OPENCAGE_APPLICATION_RECEIVING&&typeof input.operationId==='string'&&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$/.test(input.operationId),'Choose the original stable receiving input.');
  const runtimeDirectory=resolve(input.runtimeDirectory),workspaceDirectory=resolve(input.workspaceDirectory);
  const outputDirectory=resolve(input.outputDirectory);
  need(await realpath(runtimeDirectory)===runtimeDirectory&&await realpath(workspaceDirectory)===workspaceDirectory,
    'Choose original canonical runtime and workspace directories.');
  need(!outputDirectory.startsWith(workspaceDirectory+'/')&&outputDirectory!==workspaceDirectory,
    'Keep receiving outputs outside the original merchant workspace.');
  await mkdir(outputDirectory,{recursive:true,mode:0o700});
  need(await realpath(outputDirectory)===outputDirectory,'Keep original output in its canonical private directory.');
  await publish(join(outputDirectory,'input.json'),input,{immutable:true});
  const inputSha256=sha(json(input)),resultPath=join(outputDirectory,'result.json');
  let report=await optional(resultPath);
  if(report){need(report.schema===OPENCAGE_APPLICATION_RECEIVING&&report.inputSha256===inputSha256,'Use this receiving operation with its original input.');
    if(report.status==='COMPLETE')return report;
  }else report={schema:OPENCAGE_APPLICATION_RECEIVING,operationId:input.operationId,inputSha256,
    status:'PREPARING',startedAt:new Date().toISOString(),stages:[],runs:[]};
  const save=()=>publish(resultPath,report);
  const mark=async(name,details={})=>{let value=report.stages.find(row=>row.name===name);
    if(!value){value={name,at:new Date().toISOString(),...details};report.stages.push(value);await save();}
    return value;};
  const producer=await nativeResult(input.completedNative);
  const expected=producer.reopened;
  need(expected.requestId==='mcp-native-reverse'&&expected.decisionRevision===1,'Select the original reviewed source request.');
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const currentRuntime={directory:runtime.directory,sourceRoot:runtime.sourceRoot,sourceCommit:runtime.sourceCommit,
    sourceManifestSha256:runtime.sourceManifestSha256,profileId:runtime.profileId};
  if(report.runtime)need(JSON.stringify(report.runtime)===JSON.stringify(currentRuntime),'Keep the same installed receiving runtime.');
  else report.runtime=currentRuntime;
  report.original=producer.binding;await save();
  const component=join(runtime.sourceRoot,COMPONENT),distribution=join(runtime.sourceRoot,'stellar/scf-starforge-20261009/distribution/runtime-workspace');
  const [{createRuntimeWorkspace,openRuntimeWorkspace},{startRuntimeWorkspace},{managedCommandAlive},launch,{GeocodeDelivery},{createGeocodeServer}]
    =await Promise.all([importFile(join(distribution,'model.mjs')),importFile(join(distribution,'server.mjs')),
      importFile(join(distribution,'managed-workspace.mjs')),importFile(join(component,'launch.mjs')),
      importFile(join(component,'customer.mjs')),importFile(join(component,'server.mjs'))]);
  const selection=await launch.prepareGeocodeManagedSelection({workspaceDirectory,sourceDirectory:component});
  need(selection.workspace.workspaceIdentity===expected.workspaceIdentity,'The managed source opened a different original workspace.');
  await publish(join(outputDirectory,'source-selection.json'),selection,{immutable:true});
  const controller=join(outputDirectory,'applications');
  if(!await optional(join(controller,'workspace.json')))await createRuntimeWorkspace({directory:controller});
  let model=await openRuntimeWorkspace({directory:controller}),applicationId=report.applicationId;
  let activeOperation=null,runtimeServer=null,customerServer=null,browser=null,failure=null;
  const current=async()=>(await model.applicationsState()).applications.find(value=>value.id===applicationId);
  async function start(label){
    let application=await current(),run;
    if(application?.current?.active||['PENDING','QUEUED','STARTING','RUNNING','INTERRUPTED'].includes(application?.phase)){
      run=report.runs.find(value=>value.requestId===application.current?.id);
      need(run,'Reconcile the different retained application operation before this receiving.');
      activeOperation=run.requestId;
      if(!application.current.active&&['PENDING','QUEUED','INTERRUPTED'].includes(application.phase))
        await model.applicationsRecover({applicationId,operationId:run.requestId});
    }else{
      const previous=report.runs.filter(value=>value.label===label).at(-1);
      run=previous&&!previous.startedAt&&!previous.stoppedAt&&application?.current?.id!==previous.requestId?previous:
        {label,requestId:randomUUID(),...(previous?{continuationOf:previous.requestId}:{})};
      if(!report.runs.includes(run)){report.runs.push(run);await save();}
      if(!run.reviewId){const review=await model.applicationsStartReview({applicationId});run.reviewId=review.id;await save();}
      activeOperation=run.requestId;
      await model.applicationsStart({applicationId,requestId:run.requestId,reviewId:run.reviewId});
    }
    application=await waitFor(current,value=>value?.phase==='RUNNING'&&Boolean(value.current?.privateUrl),
      'The original OpenCage Applications startup has not completed.');
    need(application.current.id===run.requestId,'Open the same reviewed application operation.');
    const original=application.current.url?.original,address=application.current.privateUrl;
    need(original?.schema==='stellar-forge.opencage-application-startup.v1'&&
      original.workspaceIdentity===expected.workspaceIdentity&&original.directory===workspaceDirectory&&
      original.configurationSha256===selection.workspace.configurationSha256&&
      original.selectionSha256===selection.sha256&&original.sourceSha256===selection.source.sha256,
      'The retained startup differs from the selected source and original workspace.');
    const identity=await sessionRead(address,'/api/managed-launch'),actual=JSON.parse(identity.bytes);
    need(identity.status===200&&Object.keys(actual).length===Object.keys(original).length&&
      Object.entries(original).every(([key,value])=>actual[key]===value),'The live native instance differs from the retained original startup.');
    const denied=await sessionRead(address,'/api/managed-launch',{authenticated:false});
    need(denied.status===401,'The managed native identity must require its original session.');
    run.startedAt??=new Date().toISOString();run.instanceId=actual.instanceId;run.sourceSha256=actual.sourceSha256;
    run.selectionSha256=actual.selectionSha256;run.origin=new URL(address).origin;await save();
    return {run,address,application,original};
  }
  async function stop(run,{cleanup=false}={}){
    need(report.runs.includes(run),'Stop only this receiving operation\'s saved application run.');
    const observed=async()=>{
      const application=await current();
      const operation=application?.current?.id===run.requestId?application.current:
        application?.runs?.find(value=>value.id===run.requestId);
      need(operation,'Keep the original application run available during shutdown.');
      const address=operation.privateUrl??operation.url?.url;
      if(!run.origin&&address){
        const url=new URL(address);
        need(url.protocol==='http:'&&url.hostname==='127.0.0.1','Keep the original loopback listener.');
        run.origin=url.origin;
      }
      const commandActive=await managedCommandAlive(operation.state);
      return {application,operation,commandActive,listenerClosed:!operation.active&&!commandActive&&
        (!run.origin||await closed(run.origin))};
    };
    const original=await observed();
    if(original.operation.active||original.commandActive||!original.listenerClosed||
      original.application?.phase!=='STOPPED'||original.application.current?.id!==run.requestId)
      await model.applicationsStop({applicationId,operationId:run.requestId});
    const ended=await waitFor(observed,value=>value.operation.active===false&&!value.commandActive&&value.listenerClosed&&
      (cleanup||(value.application.phase==='STOPPED'&&value.application.current?.id===run.requestId)),
      'The original saved OpenCage worker or listener has not stopped.');
    if(ended.application.phase==='STOPPED'&&ended.application.current?.id===run.requestId)
      run.stoppedAt??=new Date().toISOString();
    if(cleanup)run.cleanup={drainedAt:new Date().toISOString(),phase:ended.operation.phase,
      workerActive:false,commandActive:false,listenerClosed:true};
    activeOperation=null;await save();
  }
  async function retained(address){
    const requests=await sessionRead(address,'/api/request?id='+encodeURIComponent(expected.requestId));
    const request=JSON.parse(requests.bytes);
    const response=await sessionRead(address,'/api/export?id='+encodeURIComponent(expected.exportId));
    const delivery=JSON.parse(response.bytes);
    need(requests.status===200&&request.responseSha256===expected.responseSha256&&request.decision.revision===1&&
      request.decision.current.index===0&&response.status===200&&delivery.identity===expected.deliveryIdentity,
      'The running saved application changed the original selected source or complete customer delivery.');
    return {requestId:expected.requestId,responseSha256:expected.responseSha256,decisionRevision:1,
      selectedIndex:0,exportId:expected.exportId,deliveryIdentity:expected.deliveryIdentity};
  }
  try{
    const attached=await model.attach({directory:runtimeDirectory,label:input.label??'Original OpenCage installed workshare'});
    let homeId;
    if(input.managedHomeDirectory){
      const home=await model.openManagedHome({directory:resolve(input.managedHomeDirectory),label:'Original installed merchant runtime'});
      homeId=home.homeId??home.home?.id??home.id;need(homeId,'Open the original managed home.');
    }
    if(!applicationId){
      if(!report.reviewId){
        const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'opencage-workspace',
          settings:{workspaceDirectory,port:0},label:input.label??'OpenCage source review and customer delivery',...(homeId?{homeId}:{})});
        report.reviewId=review.id;report.saveRequestId=randomUUID();await save();
      }
      const saved=await model.applicationsSave({requestId:report.saveRequestId,reviewId:report.reviewId});
      applicationId=report.applicationId=saved.applicationId;await save();
      if(saved.connectionError)await model.applicationsConnect({applicationId});
    }
    const awaiting=await current();
    if(awaiting?.phase==='CONNECTING')await model.applicationsConnect({applicationId});
    await waitFor(current,value=>['READY','STOPPED'].includes(value?.phase)||
      (['PENDING','QUEUED','STARTING','RUNNING','INTERRUPTED'].includes(value?.phase)&&
        report.runs.some(run=>run.requestId===value.current?.id)),
      'The original reviewed runtime adoption or saved run is not ready to continue.');
    await mark('original-application-reviewed-and-saved',{applicationId,runtimeId:attached.runtimeId,
      workspaceIdentity:selection.workspace.workspaceIdentity,selectionSha256:selection.sha256,sourceSha256:selection.source.sha256});
    const first=await start('first-open');
    await mark('original-application-started',{applicationId,operationId:first.run.requestId,instanceId:first.original.instanceId,
      ...await retained(first.address)});
    const receiving=join(outputDirectory,'customer');
    for(const file of producer.customerManifest.files){
      const response=await sessionRead(first.address,'/api/export-file?id='+encodeURIComponent(expected.exportId)+'&name='+encodeURIComponent(file.name),
        {limit:Math.max(1,file.bytes)});
      need(response.status===200&&response.bytes.length===file.bytes&&sha(response.bytes)===file.sha256,
        'Original managed export changed: '+file.name);
      await publish(childPath(receiving,file.name),response.bytes,{immutable:true});
    }
    await publish(join(receiving,'manifest.json'),producer.customerManifestBytes,{immutable:true});
    const delivery=await GeocodeDelivery.open(receiving);
    need(delivery.identity===expected.deliveryIdentity&&delivery.responseSha256===expected.responseSha256,
      'Reopened managed customer delivery differs from the original.');
    await mark('complete-customer-received',{deliveryIdentity:delivery.identity,responseSha256:delivery.responseSha256,
      files:producer.customerManifest.files.length,bytes:producer.customerManifest.files.reduce((n,file)=>n+file.bytes,0),
      manifestSha256:sha(producer.customerManifestBytes)});
    if(input.browser){
      const {chromium}=await importFile(resolve(input.browser.playwright));
      browser=await chromium.launch({executablePath:resolve(input.browser.chromium),headless:true,
        args:['--no-sandbox','--disable-dev-shm-usage','--disable-gpu']});
      runtimeServer=await startRuntimeWorkspace({directory:controller,port:0});
      customerServer=await createGeocodeServer({delivery,port:0});
      const errors=[],applicationsPage=await browser.newPage({viewport:{width:1440,height:1060}});
      applicationsPage.on('pageerror',error=>errors.push(error.message));
      await applicationsPage.goto(runtimeServer.url);await applicationsPage.getByRole('button',{name:'Applications',exact:true}).click();
      await applicationsPage.locator('#applications-workspace').getByText(input.label??'OpenCage source review and customer delivery',{exact:true}).first().waitFor();
      await applicationsPage.screenshot({path:join(outputDirectory,'applications.png'),fullPage:true});
      const operatorPage=await browser.newPage({viewport:{width:1440,height:1060}});
      operatorPage.on('pageerror',error=>errors.push(error.message));
      await operatorPage.goto(first.address);
      await operatorPage.getByRole('button',{name:expected.requestId,exact:true}).click();
      await operatorPage.waitForFunction(id=>document.querySelector('#review-id')?.textContent===id,expected.requestId);
      need(await operatorPage.locator('#candidate-list input[type=radio]').first().isChecked(),'The managed browser differs from the saved candidate decision.');
      await operatorPage.screenshot({path:join(outputDirectory,'operator.png'),fullPage:true});
      const customerPage=await browser.newPage({viewport:{width:1100,height:900}});
      customerPage.on('pageerror',error=>errors.push(error.message));
      await customerPage.goto(customerServer.url);
      await customerPage.waitForFunction(()=>document.querySelector('#review-state')?.textContent==='CANDIDATES');
      await customerPage.screenshot({path:join(outputDirectory,'customer.png'),fullPage:true});
      need(errors.length===0,'The original managed or customer browser reported an error: '+errors.join('; '));
      await mark('original-applications-operator-and-customer-browsers',{applicationId,workspaceIdentity:expected.workspaceIdentity,
        deliveryIdentity:expected.deliveryIdentity,browserErrors:errors});
      await browser.close();browser=null;
      await customerServer.close();customerServer=null;await runtimeServer.close();runtimeServer=null;
    }
    await stop(first.run);
    await model.close();model=await openRuntimeWorkspace({directory:controller});
    const reopened=await start('same-application-reopened');
    need(reopened.original.instanceId!==first.original.instanceId,'The reopened application reused an ended process.');
    await mark('same-application-and-customer-reopened',{applicationId,operationId:reopened.run.requestId,
      instanceId:reopened.original.instanceId,...await retained(reopened.address)});
    await stop(reopened.run);
    const final=await current();
    report.status='COMPLETE';delete report.error;delete report.cleanupError;report.completedAt=new Date().toISOString();
    report.application={id:applicationId,revision:final.revision,phase:final.phase,home:final.home,release:final.release,
      workspaceDirectory,selectionSha256:selection.sha256,customerDirectory:receiving};
    await save();return report;
  }catch(error){
    failure=error;report.status='INCOMPLETE';report.error={code:error.code??'OPENCAGE_APPLICATION_RECEIVING',message:error.message};
    await save().catch(()=>{});throw error;
  }finally{
    await browser?.close().catch(()=>{});await customerServer?.close().catch(()=>{});await runtimeServer?.close().catch(()=>{});
    let cleanupError;
    try{
      if(activeOperation){
        const run=report.runs.find(value=>value.requestId===activeOperation);
        need(run,'Keep the saved application operation for shutdown.');
        await stop(run,{cleanup:true});
      }
    }catch(error){
      cleanupError=error;report.status='INCOMPLETE';report.cleanupError={operationId:activeOperation,
        code:error.code??'OPENCAGE_APPLICATION_SHUTDOWN',message:error.message};
      await save().catch(()=>{});
    }finally{
      try{await model.close();}catch(error){cleanupError??=error;}
    }
    if(cleanupError&&!failure)throw cleanupError;
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{input:{type:'string'}}});
  need(values.input,'Use --input with the exact saved receiving JSON.');
  const report=await receiveOpenCageApplication(JSON.parse(await originalFile(resolve(values.input))));
  console.log(JSON.stringify({status:report.status,operationId:report.operationId,applicationId:report.application.id,
    runtime:report.runtime,stages:report.stages.length,result:join(resolve(JSON.parse(await originalFile(resolve(values.input))).outputDirectory),'result.json')}));
}
