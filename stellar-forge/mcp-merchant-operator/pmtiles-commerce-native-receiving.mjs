// MIT. One paid-output continuation of the original complete PMTiles operation.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {join,resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';

export function validatePMTilesOutputNativeSelection(value){
  const commerce=structuredClone(value);
  assert.ok(commerce&&typeof commerce==='object'&&!Array.isArray(commerce));
  assert.ok(Object.keys(commerce).every(key=>['schema','origin','payment','runtime','buyer','mapAtomic','operationsAtomic',
    'mapBudgetAtomic','operationsBudgetAtomic','nativeEnvironment'].includes(key)));
  assert.equal(commerce.schema,'starforge.pmtiles-output-native-selection.v1');
  assert.equal(commerce.payment?.network,'stellar:testnet','Select the existing isolated native testnet profile.');
  const origin=new URL(commerce.origin);
  assert.ok(origin.protocol==='https:'&&!origin.username&&!origin.password&&!origin.search&&!origin.hash&&origin.pathname==='/');
  assert.ok(commerce.runtime&&Number.isInteger(commerce.runtime.port)&&commerce.runtime.port>0&&commerce.runtime.port<=65535);
  assert.ok(Object.keys(commerce.runtime).every(key=>['port','facilitator','allowLocalFacilitator'].includes(key)));
  for(const name of ['mapAtomic','operationsAtomic','mapBudgetAtomic','operationsBudgetAtomic'])
    assert.match(commerce[name]??'',/^(0|[1-9][0-9]{0,38})$/);
  assert.ok(BigInt(commerce.mapAtomic)>0n&&BigInt(commerce.operationsAtomic)>0n,'The native payment journey selects a positive amount.');
  const buyer=commerce.buyer;assert.ok(buyer&&typeof buyer==='object'&&!Array.isArray(buyer));
  assert.ok(Object.keys(buyer).every(key=>['runtimeDirectory','stateDirectory','configuration','configurationSha256',
    'operatorProfile','operatorProfileSha256','operatorWorkspace'].includes(key)));
  for(const key of ['runtimeDirectory','stateDirectory','configuration'])assert.ok(isAbsolute(buyer[key]));
  assert.match(buyer.configurationSha256??'',/^[a-f0-9]{64}$/);
  if(buyer.operatorProfile!==undefined){
    assert.ok(isAbsolute(buyer.operatorProfile));assert.match(buyer.operatorProfileSha256??'',/^[a-f0-9]{64}$/);
  }else assert.equal(buyer.operatorProfileSha256,undefined);
  if(buyer.operatorWorkspace!==undefined)assert.ok(isAbsolute(buyer.operatorWorkspace));
  if(commerce.nativeEnvironment!==undefined){
    const selected=commerce.nativeEnvironment;
    assert.ok(selected&&typeof selected==='object'&&!Array.isArray(selected));
    assert.ok(Object.keys(selected).every(key=>['configuration','configurationSha256'].includes(key)));
    assert.ok(isAbsolute(selected.configuration));assert.match(selected.configurationSha256??'',/^[a-f0-9]{64}$/);
  }
  return commerce;
}

/**
 * Consume the saved producer after its original browser/MCP/Applications owners
 * have drained. The supplied commerce selection names the existing facilitator
 * and original testnet buyer; this function creates no replacement payment engine.
 */
