// MIT. Finish the original OpenCage MCP release from its retained Buyer/customer work.
import {readFile,open,mkdir,rename,link,unlink,realpath,lstat} from 'node:fs/promises';
import {createHash,randomUUID,randomBytes} from 'node:crypto';
import {join,resolve,dirname,relative} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';

const {values:args}=parseArgs({options:Object.fromEntries([
  'source','source-manifest','source-manifest-sha256','original-record','original-request-sha256',
  'original-result-sha256','original-artifacts-sha256','native-record','driver-sha256','output',
].map(name=>[name,{type:'string'}]))});
for(const name of Object.keys(args))if(typeof args[name]!=='string'||!args[name])throw Error('Invalid --'+name);
for(const name of ['source','source-manifest','source-manifest-sha256','original-record','original-request-sha256',
  'original-result-sha256','original-artifacts-sha256','native-record','driver-sha256','output'])
  if(!args[name])throw Error('Missing --'+name);
const source=resolve(args.source),output=resolve(args.output),record=resolve(args['native-record']);
const component=join(source,'stellar/scf-starforge-20261009/sf30-seller-sdk/opencage');
const merchant=join(source,'stellar-forge/mcp-merchant-operator');
const digest=value=>createHash('sha256').update(value).digest('hex');
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const requireValue=(value,message)=>{if(!value)throw Error(message);};
const readJson=async path=>JSON.parse(await readFile(path,'utf8'));
const imp=path=>import(pathToFileURL(path).href);
const report={schema:'commons.scf-opencage-release-completion/v1',startedAt:new Date().toISOString(),stages:[]};
async function exactFile(path,expected) {
  requireValue(resolve(path)===await realpath(path),'Keep the canonical original file path');
  const info=await lstat(path);requireValue(info.isFile(),'Use the original regular file');
  const bytes=await readFile(path);
  if(expected)requireValue(digest(bytes)===expected,'Original file hash changed: '+path);
  return bytes;
}
async function atomic(path,value,{replace=false}={}) {
  const bytes=Buffer.isBuffer(value)?value:jsonBytes(value);
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  if(!replace){try{requireValue((await exactFile(path)).equals(bytes),'Retained output changed');return;}catch(error){if(error.code!=='ENOENT')throw error;}}
  const temp=path+'.next-'+randomUUID(),handle=await open(temp,'wx',0o600);
  try{
    await handle.writeFile(bytes);await handle.sync();await handle.close();
    if(replace)await rename(temp,path);else{await link(temp,path);await unlink(temp);}
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await handle.close().catch(()=>{});await unlink(temp).catch(()=>{});}
}
async function stage(name,details) {
  report.stages.push({name,at:new Date().toISOString(),...details});
  await atomic(join(output,'journey.json'),report,{replace:true});
  console.log(JSON.stringify({stage:name,...details}));
}
async function originalRecord() {
  const directory=resolve(args['original-record']);
  const requestBytes=await exactFile(join(directory,'request.json'),args['original-request-sha256']);
  const resultBytes=await exactFile(join(directory,'result.json'),args['original-result-sha256']);
  const manifestBytes=await exactFile(join(directory,'artifacts.json'),args['original-artifacts-sha256']);
  const request=JSON.parse(requestBytes),result=JSON.parse(resultBytes),manifest=JSON.parse(manifestBytes);
  requireValue(result.state==='failed'&&result.exit_code===1&&!result.stop_requested,
    'Retain the original completed Buyer/customer operation and its later stage failure');
  requireValue(Array.isArray(manifest.files)&&Array.isArray(manifest.errors)&&manifest.errors.length===0,'Finish original native artifact retention first');
  const argv=request.intent.command,at=argv.indexOf('--output'),project=resolve(request.intent.project);
  requireValue(at>=0&&argv[at+1],'Original output is not in its admitted command');
  const root=resolve(argv[at+1]);requireValue(root===join(project,'run')&&await realpath(root)===root,
    'Original output no longer joins its native project');
  const files=new Map();
  for(const file of manifest.files){
    requireValue(!files.has(file.path)&&Number.isSafeInteger(file.bytes)&&file.bytes>=0,'Original native artifact inventory is invalid');
    const path=resolve(project,file.path),key=relative(project,path).split('\\').join('/');
    requireValue(key===file.path&&!key.startsWith('../'),'Original artifact escaped its native project');
    const bytes=await exactFile(path,file.sha256);requireValue(bytes.length===file.bytes,'Original native artifact length changed');
    files.set(file.path,{file,bytes});
  }
  const retained=name=>{
    const path=join(root,name),key=relative(project,path).split('\\').join('/');
    requireValue(files.has(key),'The original native run did not declare '+name);return files.get(key).bytes;
  };
  return {directory,request,result,manifest,root,project,retained,binding:{
    operationId:request.intent.operation_id,record:directory,requestSha256:digest(requestBytes),
    resultSha256:digest(resultBytes),artifactsSha256:digest(manifestBytes),files:files.size,
    retainedBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),
  }};
}
function localRead(url,path,{limit=2097152,authenticated=true}={}) {
  const selected=new URL(url);
  requireValue(selected.protocol==='http:'&&selected.hostname==='127.0.0.1'&&/^#[a-f0-9]{64}$/.test(selected.hash),
    'Use the authenticated original managed loopback instance');
  return new Promise((accept,reject)=>{
    const call=httpRequest({hostname:'127.0.0.1',port:Number(selected.port||80),method:'GET',path,agent:false,
      headers:authenticated?{authorization:'Bearer '+selected.hash.slice(1)}:{}},response=>{
      const parts=[];let bytes=0;
      response.on('data',part=>{bytes+=part.length;if(bytes>limit){call.destroy(Error('Original HTTP output exceeds the selected limit'));return;}parts.push(part);});
      response.once('error',reject);response.once('end',()=>accept({status:response.statusCode,headers:response.headers,body:Buffer.concat(parts)}));
    });
    call.setTimeout(10000,()=>call.destroy(Error('Original managed HTTP read timed out')));
    call.once('error',reject);call.end();
  });
}
async function startManaged(selection,environment,verify) {
  const child=spawn(process.execPath,[join(component,'cli.mjs'),'serve','--workspace',selection.workspace.directory,
    '--managed-selection',JSON.stringify(selection),'--port','0'],{env:environment,stdio:['ignore','pipe','pipe'],shell:false});
  let stderr='',buffer='',settled=false;
  const ended=new Promise((accept,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>accept({code,signal}));});
  const ready=new Promise((accept,reject)=>{
    const timeout=setTimeout(()=>{settled=true;reject(Error('Original managed startup timed out'));},30000);
    const fail=error=>{if(!settled){settled=true;clearTimeout(timeout);reject(error);}};
    child.once('error',fail);
    child.once('exit',()=>fail(Error('Original managed process ended before ready')));
    child.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-16384);});
    child.stdout.on('data',bytes=>{
      buffer+=bytes.toString();if(buffer.length>65536)return fail(Error('Original managed startup exceeded its limit'));
      let cut;
      while((cut=buffer.indexOf('\n'))>=0){
        const line=buffer.slice(0,cut);buffer=buffer.slice(cut+1);if(!line.trim())continue;
        let value;try{value=JSON.parse(line);}catch{return fail(Error('Original managed startup was not JSON'));}
        if(value.schema!=='stellar-forge.opencage-application-startup.v1')return fail(Error('Unexpected managed application'));
        if(!settled){settled=true;clearTimeout(timeout);accept(value);}
      }
    });
  });
  async function stop(){
    if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');
    let timer;
    const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{child.kill('SIGKILL');reject(Error('Original managed shutdown timed out'));},15000);});
    try{const result=await Promise.race([ended,timeout]);requireValue(result.code===0&&!result.signal,'Original managed process failed to stop');return result;}
    finally{clearTimeout(timer);}
  }
  try{
    const startup=await ready,checked=await verify(startup,{selection,launchSourceDirectory:component,port:0});
    return {startup,checked,stop};
  }catch(error){await stop().catch(()=>{});throw error;}
}
let mcp,client,activeWorkspace,activeBuyer,managed;
try{
  await mkdir(output,{recursive:true,mode:0o700});requireValue(await realpath(output)===output,'Use a canonical private output directory');
  const requestBytes=await exactFile(join(record,'request.json')),request=JSON.parse(requestBytes),argv=request.intent.command;
  requireValue(Array.isArray(argv)&&argv.length===process.argv.length&&
    await realpath(argv[0])===await realpath(process.execPath)&&argv.slice(1).every((v,i)=>v===process.argv[i+1])&&
    resolve(request.intent.project)===dirname(output),'Use this original admitted completion command');
  await exactFile(fileURLToPath(import.meta.url),args['driver-sha256']);
  report.receiving={operationId:request.intent.operation_id,record,requestSha256:digest(requestBytes),
    driverSha256:args['driver-sha256'],project:request.intent.project};
  const closureBytes=await exactFile(resolve(args['source-manifest']),args['source-manifest-sha256']),closure=JSON.parse(closureBytes);
  requireValue(closure.sourceRoot===source&&Array.isArray(closure.files),'Use the selected complete installed source');
  const sourcePaths=new Set();
  for(const file of closure.files){
    const selected=resolve(source,file.path),name=relative(source,selected).split('\\').join('/');
    requireValue(name===file.path&&!name.startsWith('../')&&!sourcePaths.has(name),'Installed source selection changed');
    sourcePaths.add(name);
    const bytes=await exactFile(selected,file.sha256);requireValue(bytes.length===file.bytes,'Installed source size changed');
  }
  report.source={sourceRoot:source,sourceCommit:closure.sourceCommit,overlays:closure.overlays,
    files:closure.files.length,manifestSha256:digest(closureBytes)};
  const original=await originalRecord(),prior=JSON.parse(original.retained('journey.json'));
  const expected=['original-buyer-executed-and-recovered','original-operations-joined','mcp-original-capture-reopened',
    'mcp-source-review-and-decision','mcp-complete-customer-received','mcp-shared-operator-and-customer','mcp-original-buyer-recovered'];
  requireValue(prior.outcome==='FAILED'&&prior.error?.code==='FILE_SIZE_OR_TYPE_INVALID'&&
    JSON.stringify(prior.stages.map(s=>s.name))===JSON.stringify(expected),'Use the original seven completed stages and exact remaining release failure');
  const buyer=JSON.parse(original.retained('buyer/buyer-complete.json'));
  requireValue(buyer.httpStatus===200&&buyer.operationMaxAtomic==='0'&&buyer.operatorPolicyMaxAtomic==='1'&&
    buyer.intentId===buyer.recoveredIntentId&&digest(original.retained('buyer/buyer-complete.json'))===prior.buyer.reportSha256,
    'Original completed Buyer identity changed');
  const originalDecision=prior.stages.find(s=>s.name==='mcp-source-review-and-decision');
  const originalDelivery=prior.stages.find(s=>s.name==='mcp-complete-customer-received');
  const originalBuyerDelivery=prior.stages.find(s=>s.name==='mcp-original-buyer-recovered');
  requireValue(digest(original.retained('received-main/manifest.json'))===originalDelivery.manifestSha256&&
    digest(original.retained('received-buyer/manifest.json'))===originalBuyerDelivery.manifestSha256,'Original complete customer manifests changed');
  report.original={...original.binding,receiving:prior.receiving,producer:prior.producer,continuation:prior.continuation,
    buyer:{intentId:buyer.intentId,httpStatus:buyer.httpStatus,configSha256:buyer.configSha256,responseSha256:buyer.responseSha256,
      responseBytes:buyer.responseBytes,operationMaxAtomic:buyer.operationMaxAtomic,reportSha256:prior.buyer.reportSha256},
    completedStages:expected,customer:originalDelivery,buyerCustomer:originalBuyerDelivery};
  await atomic(join(output,'original-operation.json'),report.original);
  await stage('original-buyer-and-customer-deliveries-joined',{operationId:original.binding.operationId,
    retainedFiles:original.binding.files,retainedBytes:original.binding.retainedBytes,buyerIntentId:buyer.intentId,
    responseSha256:buyer.responseSha256,customerManifestSha256:originalDelivery.manifestSha256,
    buyerManifestSha256:originalBuyerDelivery.manifestSha256});

  const [{startMerchantMcp},{openMerchantFileClient},launch]=await Promise.all([
    imp(join(merchant,'serve.mjs')),imp(join(merchant,'retained-download.mjs')),imp(join(component,'launch.mjs'))]);
  const configuration=join(original.root,'merchant-mcp','merchant-mcp.json'),connectionPath=join(original.root,'opencage-connection.json');
  const connection=await readJson(connectionPath),configurationBytes=await exactFile(configuration);
  const providerRequest=JSON.parse(await exactFile(join(prior.producer.record,'request.json'),prior.producer.requestSha256));
  requireValue(providerRequest.intent.operation_id===prior.producer.operationId&&
    connection.workspaces.locations.directory===join(resolve(providerRequest.intent.project),'run','workspace')&&
    connection.workspaces.customer.directory===join(original.root,'buyer','buyer-merchant-workspace'),
    'Keep the original host-declared merchant and Buyer workspaces');
  const configurationObject=JSON.parse(configurationBytes);
  requireValue(configurationObject.opencageWorkspaceConnection===connectionPath,'Keep the original MCP configuration');
  report.original.mcpConfiguration={path:configuration,sha256:digest(configurationBytes),connectionSha256:digest(await exactFile(connectionPath))};
  await atomic(join(output,'original-operation.json'),report.original,{replace:true});
  const environment={...process.env,MCP_ACCESS_TOKEN:randomBytes(32).toString('base64url')};
  mcp=await startMerchantMcp({configPath:configuration,port:0,environment});
  client=await openMerchantFileClient({url:mcp.url+'/mcp',environment,errorPrefix:'OPENCAGE',clientName:'opencage-retained-release-completion'});
  let calls=0;
  const call=async(name,input={})=>{const result=await client.call('merchant_opencage_'+name,input);calls++;return result;};
  const native=async(name,input)=>(await call(name,input)).native;
  const status=async workspace=>native('inspect',{workspace,view:'status'});
  activeWorkspace=await call('open',{workspace:'locations'});activeBuyer=await call('open',{workspace:'customer'});
  const identity=activeWorkspace.native.identity,workspaceDirectory=connection.workspaces.locations.directory;
  requireValue(identity===prior.stages.find(s=>s.name==='mcp-original-capture-reopened').workspaceIdentity,'Reopened workspace identity changed');
  const savedRequest=await native('inspect',{workspace:'locations',view:'request',id:'mcp-native-reverse'});
  const savedDelivery=await native('inspect',{workspace:'locations',view:'delivery',id:originalDecision.exportId});
  requireValue(savedRequest.responseSha256===buyer.responseSha256&&savedRequest.decision.revision===1&&
    savedRequest.decision.current.index===0&&savedDelivery.identity===originalDecision.deliveryIdentity,'Retained source decision or customer delivery changed');
  const packages=await native('inspect',{workspace:'customer',view:'packages',limit:100});
  const selected=packages.rows.find(row=>row.identity===buyer.selectedMerchant.packageIdentity);
  requireValue(selected?.packageId===originalBuyerDelivery.packageId,'Original Buyer-selected merchant changed');
  const recovered=await native('adopt_buyer',{workspace:'customer',id:'mcp-native-buyer',productId:'reverse',
    buyer:'retained',intentId:buyer.intentId,packageId:selected.packageId});
  requireValue(recovered.responseSha256===buyer.responseSha256&&recovered.merchantSelection.packageIdentity===selected.identity&&
    recovered.merchantSelection.termsSha256===buyer.selectedMerchant.termsSha256,'Original Buyer recovery changed its selected response or merchant');
  await stage('same-mcp-workspaces-and-buyer-reopened',{workspaceIdentity:identity,requestId:savedRequest.request.id,
    decisionRevision:savedRequest.decision.revision,deliveryIdentity:savedDelivery.identity,buyerIntentId:buyer.intentId,
    selectedMerchantIdentity:selected.identity,mcpConfigurationSha256:digest(configurationBytes)});

  const terms=activeWorkspace.native.configuration.terms,input=savedRequest.request.query;
  requireValue(input&&typeof input==='object','Original reviewed query input is absent');
  const applicationRoot=join(workspaceDirectory,'applications'),oldEntries=new Map();
  const {readdir}=await import('node:fs/promises');
  for(const name of await readdir(applicationRoot))if(name.endsWith('.mjs'))oldEntries.set(name,digest(await exactFile(join(applicationRoot,name))));
  const packageV1=await native('package',{workspace:'locations'});
  await native('release',{workspace:'locations',action:'stage',packageId:packageV1.packageId,id:'mcp-geocode-v1',
    label:'Reviewed original geocoding terms through MCP'});
  const {inspectRelease}=await imp(join(component,'merchant.mjs'));
  const firstRelease=await inspectRelease(join(workspaceDirectory,'releases'),'mcp-geocode-v1');
  requireValue(firstRelease.handlerEntry.path===join(applicationRoot,packageV1.manifest.identity+'-'+firstRelease.handlerEntry.sha256+'.mjs'),
    'Adopted source did not retain the package and generated entry identities');
  for(const [name,sha] of oldEntries)await exactFile(join(applicationRoot,name),sha);
  await stage('same-package-staged-from-adopted-source',{packageId:packageV1.packageId,packageIdentity:packageV1.manifest.identity,
    releaseId:firstRelease.id,handlerEntry:firstRelease.handlerEntry,retainedOriginalEntries:oldEntries.size});

  const currentState=async()=>(await status('locations')).native.merchant.state;
  async function challenge(id,expectedTerms){
    let state=await currentState();
    if(state.active!==id)await native('release',{workspace:'locations',action:'activate',id,expectedGeneration:state.generation,
      reason:'Reviewed retained merchant package and exact payment terms'});
    state=await currentState();
    const running=await native('release',{workspace:'locations',action:'start',expectedGeneration:state.generation});
    try{
      const url=new URL('/geocode/reverse',running.url);for(const [name,value] of Object.entries(input))url.searchParams.set(name,value);
      const response=await fetch(url,{redirect:'error'}),bytes=Buffer.from(await response.arrayBuffer());
      requireValue(response.status===402,'Original merchant did not return its payment challenge');
      const header=response.headers.get('payment-required'),document=header?JSON.parse(Buffer.from(header,'base64').toString('utf8')):JSON.parse(bytes);
      requireValue(Array.isArray(document.accepts)&&expectedTerms.paymentOptions.every(expected=>document.accepts.some(actual=>
        String(actual.amount??actual.maxAmountRequired)===String(expected.amount)&&actual.asset===expected.asset&&
        actual.payTo===expected.payTo&&actual.network===expected.network&&actual.scheme===expected.scheme&&
        actual.maxTimeoutSeconds===expected.maxTimeoutSeconds)),'Original payment challenge differs from all reviewed terms');
      await atomic(join(output,id+'.json'),bytes);
      return {releaseId:id,generation:state.generation,httpStatus:response.status,amount:expectedTerms.paymentOptions[0].amount,
        challengeSha256:digest(bytes),mode:running.mode};
    }finally{await native('release',{workspace:'locations',action:'stop'});}
  }
  const first=await challenge('mcp-geocode-v1',terms);
  await stage('original-price-activated-and-stopped',first);
  const proposed=structuredClone(terms);proposed.paymentOptions[0].amount='35000';
  const packageV2=await native('package',{workspace:'locations',terms:proposed});
  await native('release',{workspace:'locations',action:'stage',packageId:packageV2.packageId,id:'mcp-geocode-v2',
    label:'Reviewed revised geocoding terms through MCP'});
  const diff=await native('inspect',{workspace:'locations',view:'release-diff',before:'mcp-geocode-v1',after:'mcp-geocode-v2'});
  requireValue(JSON.stringify(diff).includes('35000'),'Original release diff omitted the proposed atomic terms');
  await atomic(join(output,'release-diff.json'),diff);
  const second=await challenge('mcp-geocode-v2',proposed);
  const beforeRollback=await currentState();
  await native('release',{workspace:'locations',action:'rollback',expectedGeneration:beforeRollback.generation,
    reason:'Return to the original reviewed geocoding price'});
  const rolledBack=await currentState();
  requireValue(rolledBack.active==='mcp-geocode-v1','Original rollback changed the intended merchant');
  requireValue((await status('locations')).native.source.started===0,'Retained completion dispatched a provider capture');
  for(const [name,sha] of oldEntries)await exactFile(join(applicationRoot,name),sha);
  await stage('revised-price-and-original-rollback',{firstChallenge:first,secondChallenge:second,
    active:rolledBack.active,generation:rolledBack.generation,sourceDispatches:0});
  await call('close',{workspace:'customer',instanceId:activeBuyer.instanceId});activeBuyer=null;
  await call('close',{workspace:'locations',instanceId:activeWorkspace.instanceId});activeWorkspace=null;
  const closed=await call('workspaces');
  requireValue(closed.workspaces.every(row=>!row.open&&!row.customers.length)&&closed.activeFileReads===0,'Original MCP ownership did not close');
  await mcp.close();mcp=null;

  const readEnvironment={...process.env};delete readEnvironment.OPENCAGE_API_KEY;delete readEnvironment.MCP_ACCESS_TOKEN;
  const selection=await launch.prepareGeocodeManagedSelection({workspaceDirectory,sourceDirectory:component});
  await atomic(join(output,'managed-selection.json'),selection);
  const instances=[];
  for(let index=0;index<2;index++){
    managed=await startManaged(selection,readEnvironment,launch.verifyGeocodeManagedStartup);
    const denied=await localRead(managed.checked.url,'/api/managed-launch',{authenticated:false});
    requireValue(denied.status===401,'Managed identity read did not require its original session');
    const overviewResponse=await localRead(managed.checked.url,'/api/workspace'),overview=JSON.parse(overviewResponse.body);
    const requestResponse=await localRead(managed.checked.url,'/api/request?id=mcp-native-reverse'),selectedRequest=JSON.parse(requestResponse.body);
    const deliveryResponse=await localRead(managed.checked.url,'/api/export?id='+encodeURIComponent(originalDecision.exportId));
    const selectedDelivery=JSON.parse(deliveryResponse.body);
    requireValue(overviewResponse.status===200&&overview.identity===identity&&
      requestResponse.status===200&&selectedRequest.responseSha256===buyer.responseSha256&&selectedRequest.decision.revision===1&&
      deliveryResponse.status===200&&selectedDelivery.identity===originalDecision.deliveryIdentity,'Managed native process did not reopen the same original source and customer work');
    requireValue(overview.source.transport.initialized===false,'Managed retained workspace initialized a provider connection');
    const instance={...managed.checked.original};instances.push(instance);
    await managed.stop();managed=null;
    requireValue((await launch.prepareGeocodeManagedSelection({workspaceDirectory,sourceDirectory:component})).sha256===selection.sha256,
      'Mutable retained work changed the original managed source selection');
    await stage(index?'managed-native-same-workspace-reopened':'managed-native-started-and-stopped',
      {workspaceIdentity:identity,instanceId:instance.instanceId,sourceSha256:instance.sourceSha256,
        selectionSha256:instance.selectionSha256,decisionRevision:1,deliveryIdentity:selectedDelivery.identity,sourceInitialized:false});
  }
  requireValue(instances[0].instanceId!==instances[1].instanceId,'Managed reopen reused an ended process identity');
  await atomic(join(output,'managed-instances.json'),{schema:'commons.scf-opencage-managed-instances/v1',instances});

  const readOnlyEnvironment={MCP_ACCESS_TOKEN:randomBytes(32).toString('base64url')};
  mcp=await startMerchantMcp({configPath:configuration,port:0,environment:readOnlyEnvironment});
  client=await openMerchantFileClient({url:mcp.url+'/mcp',environment:readOnlyEnvironment,errorPrefix:'OPENCAGE'});
  activeWorkspace=await call('open',{workspace:'locations'});
  const reopened=await native('inspect',{workspace:'locations',view:'request',id:'mcp-native-reverse'});
  const reopenedDelivery=await native('inspect',{workspace:'locations',view:'delivery',id:originalDecision.exportId});
  requireValue(activeWorkspace.native.identity===identity&&reopened.responseSha256===buyer.responseSha256&&
    reopened.decision.revision===1&&reopenedDelivery.identity===originalDecision.deliveryIdentity&&
    activeWorkspace.native.source.transport.initialized===false,'Credential-independent original MCP reopen changed retained work');
  const reopenedStatus={workspaceIdentity:identity,requestId:reopened.request.id,responseSha256:reopened.responseSha256,
    decisionRevision:1,exportId:originalDecision.exportId,deliveryIdentity:reopenedDelivery.identity,sourceInitialized:false,
    active:(await currentState()).active,generation:(await currentState()).generation};
  await atomic(join(output,'reopened-status.json'),reopenedStatus);
  await call('close',{workspace:'locations',instanceId:activeWorkspace.instanceId});activeWorkspace=null;
  await mcp.close();mcp=null;
  await stage('mcp-installed-restart',{...reopenedStatus,toolCalls:calls});
  report.outcome='COMPLETE';report.finishedAt=new Date().toISOString();
  await atomic(join(output,'journey.json'),report,{replace:true});
  console.log(JSON.stringify({outcome:'COMPLETE',stages:report.stages.length,report:join(output,'journey.json')}));
}catch(error){
  report.outcome='FAILED';report.finishedAt=new Date().toISOString();report.error={name:error.name,code:error.code,message:error.message};
  await atomic(join(output,'journey.json'),report,{replace:true}).catch(()=>{});
  console.error(error.stack);process.exitCode=1;
}finally{
  await managed?.stop().catch(()=>{});
  await mcp?.close().catch(()=>{});
}
