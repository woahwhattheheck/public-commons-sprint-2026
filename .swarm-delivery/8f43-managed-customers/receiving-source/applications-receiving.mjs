// MIT. Receive one original prepared browser wallet through maintained Applications.
import { readFile, lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const ROOT='stellar/scf-starforge-20261009/';
const SCHEMA='stellar-forge.wallet-managed-reception.v1';
const moduleAt=(root,path)=>import(pathToFileURL(join(root,ROOT+path)).href);
const sha256=value=>createHash('sha256').update(value).digest('hex');
const hex=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
function need(value,code) {if(!value)throw Object.assign(new Error(code),{code});}
function argument(args,name,value) {
  const at=args.flatMap((item,index)=>item===name?[index]:[]);
  need(at.length===1 && args[at[0]+1]===value,'WALLET_RECEIVING_COMMAND_CHANGED');
}

/** Reuses the installed runtime, original wallet, application journal and process owner. */
export async function receiveWalletManagedApplication(config,{onProgress=()=>{},onOpen}={}) {
  for(const key of ['runtimeDirectory','walletDirectory','operatorWorkspace','receptionDirectory'])
    need(typeof config[key]==='string' && isAbsolute(config[key]) &&
      resolve(config[key])===config[key],'WALLET_RECEIVING_PATH_REQUIRED');
  need(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit??'') &&
    hex(config.expectedManifest) && /^[a-f0-9-]{36}$/.test(config.expectedWalletId??''),
  'WALLET_RECEIVING_ORIGINAL_SELECTION_REQUIRED');
  const bootstrap=config.bootstrapSourceRoot??join(config.runtimeDirectory,'package','source');
  need(isAbsolute(bootstrap),'WALLET_RECEIVING_PATH_REQUIRED');
  const {inspectMerchantRuntime}=await moduleAt(bootstrap,'sf46-release/runtime-package.mjs');
  const installed=await inspectMerchantRuntime(config.runtimeDirectory,
    {expectedManifest:config.expectedManifest,load:false});
  need(installed.sourceCommit===config.expectedSourceCommit,'WALLET_RECEIVING_SOURCE_CHANGED');
  const {createRuntimeWorkspace,openRuntimeWorkspace}=await moduleAt(installed.sourceRoot,
    'distribution/runtime-workspace/model.mjs');
  const {managedCommandAlive}=await moduleAt(installed.sourceRoot,
    'distribution/runtime-workspace/managed-workspace.mjs');
  const {browserWalletOutputReader,browserWalletStartup}=await moduleAt(installed.sourceRoot,
    'distribution/runtime-workspace/application-browser-wallet.mjs');
  const {makePrivate,privateDirectory,readJSON,saveJSON,operationLease,canonical}=await moduleAt(
    installed.sourceRoot,'distribution/runtime-workspace/storage.mjs');
  const {readWallet,readPrivate,readJson}=await moduleAt(installed.sourceRoot,
    'sf103-native-buyer-signer/browser-wallet/common.mjs');
  const {inspectBrowserWallet}=await moduleAt(installed.sourceRoot,
    'sf103-native-buyer-signer/browser-wallet/client.mjs');
  const wallet=await readWallet(config.walletDirectory);
  need(wallet.walletId===config.expectedWalletId &&
    wallet.sourceBuyerConfig===join(config.operatorWorkspace,'operator.json') &&
    sha256(await readPrivate(wallet.sourceBuyerConfig,65536))===wallet.sourceBuyerSha256,
  'WALLET_RECEIVING_ORIGINAL_OPERATOR_CHANGED');
  const walletSha256=sha256(await readPrivate(join(config.walletDirectory,'wallet.json')));
  const retainedRequests=async()=>{
    try {
      const value=await readJson(join(config.walletDirectory,'wallet-state.json'),16777216);
      need(value.walletId===wallet.walletId && value.buyerSha256===wallet.buyerSha256 &&
        Array.isArray(value.requests),'WALLET_RECEIVING_HISTORY_CHANGED');
      return value.requests;
    } catch(error) {if(error.code==='ENOENT')return [];throw error;}
  };
  const originalRequests=await retainedRequests();
  if(config.applicationWorkspace!==undefined)
    need(isAbsolute(config.applicationWorkspace),'WALLET_RECEIVING_PATH_REQUIRED');
  try {await makePrivate(config.receptionDirectory);}
  catch(error) {if(error.code!=='EEXIST')throw error;await privateDirectory(config.receptionDirectory);}
  const lease=await operationLease(join(config.receptionDirectory,'receiving.lock'));
  const receiptPath=join(config.receptionDirectory,'wallet-managed-reception.json');
  let model,journal,stage='OPEN_RECEIVING';
  try {
    journal=await readJSON(receiptPath,true);
    const selection={
      runtimeDirectory:installed.directory,sourceCommit:installed.sourceCommit,
      sourceManifestSha256:installed.sourceManifestSha256,installationId:installed.installationId,
      walletDirectory:config.walletDirectory,walletId:wallet.walletId,walletSha256,
      operatorWorkspace:config.operatorWorkspace,sourceBuyerSha256:wallet.sourceBuyerSha256,
      buyerSha256:wallet.buyerSha256,network:wallet.network,payer:wallet.payer,
      originalRequestsSha256:sha256(JSON.stringify(canonical(originalRequests))),
      applicationWorkspace:config.applicationWorkspace??join(config.receptionDirectory,'runtime-workspace'),
      homeId:config.homeId??null,
    };
    const continuing=Boolean(journal);
    if(journal) need(journal.schema===SCHEMA &&
      journal.operationId===(config.operationId??'SCF-BROWSER-WALLET-8F43-20261012') &&
      isDeepStrictEqual(journal.selection,selection),'WALLET_RECEIVING_SELECTION_CHANGED');
    else {
      journal={schema:SCHEMA,operationId:config.operationId??'SCF-BROWSER-WALLET-8F43-20261012',
        createdAt:new Date().toISOString(),selection,saveRequestId:randomUUID(),
        passes:[{name:'first-open',requestId:randomUUID()},{name:'reopen',requestId:randomUUID()}]};
      await saveJSON(receiptPath,journal);
    }
    const persist=async()=>{journal.updatedAt=new Date().toISOString();await saveJSON(receiptPath,journal,true);};
    const progress=value=>onProgress({stage,applicationId:journal.applicationId??null,...value});
    if(journal.completedAt)return journal;
    let present;
    try {present=await lstat(join(selection.applicationWorkspace,'workspace.json'));}
    catch(error) {if(error.code!=='ENOENT')throw error;}
    if(!present) {
      need(!config.applicationWorkspace,'WALLET_RECEIVING_EXISTING_APPLICATIONS_REQUIRED');
      await createRuntimeWorkspace({directory:selection.applicationWorkspace});
    }
    model=await openRuntimeWorkspace({directory:selection.applicationWorkspace});
    const attached=await model.attach({directory:installed.directory,label:config.label??'Original Freighter buyer'});
    journal.runtimeId=attached.runtimeId;await persist();
    const checkCommand=command=>{
      need(command.command==='browser-wallet' && command.args[0]==='serve','WALLET_RECEIVING_COMMAND_CHANGED');
      argument(command.args,'--workspace',selection.walletDirectory);
      argument(command.args,'--port','0');
    };
    const app=async()=>{
      const value=(await model.applicationsState()).applications.find(item=>item.id===journal.applicationId);
      need(value,'WALLET_RECEIVING_APPLICATION_MISSING');return value;
    };
    const awaitState=async(label,accept,recover)=>{
      const began=Date.now(),recovered=new Set();let nextProgress=began;
      for(;;) {
        const value=await app();
        if(value.phase==='INTERRUPTED' && value.current?.state)
          value.receivingCommandAlive=await managedCommandAlive(value.current.state);
        if(accept(value))return value;
        if((value.phase==='INTERRUPTED'||value.adoption?.phase==='INTERRUPTED') &&
          recover && !value.receivingCommandAlive) {
          const current=value.current??value.adoption;
          const key=JSON.stringify([current?.id,current?.phase,current?.state]);
          if(!recovered.has(key)) {recovered.add(key);await recover(value);continue;}
        }
        need(!['FAILED','UNAVAILABLE','STOPPED'].includes(value.phase) &&
          value.adoption?.phase!=='FAILED','WALLET_RECEIVING_ORIGINAL_OPERATION_ENDED');
        if(Date.now()>=nextProgress) {
          progress({label,phase:value.phase,operationId:value.current?.id??value.adoption?.id??null});
          nextProgress=Date.now()+15000;
        }
        need(Date.now()-began<180000,'WALLET_RECEIVING_OPERATION_PENDING');
        await delay(500);
      }
    };
    if(!journal.configurationReviewId) {
      stage='REVIEW_CONFIGURATION';
      const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'browser-wallet',
        label:config.label??'Original Freighter buyer',...(config.homeId?{homeId:config.homeId}:{}),
        settings:{workspaceDirectory:selection.walletDirectory,port:0}});
      checkCommand(review.command);journal.configurationReviewId=review.id;await persist();
    }
    if(!journal.applicationId) {
      stage='SAVE_AND_ADOPT';
      const saved=await model.applicationsSave({requestId:journal.saveRequestId,reviewId:journal.configurationReviewId});
      journal.applicationId=saved.applicationId;journal.configurationRevision=saved.revision;await persist();
      if(saved.connectionError)throw Object.assign(new Error(saved.connectionError.message),{code:saved.connectionError.code});
    }
    stage='CONNECT_ORIGINAL_RUNTIME';
    await model.applicationsConnect({applicationId:journal.applicationId});
    const recoverAdoption=async value=>{
      const operation=value.adoption;
      if(!operation || operation.active)return;
      journal.adoptionRecovery={at:new Date().toISOString(),operationId:operation.id,
        result:operation.phase==='QUEUED'?await model.resumeQueued(operation.id):
          await model.recoverManagedOperation(operation.id)};
      await persist();
    };
    const connection=await app();
    if(!connection.release && connection.adoption && !connection.adoption.active &&
      (connection.adoption.phase==='INTERRUPTED' ||
        continuing && ['QUEUED','FAILED'].includes(connection.adoption.phase)))
      await recoverAdoption(connection);
    await awaitState('Original managed runtime adoption',value=>Boolean(value.release),recoverAdoption);
    for(const pass of journal.passes) {
      if(pass.stoppedAt)continue;
      await model.close();model=await openRuntimeWorkspace({directory:selection.applicationWorkspace});
      if(!pass.reviewId) {
        stage='REVIEW_'+pass.name.toUpperCase();
        const review=await model.applicationsStartReview({applicationId:journal.applicationId});
        checkCommand(review.command);pass.reviewId=review.id;await persist();
      }
      const recoverPass=async()=>{
        pass.recovery={at:new Date().toISOString(),result:await model.applicationsRecover({
          applicationId:journal.applicationId,operationId:pass.requestId})};await persist();
      };
      const ownedUrl=value=>value.current?.id===pass.requestId && !value.current.stop?
        value.current.privateUrl??(value.receivingCommandAlive?value.current.url?.url:null):null;
      if(!pass.opened) {
        stage='START_'+pass.name.toUpperCase();
        const saved=(await app()).runs.find(value=>value.id===pass.requestId);
        if(saved)await recoverPass();
        else await model.applicationsStart({applicationId:journal.applicationId,
          requestId:pass.requestId,reviewId:pass.reviewId});
        const running=await awaitState('Original browser-wallet startup',value=>Boolean(ownedUrl(value)),recoverPass);
        const operationDirectory=join(selection.applicationWorkspace,'operations',pass.requestId);
        const nativeRequest=await readJSON(join(operationDirectory,'request.json'));
        need(nativeRequest.applicationId===journal.applicationId,'WALLET_RECEIVING_OPERATION_CHANGED');
        checkCommand(nativeRequest);
        const output=await model.applicationsOutput({applicationId:journal.applicationId,operationId:pass.requestId});
        const parse=browserWalletOutputReader(nativeRequest);need(parse,'WALLET_RECEIVING_STARTUP_MISSING');
        const announcements=output.output.text.split('\n').flatMap(line=>parse(line));
        const announcement=announcements.find(value=>value.walletId===wallet.walletId && value.url===ownedUrl(running));
        need(announcement,'WALLET_RECEIVING_STARTUP_MISSING');
        const verified=await browserWalletStartup(nativeRequest,announcement,operationDirectory);
        need(verified?.url===ownedUrl(running) && verified.original.walletId===wallet.walletId &&
          verified.original.buyerSha256===wallet.buyerSha256,'WALLET_RECEIVING_LIVE_BINDING_CHANGED');
        const url=new URL(verified.url),token=url.hash.slice('#session='.length);
        const get=async path=>{
          const response=await fetch(new URL(path,url),{redirect:'error',
            headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(10000)});
          need(response.ok,'WALLET_RECEIVING_ORIGINAL_HTTP_FAILED');return response;
        };
        const publicRoot=join(installed.sourceRoot,ROOT+'sf103-native-buyer-signer/browser-wallet/public');
        const assets={};
        for(const [path,name]of [['/','index.html'],['/app.mjs','app.mjs'],['/style.css','style.css']]) {
          const bytes=Buffer.from(await (await get(path)).arrayBuffer());
          need(sha256(bytes)===sha256(await readFile(join(publicRoot,name))),'WALLET_RECEIVING_ASSET_CHANGED');
          assets[name]=sha256(bytes);
        }
        const vendor=Buffer.from(await (await get('/vendor/freighter-api.js')).arrayBuffer());
        need(verified.original.freighterVersion==='6.0.1' &&
          sha256(vendor)===verified.original.bundleSha256,'WALLET_RECEIVING_FREIGHTER_CHANGED');
        const state=await (await get('/api/state')).json();
        need(state.walletId===wallet.walletId && state.instanceId===verified.original.instanceId &&
          state.payer===wallet.payer && state.network===wallet.network &&
          isDeepStrictEqual(state.operation,wallet.operation),'WALLET_RECEIVING_ORIGINAL_STATE_CHANGED');
        const provider=await inspectBrowserWallet(selection.walletDirectory);
        need(provider.instanceId===state.instanceId && provider.state===(state.connection?'CONNECTED':'AWAITING_WALLET'),
          'WALLET_RECEIVING_PROVIDER_CHANGED');
        if(onOpen)await onOpen({url:verified.url,applicationId:journal.applicationId,
          operationId:pass.requestId,walletId:wallet.walletId,instanceId:state.instanceId});
        const retained=await retainedRequests();
        need(isDeepStrictEqual(retained,originalRequests),'WALLET_RECEIVING_HISTORY_CHANGED');
        pass.opened={observedAt:new Date().toISOString(),instanceId:state.instanceId,
          privateUrlSha256:sha256(verified.url),providerState:provider.state,
          retainedRequestsSha256:sha256(JSON.stringify(canonical(retained))),requestCount:retained.length,
          freighterVersion:verified.original.freighterVersion,bundleSha256:sha256(vendor),assets};
        await persist();progress({phase:'OPENED',operationId:pass.requestId,walletId:wallet.walletId});
      }
      stage='STOP_'+pass.name.toUpperCase();
      await model.applicationsStop({applicationId:journal.applicationId,operationId:pass.requestId});
      const stopped=await awaitState('Original wallet process drain',
        value=>value.phase==='STOPPED' && value.current?.id===pass.requestId && !value.current.active,recoverPass);
      const closed=await readJson(join(selection.walletDirectory,'launch.json'),16384);
      need(closed.state==='CLOSED' && closed.instanceId===pass.opened.instanceId,'WALLET_RECEIVING_CLOSE_CHANGED');
      need(sha256(await readPrivate(join(selection.walletDirectory,'wallet.json')))===walletSha256 &&
        sha256(await readPrivate(wallet.sourceBuyerConfig,65536))===wallet.sourceBuyerSha256 &&
        isDeepStrictEqual(await retainedRequests(),originalRequests),'WALLET_RECEIVING_ORIGINAL_BINDING_CHANGED');
      await readWallet(selection.walletDirectory);
      pass.stoppedAt=new Date().toISOString();pass.terminalPhase=stopped.current.phase;await persist();
      progress({phase:'STOPPED',operationId:pass.requestId});
    }
    need(journal.passes[0].opened.instanceId!==journal.passes[1].opened.instanceId &&
      journal.passes[0].opened.privateUrlSha256!==journal.passes[1].opened.privateUrlSha256,
    'WALLET_RECEIVING_INSTANCE_NOT_REOPENED');
    stage='COMPLETED';journal.completedAt=new Date().toISOString();delete journal.issue;
    await persist();progress({phase:'COMPLETED',receiptPath});return journal;
  } catch(error) {
    if(journal) {journal.issue={stage,at:new Date().toISOString(),code:error.code??'WALLET_RECEIVING_FAILED',
      message:String(error.message??error).slice(0,600)};await saveJSON(receiptPath,journal,true).catch(()=>{});}
    throw error;
  } finally {if(model)await model.close();await lease.close();}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  need(process.argv[2],'WALLET_RECEIVING_CONFIGURATION_REQUIRED');
  const config=JSON.parse(await readFile(resolve(process.argv[2]),'utf8'));
  const result=await receiveWalletManagedApplication(config,
    {onProgress:value=>process.stdout.write(JSON.stringify(value)+'\n')});
  process.stdout.write(JSON.stringify({status:'COMPLETED',operationId:result.operationId,
    applicationId:result.applicationId,walletId:result.selection.walletId,sourceCommit:result.selection.sourceCommit,
    passes:result.passes.map(pass=>({name:pass.name,requestId:pass.requestId,opened:pass.opened,stoppedAt:pass.stoppedAt}))})+'\n');
}