export async function exercisePMTilesOutputCommerce({sourceRoot,directory,runtimeProfile,
  expectedWorkspaceId,root,operationId,commerce,browserDirectory,openBrowser,signal,progress}){
  commerce=validatePMTilesOutputNativeSelection(commerce);
  if(openBrowser!==undefined){assert.equal(typeof openBrowser,'function');assert.ok(isAbsolute(browserDirectory));}
  else assert.equal(browserDirectory,undefined);
  for(const path of [sourceRoot,directory,runtimeProfile,root])assert.ok(isAbsolute(path));
  sourceRoot=resolve(sourceRoot);directory=resolve(directory);root=resolve(root);
  const scf='stellar/scf-starforge-20261009/',product=scf+'sf30-seller-sdk/pmtiles/';
  const operator='stellar-forge/mcp-merchant-operator/';
  const moduleAt=path=>import(pathToFileURL(join(sourceRoot,path)).href);
  const [{privateDirectory,readJson},{retainJson,fileDescriptor,MAX_METADATA_BYTES},
    {clone,digest,hash,identifier},{openPMTilesWorkspace},{readRuntime},
    {initializePMTilesWorkspaceMerchant},{startMerchantMcp},{openMerchantFileClient},
    {runPMTilesMcpCommand},{runPMTilesOutputCommand},{readOutputPackage},{pmtilesCommerceTools}]
    =await Promise.all([
      moduleAt(scf+'sf88-operator-buyer-cli/node/store.mjs'),moduleAt(product+'files.mjs'),
      moduleAt(product+'model.mjs'),moduleAt(product+'workspace.mjs'),moduleAt(product+'native.mjs'),
      moduleAt(operator+'pmtiles-workspace.mjs'),moduleAt(operator+'serve.mjs'),
      moduleAt(operator+'retained-download.mjs'),moduleAt(operator+'pmtiles-cli.mjs'),
      moduleAt(product+'commerce/cli.mjs'),moduleAt(product+'commerce/package.mjs'),
      moduleAt(operator+'catalog/pmtiles-commerce.mjs')]);
  identifier(operationId);identifier(expectedWorkspaceId);
  const selectedBuyer=commerce.buyer;
  await privateDirectory(root);await privateDirectory(join(root,'steps'));
  await privateDirectory(join(root,'private'));await privateDirectory(join(root,'requests'));
  async function optional(path){try{return await readJson(path,MAX_METADATA_BYTES);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  async function retainPrivateSelection(path,expected,name){
    const savedPath=join(root,'private',name+'.json');
    const source=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    let raw;
    try{
      const info=await source.stat();
      assert.ok(info.isFile()&&info.size<=65536);
      if(process.platform!=='win32')assert.ok((info.mode&0o077)===0&&(!process.getuid||info.uid===process.getuid()));
      raw=await source.readFile();assert.ok(raw.length<=65536);assert.equal(hash(raw),expected);
    }finally{await source.close();}
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    await retainJson(savedPath,value);
    return {path:savedPath,originalPath:path,originalSha256:expected};
  }
  // Preserve the exact selected public profile identity and private configuration.
  const native=await readRuntime(runtimeProfile),profile=await fileDescriptor(runtimeProfile,{signal});
  const configuration=await retainPrivateSelection(selectedBuyer.configuration,selectedBuyer.configurationSha256,'buyer-configuration');
  const operatorProfile=selectedBuyer.operatorProfile
    ?await retainPrivateSelection(selectedBuyer.operatorProfile,selectedBuyer.operatorProfileSha256,'buyer-operator'):null;
  const nativeEnvironment=commerce.nativeEnvironment
    ?await retainPrivateSelection(commerce.nativeEnvironment.configuration,commerce.nativeEnvironment.configurationSha256,'native-environment'):null;
  const environmentSelection=nativeEnvironment?await readJson(nativeEnvironment.path,65536):null;
  const selectedAccountingWorkspace=selectedBuyer.operatorWorkspace??environmentSelection?.operatorWorkspace;
  if(selectedAccountingWorkspace!==undefined)assert.ok(isAbsolute(selectedAccountingWorkspace));
  const operatorWorkspace=selectedAccountingWorkspace===undefined?null:resolve(selectedAccountingWorkspace);
  if(nativeEnvironment){
    assert.ok(operatorWorkspace,'The native receiving retains its original accounting workspace.');
    assert.equal(resolve(environmentSelection.operatorWorkspace),operatorWorkspace);
  }
  const input={schema:'starforge.pmtiles-output-native-input.v1',sourceRoot,directory,runtimeProfile:resolve(runtimeProfile),
    runtimeSha256:native.runtimeSha256,runtimeProfileSha256:profile.sha256,expectedWorkspaceId,root,operationId,commerce,
    ...(operatorWorkspace?{operatorWorkspace}:{}),...(openBrowser?{browserDirectory:resolve(browserDirectory)}:{})};
  const inputSha256=digest(input),prefix='sale-'+inputSha256.slice(0,16),id=name=>identifier(prefix+'-'+name);
  await retainJson(join(root,'input.json'),input);
  async function step(name,work){
    const path=join(root,'steps',identifier(name)+'.json'),prior=await optional(path);
    if(prior){assert.equal(prior.inputSha256,inputSha256);return prior.result;}
    signal?.throwIfAborted();await progress?.({operationId,phase:'paid-output-'+name});
    const result=await work();await retainJson(path,{inputSha256,result});return result;
  }
  const completed=await optional(join(root,'result.json'));
  if(completed){
    assert.equal(completed.inputSha256,inputSha256);assert.equal(completed.operationId,operationId);
    for(const row of completed.files){
      assert.ok(isAbsolute(row.path)&&resolve(row.path).startsWith(root+'/'));
      const actual=await fileDescriptor(row.path,{limit:34359738368,signal});
      assert.equal(actual.bytes,row.bytes);assert.equal(actual.sha256,row.sha256);
    }
    await readOutputPackage(completed.outputDirectory,{expectedManifestSha256:completed.output.manifestSha256,signal});
    return {...completed,reused:true};
  }
  const selected=await step('selected-original-map',async()=>{
    const workspace=await openPMTilesWorkspace({directory,expectedWorkspaceId,create:false});
    try{
      const state=workspace.state();assert.ok(state.currentRelease);
      const release=workspace.getRelease(state.currentRelease);
      const edition=workspace.getEdition(release.editionId,release.editionVersion);
      const archive=workspace.getResource(edition.archives[0].resourceId);
      assert.equal(archive.kind,'pmtiles');assert.ok(release.resourceIds.includes(archive.id));
      await workspace.resourceFile(archive.id).verify({signal});
      return {release,archive};
    }finally{await workspace.close();}
  });
  assert.equal(selected.release.workspaceId,expectedWorkspaceId);
  const receivingRoot=await privateDirectory(join(root,'customer-receiving'));
  const connection=join(root,'connection.json'),operatorRoot=join(root,'operator');
  const buyerConnection={runtimeDirectory:resolve(selectedBuyer.runtimeDirectory),stateDirectory:resolve(selectedBuyer.stateDirectory),
    configuration:configuration.path,...(operatorProfile?{operatorProfile:operatorProfile.path}:{}),
    ...(operatorWorkspace?{operatorWorkspace}:{})};
  await retainJson(connection,{schema:'stellar-forge.pmtiles-workspace-connection.v1',workspaces:{original:{
    label:'Original paid PMTiles output',directory,expectedWorkspaceId,runtime:resolve(runtimeProfile),
    imports:{},sf88Objects:{},receivingTargets:{customer:{directory:receivingRoot}},
    commerce:{runtimes:{original:commerce.runtime},buyers:{original:buyerConnection}}}}});
  const initialized=await initializePMTilesWorkspaceMerchant({directory:operatorRoot,connection,name:'Original paid PMTiles receiving'});
  const merchantDirectory=join(operatorRoot,'customer-exports','pmtiles-output','original','merchant');
  const outputRequestId=id('output'),outputDirectory=join(merchantDirectory,'packages',outputRequestId);
  const tokenEnv='PMTILES_OUTPUT_RECEIVING_MCP_TOKEN',token=randomBytes(32).toString('hex');
  let environment={...process.env,[tokenEnv]:token},environmentOwner,executionError;
  const listenerPath=join(root,'listener.json');let listener,client;
  const calls=[];
  async function startMcp(){
    const prior=await optional(listenerPath);if(prior)assert.equal(prior.inputSha256,inputSha256);
    listener=await startMerchantMcp({configPath:initialized.configuration,port:prior?.port??0,tokenEnv,environment});
    const port=Number(new URL(listener.url).port);
    if(prior)assert.equal(port,prior.port);else await retainJson(listenerPath,{inputSha256,port});
    client=await openMerchantFileClient({url:listener.url,tokenEnv,environment,signal,
      errorPrefix:'PMTILES_OUTPUT',clientName:'original-pmtiles-paid-receiving',maximumResponseBytes:32*1024*1024});
  }
  async function call(suffix,args={}){
    const name='merchant_pmtiles_'+suffix,request={workspace:'original',...clone(args)};
    const value=await client.call(name,request,{requestSignal:signal,timeoutMs:3600000});
    calls.push({name,requestSha256:digest(request),resultSha256:digest(value)});return value;
  }
  async function closeMcp(){
    const current=listener;listener=null;client=null;if(current)await current.close();
  }
  try{
    if(nativeEnvironment){
      const {startPMTilesNativeEnvironment}=await moduleAt(product+'commerce/native-environment.mjs');
      const retained=await fileDescriptor(nativeEnvironment.path,{limit:65536,signal});
      environmentOwner=await startPMTilesNativeEnvironment({
        selection:{configuration:nativeEnvironment.path,configurationSha256:retained.sha256},commerce,
        buyerConfiguration:await readJson(configuration.path,65536),
        operatorProfile:operatorProfile?await readJson(operatorProfile.path,65536):undefined,
        directory:join(root,'native-environment'),signal});
      environment={...environmentOwner.environment,[tokenEnv]:token};
    }
    await startMcp();
    const expectedTools=pmtilesCommerceTools(name=>name);
    const tools=listener.operator.tools.map(value=>value.name);
    for(const name of expectedTools)assert.ok(tools.includes(name),name);
    const opened=await call('open');assert.equal(opened.workspaceId,expectedWorkspaceId);
    const packaged=await step('original-complete-package',()=>call('package',{requestId:id('operations-package')}));
    assert.equal(packaged.state,'COMPLETE');assert.equal(packaged.workspaceSnapshot.currentRelease,selected.release.id);
    const prepare={requestId:outputRequestId,releaseId:selected.release.id,releaseManifestSha256:selected.release.manifestSha256,
      offerId:'original-regional-map',title:'Original complete regional map operations',origin:commerce.origin,
      payment:commerce.payment,chunkBytes:921600,objects:[
        {id:'map',resourceId:selected.archive.id,amount:commerce.mapAtomic,filename:'region.pmtiles'},
        {id:'operations',packageRequestId:id('operations-package'),archiveSha256:packaged.archive.sha256,
          amount:commerce.operationsAtomic,filename:'region-operations.zip'}]};
    const output=await step('prepared-output',()=>call('output_prepare',prepare));
    const outputReplay=await call('output_prepare',prepare);assert.equal(outputReplay.manifestSha256,output.manifestSha256);
    const packageInput={outputRequestId,manifestSha256:output.manifestSha256};
    const catalog=await call('output_catalog',packageInput),readback=await call('output_package',packageInput);
    assert.equal(catalog.catalogSha256,output.catalogSha256);assert.equal(readback.manifestSha256,output.manifestSha256);
    const map=catalog.catalog.objects.find(row=>row.id==='map'),operations=catalog.catalog.objects.find(row=>row.id==='operations');
    assert.ok(map&&operations);assert.equal(map.expectedSha256,selected.archive.sha256);
    assert.equal(operations.expectedSha256,packaged.archive.sha256);
    for(const row of [map,operations])assert.ok(row.path.endsWith('/'+row.snapshot));
    assert.ok(BigInt(commerce.mapBudgetAtomic)>=BigInt(map.pricing.completeDownloadAtomic));
    assert.ok(BigInt(commerce.operationsBudgetAtomic)>=BigInt(operations.pricing.completeDownloadAtomic));
    const staged=await step('original-staged-seller',()=>call('output_stage',{requestId:id('stage'),...packageInput,
      releaseId:id('seller'),label:'Original paid map outputs',runtime:'original'}));
    const release=staged.result;assert.equal(release.pmtilesOutput.packageManifestSha256,output.manifestSha256);
    const releaseInput={releaseId:release.id,releaseDigest:release.digest};
    const verified=await call('output_release',releaseInput);assert.equal(verified.digest,release.digest);
    const selection=await step('original-selection',async()=>{
      const status=await step('selection-before-activation',()=>call('output_status'));
      assert.equal(status.state.active,null,'The original receiving owns this newly initialized release store.');
      const compared=await call('output_compare',{...releaseInput,beforeReleaseId:null});
      const activated=await call('output_activate',{requestId:id('activate'),...releaseInput,
        expectedGeneration:status.state.generation,reason:'Select the original complete paid map outputs'});
      return {compared,activated};
    });
    const generation=selection.activated.result.selection.generation;
    async function ensureSeller(phase){
      const status=await call('output_status');
      assert.equal(status.state.active,release.id);assert.equal(status.state.generation,generation);
      if(status.runtime.state==='RUNNING'){
        assert.equal(status.runtime.observed.releaseDigest,release.digest);
        assert.equal(status.runtime.owned,true,'The original phase must own this seller lifetime.');
        return {request:null,result:{instanceId:status.runtime.observed.instanceId,
          releaseId:release.id,releaseDigest:release.digest,state:'RUNNING',owned:true}};
      }
      assert.equal(status.runtime.state,'STOPPED');
      const epoch=digest({phase,observed:status.runtime.observed?.instanceId??null,generation}).slice(0,12);
      const request={requestId:id('start-'+phase+'-'+epoch),...releaseInput,expectedGeneration:generation};
      const started=await call('output_start',request);
      const now=await call('output_status');assert.equal(now.runtime.state,'RUNNING');assert.equal(now.runtime.owned,true);
      assert.equal(now.runtime.observed.instanceId,started.result.instanceId);
      return {request,result:started.result};
    }
    const paid=await step('original-paid-deliveries',async()=>{
      const started=await ensureSeller('purchase');
      const firstStart=await step('first-start-request',async()=>started);
      const preparePurchase=async(objectId,maxTotalAtomic)=>{
        const request={requestId:id('purchase-'+objectId),buyer:'original',...packageInput,objectId,maxTotalAtomic};
        const value=await call('purchase_prepare',request),replay=await call('purchase_prepare',request);
        assert.equal(replay.requestSha256,value.requestSha256);return value;
      };
      const mapPurchase=await preparePurchase('map',commerce.mapBudgetAtomic);
      const operationsPurchase=await preparePurchase('operations',commerce.operationsBudgetAtomic);
      const mapResult=await call('purchase_run',{buyer:'original',purchaseRequestId:mapPurchase.requestId});
      const operationsResult=await call('purchase_run',{buyer:'original',purchaseRequestId:operationsPurchase.requestId});
      assert.equal(mapResult.status,'COMPLETE');assert.equal(operationsResult.status,'COMPLETE');
      assert.equal(mapResult.delivery.assembly.sha256,map.expectedSha256);
      assert.equal(operationsResult.delivery.assembly.sha256,operations.expectedSha256);
      const adopted=await call('purchase_adopt',{requestId:id('adopt-map'),buyer:'original',purchaseRequestId:mapPurchase.requestId});
      assert.equal(adopted.sha256,map.expectedSha256);assert.equal(adopted.bytes,map.bytes);
      const receivingInput={requestId:id('receive-operations'),buyer:'original',
        purchaseRequestId:operationsPurchase.requestId,target:'customer'};
      const receiving=await call('purchase_receive',receivingInput);
      assert.equal(receiving.status,'COMPLETE');assert.equal(receiving.archiveSha256,packaged.archive.sha256);
      assert.equal(receiving.workspaceId,expectedWorkspaceId);assert.equal(receiving.currentRelease,selected.release.id);
      const active=await call('output_status');assert.equal(active.runtime.owned,true);
      const stop=await call('output_stop',{requestId:id('stop-'+active.runtime.observed.instanceId),
        ...releaseInput,instanceId:active.runtime.observed.instanceId});
      assert.equal(stop.result.state,'STOPPED');
      return {firstStart,mapPurchase,operationsPurchase,mapResult,operationsResult,adopted,receivingInput,receiving,stop};
    });
    const accounting=operatorWorkspace?await step('original-final-accounting',async()=>{
      const purchases={map:paid.mapPurchase,operations:paid.operationsPurchase},rows={map,operations},summaries={};
      for(const name of ['map','operations']){
        const purchase=purchases[name],pages=[];let offset=0,total=null;
        do{
          const stepName='accounting-'+name+'-'+offset;
          const expectedTotal=rows[name].pricing.requests,expectedEnd=Math.min(expectedTotal,offset+100);
          const completeRange=page=>{
            const result=page?.accounting,native=result?.native,range=native?.range;
            return page?.requestSha256===purchase.requestSha256&&native?.kind==='object'&&
              native.mode==='FINALIZE'&&native.workspace===operatorWorkspace&&
              range?.offset===offset&&range.limit===100&&range.total===expectedTotal&&
              range.nextOffset===(expectedEnd<expectedTotal?expectedEnd:null)&&
              native.interrupted===false&&result.process?.exitCode===0&&!result.process.errorCode&&
              Array.isArray(native.entries)&&native.entries.length===expectedEnd-offset&&
              native.entries.every(entry=>['FINALIZED','IDEMPOTENT_FINALIZED'].includes(entry.outcome));
          };
          const page=await step(stepName,async()=>{
            // Reconcile the original command first. A partial native report stays
            // in that command's own records and does not complete this page.
            const recovered=await call('purchase_accounting_recover',{
              buyer:'original',purchaseRequestId:purchase.requestId});
            const prior=recovered.accounting?.lastComplete;
            const reopened=prior?{...recovered,accounting:prior}:null;
            if(completeRange(reopened))return reopened;
            const current=await call('purchase_finalize',{
              buyer:'original',purchaseRequestId:purchase.requestId,offset,limit:100});
            assert.ok(completeRange(current),'The original accounting range needs its retained idempotent continuation.');
            return current;
          });
          assert.ok(completeRange(page),'The retained complete accounting range changed.');
          const result=page.accounting,native=result.native;
          total??=native.range.total;assert.equal(native.range.total,total);
          const recovered=await call('purchase_accounting_recover',{
            buyer:'original',purchaseRequestId:purchase.requestId,commandId:result.commandId});
          assert.deepEqual(recovered.accounting.lastComplete.native,native);
          const path=join(root,'steps',stepName+'.json');
          pages.push({path,...await fileDescriptor(path,{signal}),commandId:result.commandId,
            range:clone(native.range),sessionId:native.sessionId,configurationSha256:native.configurationSha256,
            nativeSha256:digest(native)});
          if(native.range.nextOffset!==null)assert.ok(native.range.nextOffset>offset);
          offset=native.range.nextOffset;
        }while(offset!==null);
        assert.equal(pages.reduce((sum,page)=>sum+(page.range.nextOffset??total)-page.range.offset,0),total);
        summaries[name]={purchaseRequestId:purchase.requestId,total,pages};
      }
      return {workspace:operatorWorkspace,purchases:summaries};
    }):null;
    // Cold reopen keeps the original start result while fresh status reports STOPPED.
    await closeMcp();await startMcp();await call('open');
    const coldStatus=await call('output_status');
    assert.equal(coldStatus.runtime.state,'STOPPED');assert.equal(coldStatus.runtime.owned,false);
    if(paid.firstStart.request){
      const retained=await call('output_request',{requestId:paid.firstStart.request.requestId});
      assert.deepEqual(retained.complete.result,paid.firstStart.result);
      const historical=await call('output_start',paid.firstStart.request);
      assert.equal(historical.reused,true);assert.deepEqual(historical.result,paid.firstStart.result);
      assert.equal((await call('output_status')).runtime.state,'STOPPED');
    }
    const coldMap=await call('purchase_run',{buyer:'original',purchaseRequestId:paid.mapPurchase.requestId});
    const coldOperations=await call('purchase_recover',{buyer:'original',purchaseRequestId:paid.operationsPurchase.requestId});
    assert.equal(coldMap.delivery.assembly.sha256,map.expectedSha256);
    assert.equal(coldOperations.delivery.assembly.sha256,operations.expectedSha256);
    const coldAccounting={};
    if(accounting)for(const name of ['map','operations']){
      const selected=accounting.purchases[name],last=selected.pages.at(-1);
      const request={buyer:'original',purchaseRequestId:selected.purchaseRequestId,commandId:last.commandId};
      const recovered=await call('purchase_accounting_recover',request);
      assert.equal(recovered.accounting.commandId,last.commandId);
      assert.equal(digest(recovered.accounting.lastComplete.native),last.nativeSha256);
      coldAccounting[name]=recovered;
    }
    const customerReplay=await call('purchase_receive',paid.receivingInput);
    assert.equal(customerReplay.archiveSha256,paid.receiving.archiveSha256);
    assert.deepEqual(customerReplay.originalReceiving,paid.receiving.originalReceiving);
    const requestPath=join(root,'requests','current-status.json');
    await retainJson(requestPath,{workspace:'original'});
    const cliStatus=await runPMTilesMcpCommand(['call','output_status','--url',listener.url,'--request',requestPath,
      '--token-env',tokenEnv],{environment,signal});
    assert.equal(cliStatus.runtime.state,'STOPPED');
    const nativeConnection=join(root,'private','native-merchant-connection.json');
    await retainJson(nativeConnection,{schema:'starforge.pmtiles-output-cli.v1',workspaceDirectory:directory,
      expectedWorkspaceId,outputDirectory:merchantDirectory,releaseStore:join(operatorRoot,'releases'),
      runtimes:{original:commerce.runtime}});
    const nativeStatus=await runPMTilesOutputCommand(['status','--connection',nativeConnection],{signal});
    assert.equal(nativeStatus.state.active,release.id);assert.equal(nativeStatus.runtime.state,'STOPPED');
    await step('original-new-start-and-drain',async()=>{
      const restart=await ensureSeller('cold-reopen');
      const stopped=await call('output_stop',{requestId:id('stop-'+restart.result.instanceId),
        ...releaseInput,instanceId:restart.result.instanceId});
      assert.equal(stopped.result.state,'STOPPED');return {restart,stopped};
    });
    let browserOperator=null;
    if(openBrowser){
      const {exercisePMTilesCommerceBrowser}=await import('./pmtiles-commerce-browser-receiving.mjs');
      browserOperator=await exercisePMTilesCommerceBrowser({root:join(root,'browser-operator'),browserDirectory,
        openBrowser,call,operationId,workspaceId:expectedWorkspaceId,signal,progress,selection:{
          mapReleaseId:selected.release.id,mapResourceId:selected.archive.id,
          packageRequestId:packaged.requestId,output:{requestId:output.requestId,offerId:output.offerId,manifestSha256:output.manifestSha256},
          release:{id:release.id,digest:release.digest,label:release.label},
          mapAtomic:commerce.mapAtomic,operationsAtomic:commerce.operationsAtomic,
          purchases:{map:paid.mapPurchase,operations:paid.operationsPurchase},objects:{map,operations},
          adoptRequestId:id('adopt-map'),receivingInput:paid.receivingInput,originalReceiving:paid.receiving.originalReceiving,
          accounting:!!accounting}});
      assert.equal(browserOperator.status,'PMTILES_COMMERCE_BROWSER_COMPLETE');
      assert.equal(browserOperator.workspaceId,expectedWorkspaceId);assert.equal(browserOperator.originalReleaseId,selected.release.id);
    }
    const finalStatus=await call('output_status');assert.equal(finalStatus.runtime.state,'STOPPED');
    await call('close');await closeMcp();
    const environmentClosure=environmentOwner?await environmentOwner.close():null;
    const customerWorkspace=await openPMTilesWorkspace({directory:paid.receiving.originalReceiving.workspaceDirectory,
      expectedWorkspaceId,create:false});
    let customerState;
    try{customerState=customerWorkspace.state();assert.equal(customerState.currentRelease,selected.release.id);}
    finally{await customerWorkspace.close();}
    const filePaths=[coldMap.delivery.path,coldOperations.delivery.path,join(outputDirectory,'package.json'),
      join(root,'steps','original-paid-deliveries.json')];
    if(accounting){
      filePaths.push(join(root,'steps','original-final-accounting.json'));
      for(const selected of Object.values(accounting.purchases))for(const page of selected.pages)filePaths.push(page.path);
    }
    if(browserOperator)filePaths.push(join(root,'browser-operator','complete.json'),...browserOperator.files.map(row=>row.path));
    const files=[];
    for(const path of [...new Set(filePaths)]){
      assert.ok(resolve(path).startsWith(root+'/'));
      files.push({path,...await fileDescriptor(path,{limit:34359738368,signal})});
    }
    const result={schema:'starforge.pmtiles-output-native-result.v1',status:'PMTILES_OUTPUT_COMMERCE_COMPLETE',
      operationId,inputSha256,workspaceId:expectedWorkspaceId,originalReleaseId:selected.release.id,
      runtimeSha256:native.runtimeSha256,outputDirectory,output,sourcePackage:packaged,
      sellerRelease:{id:release.id,digest:release.digest,generation},catalogSha256:catalog.catalogSha256,
      objects:[map,operations],purchases:{map:coldMap,operations:coldOperations},
      customerReceiving:customerReplay,customerState,firstStart:paid.firstStart,coldStatus,finalStatus,
      cliStatus,nativeStatus,tools:expectedTools,calls,files,
      ...(accounting?{accounting,coldAccounting}:{}),...(browserOperator?{browserOperator}:{}),
      ...(environmentOwner?{nativeEnvironment:{selection:commerce.nativeEnvironment,ready:environmentOwner.ready,closed:environmentClosure}}:{}),
      completedAt:new Date().toISOString()};
    await retainJson(join(root,'result.json'),result);return result;
  }catch(error){executionError=error;throw error;}
  finally{
    const errors=[];
    try{await closeMcp();}catch(error){errors.push(error);}
    try{await environmentOwner?.close();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError([...new Set([...(executionError?[executionError]:[]),...errors])],
      'The original paid receiving and its owned environment need their retained continuation.');
  }
}
