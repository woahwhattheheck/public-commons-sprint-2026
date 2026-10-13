// MIT. Customer-browser integration with the unchanged Pollar SDK.
// The caller owns the durable browser operation journal. SDK session/key storage stays native.
import {
  POLLAR_BROWSER_ACTIONS, POLLAR_PUBLIC_CONFIGURATION_SCHEMA,
  validatePollarArguments, validatePollarValue, getPollarAction, publicPollarArguments,
} from './catalogue.mjs';

const SDK_VERSION='0.12.0-rc.1';
const CHECKPOINT_SCHEMA='stellar-forge.pollar-browser-checkpoint.v1';
const OUTCOME_SCHEMA='stellar-forge.pollar-browser-outcome.v1';
const SNAPSHOT_SCHEMA='stellar-forge.pollar-browser-state.v1';
const CLIENTS=Symbol.for('stellar-forge.pollar-browser.clients.v1');
const PRIVATE_FIELDS=new Set(['accessToken','refreshToken','access_token','refresh_token','privateKey','private_key',
  'dpopJkt','authorization','Authorization','dpop','DPoP','submissionToken','signedXdr','signedTxXdr',
  'signedTransactionXdr','signedAuthEntry','signedPayload','signature','signatures','authenticatorData','clientDataJSON']);
const AUTH_ACTIONS=new Set(['sdk.auth.login','sdk.auth.beginEmail','sdk.auth.sendCode','sdk.auth.verifyCode',
  'sdk.auth.providerAction','sdk.auth.passkeyLogin','sdk.auth.passkeyCreate']);
const SIGNATURE_ACTIONS=new Set(['sdk.transaction.sign','sdk.proof.message','sdk.proof.sep10','sdk.proof.authEntry']);
const TX_STEPS=new Set(['building','built','signing','signed','submitting','signing-submitting',
  'building-signing-submitting','submitted','success','error']);
const TERMINAL=new Set(['COMPLETE','FAILED']);
const AUTH_OPEN=new Set(['creating_session','entering_email','sending_email','entering_code','verifying_email_code',
  'opening_oauth','connecting_wallet','signing_wallet_challenge','authenticating_wallet','creating_passkey',
  'deploying_smart_account','authenticating']);

function failure(code,message,details={}){
  const error=new Error(message);error.name='PollarBrowserError';error.code=code;error.details=details;return error;
}
function need(value,code,message,details){if(!value)throw failure(code,message,details);}
function now(){return new Date().toISOString();}
function plain(value){return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function canonical(value){
  if(value===null)return 'null';
  if(typeof value==='string'||typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='number'){need(Number.isFinite(value),'POLLAR_NATIVE_VALUE','Preserve a finite original native number.');return JSON.stringify(value);}
  if(Array.isArray(value))return '['+value.map(item=>canonical(item===undefined?null:item)).join(',')+']';
  if(plain(value))return '{'+Object.keys(value).filter(key=>value[key]!==undefined).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  throw failure('POLLAR_NATIVE_VALUE','The original native value is not a plain serialized value.',{type:typeof value});
}
function copy(value,{publicOnly=false,seen=new WeakSet()}={}){
  if(value===undefined)return null;
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number'){need(Number.isFinite(value),'POLLAR_NATIVE_VALUE','The native result contains a non-finite number.');return value;}
  if(typeof value==='bigint')return {schema:'stellar-forge.native-bigint.v1',decimal:value.toString()};
  if(value instanceof Date)return value.toISOString();
  if(value instanceof Uint8Array){
    let binary='';for(const item of value)binary+=String.fromCharCode(item);
    return {schema:'stellar-forge.native-bytes.v1',base64:btoa(binary)};
  }
  if(value instanceof ArrayBuffer)return copy(new Uint8Array(value),{publicOnly,seen});
  if(value instanceof Error)return errorValue(value);
  need(typeof value==='object','POLLAR_NATIVE_VALUE','The original native value cannot be retained.',{type:typeof value});
  need(!seen.has(value),'POLLAR_NATIVE_VALUE','The original native value contains a cycle.');
  seen.add(value);
  try{
    if(Array.isArray(value))return value.map(item=>copy(item,{publicOnly,seen}));
    const result={};
    for(const [key,item] of Object.entries(value)){
      if(item===undefined||typeof item==='function')continue;
      if(key==='token'&&plain(item)&&(Object.hasOwn(item,'accessToken')||Object.hasOwn(item,'refreshToken'))){
        if(typeof item.expiresAt==='number')result.tokenExpiresAt=item.expiresAt;
        continue;
      }
      if(['accessToken','refreshToken','access_token','refresh_token','privateKey','private_key','dpopJkt',
        'authorization','Authorization','dpop','DPoP'].includes(key))continue;
      if(publicOnly&&PRIVATE_FIELDS.has(key))continue;
      Object.defineProperty(result,key,{value:copy(item,{publicOnly,seen}),enumerable:true,writable:true,configurable:true});
    }
    return result;
  }finally{seen.delete(value);}
}
function publicValue(value){return copy(value,{publicOnly:true});}
function errorValue(error){
  const result={name:String(error?.name??'Error'),code:String(error?.code??'POLLAR_NATIVE_ERROR'),
    message:String(error?.message??error??'The original SDK action failed.')};
  for(const field of ['details','body','status','statusCode','resultCode'])if(error?.[field]!==undefined)
    result[field]=copy(error[field],{publicOnly:true});
  return result;
}
async function sha256(value){
  const bytes=typeof value==='string'?new TextEncoder().encode(value):value;
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
function publicAuth(value){
  const result=publicValue(value??{step:'idle'});
  if(result.step==='authenticated'){
    result.verified=value.verified===true;
    if(result.session)delete result.session.token;
  }
  return result;
}
function transactionAction(entry){return entry.resultKind==='transaction'||entry.resultKind==='transaction-signature'||entry.action==='sdk.transaction.build';}
function transactionLane(entry){return transactionAction(entry)||entry.action==='sdk.transaction.reset'||entry.action==='sdk.proof.authEntry'||entry.action==='sdk.ramp.sign'||entry.action==='sdk.ramp.signature';}
function definiteError(value){
  const code=String(value?.code??value?.errorCode??''),body=value?.body;
  if(['POLLAR_ARGUMENT_INVALID','INVALID_FLOW','SDK_WALLET_REQUIRED','SDK_WALLET_NOT_READY','SDK_EXTERNAL_SIGNER_MISSING'].includes(code))return true;
  if(value?.resultCode||body?.resultCode)return true;
  if(value?.status>=400&&value.status<500&&![408,425,429].includes(value.status))return true;
  if(code&&/^(SDK_|TX_)/.test(code)&&!/(TIMEOUT|NETWORK|UPSTREAM|UNAVAILABLE|INTERNAL|UNKNOWN)/.test(code))return true;
  const text=String(value?.details??value?.message??'');
  return /^(No wallet connected|missing unsigned transaction|no prepared smart transaction|Passkey signer not configured|sendPayment: unsupported chain)/i.test(text)||
    /not (?:yet )?supported for smart|signTx is not supported|wallet adapter .* cannot sign|Register a ramp signing handler|ramp action changed/i.test(text);
}
function providerIds(entry,result,transaction,scope){
  const ids={};
  const put=(key,value)=>{if(typeof value==='string'&&value)ids[key]=value;};
  put('userId',scope?.userId);put('walletAddress',result?.wallet?.address??(entry.action==='sdk.wallet.create'?result?.address:null)??scope?.walletAddress);
  put('chain',entry.args?.params?.chain??entry.args?.chain??scope?.chain);
  if(entry.action==='sdk.wallet.balanceFor')put('queriedAddress',entry.args.publicKey);
  put('transactionHash',result?.hash??result?.txHash??transaction?.hash);
  put('rampTransactionId',result?.txId??entry.args?.txId);
  put('rampActionId',result?.nextAction?.actionId??entry.args?.body?.actionId??entry.args?.snapshot?.nextAction?.actionId);
  put('kycSessionId',result?.sessionId);
  put('sessionFamilyId',entry.args?.familyId);
  put('distributionRuleId',result?.ruleId??entry.args?.body?.ruleId);
  if(Number.isSafeInteger(result?.transactionVersion))ids.rampTransactionVersion=result.transactionVersion;
  return ids;
}
function historySummary(history){
  if(!history)return null;
  return {
    pageCount:history.pages.length,recordCount:history.recordCount,uniqueRecordCount:history.uniqueRecordCount,
    firstTotal:history.firstTotal,observedTotals:history.observedTotals,nextParams:copy(history.nextParams),
    complete:history.complete,overlappingRecordIds:[...history.overlappingRecordIds],
    changedRecordIds:[...history.changedRecordIds],firstObservedAt:history.firstObservedAt,
    lastObservedAt:history.lastObservedAt,snapshot:false,partialReason:history.partialReason??null,
  };
}

/**
 * Own one original PollarClient. Integrations accepts supplied native browser callbacks;
 * no callback, key or signed authorization is accepted through public configuration.
 */
export async function createPollarBrowserBridge({configuration,onState=()=>{},onOutcome=()=>{},integrations={}}={}){
  need(typeof window!=='undefined'&&typeof document!=='undefined'&&crypto?.subtle,
    'POLLAR_BROWSER_REQUIRED','Open this original SDK integration in its browser application.');
  validatePollarValue(configuration,POLLAR_PUBLIC_CONFIGURATION_SCHEMA);
  need(typeof onState==='function'&&typeof onOutcome==='function','POLLAR_CALLBACK_REQUIRED','Supply the browser state and outcome callbacks.');
  const config=copy(configuration),apiKeySha256=await sha256(config.apiKey);
  const baseUrl=new URL(config.baseUrl??'https://sdk.api.pollar.xyz',window.location.href);
  need(['https:','http:'].includes(baseUrl.protocol)&&!baseUrl.username&&!baseUrl.password,
    'POLLAR_CONFIGURATION_INVALID','Use the selected original SDK API URL.');
  const apiEndpointSha256=await sha256(baseUrl.href);
  const runtimeUrl=new URL(config.runtimeModuleUrl??'/pollar-runtime.mjs',window.location.href);
  need(runtimeUrl.origin===window.location.origin&&['https:','http:'].includes(runtimeUrl.protocol)&&!runtimeUrl.username&&!runtimeUrl.password,
    'POLLAR_RUNTIME_ORIGIN','Load the retained SDK runtime from this application origin.');
  const clients=globalThis[CLIENTS]??(globalThis[CLIENTS]=new Map());
  need(!clients.has(apiKeySha256),'POLLAR_BROWSER_ALREADY_OPEN','Reuse or close the existing original SDK instance for this application.');
  const owner={};clients.set(apiKeySha256,owner);
  let client,module,closed=false,closing=false,ready=false,revision=0,stateDelivery=Promise.resolve(),outcomeDelivery=Promise.resolve();
  let activeTransaction=null,storageDegradation=null,notificationError=null,closePromise=null;
  const subscriptions=[],operations=new Map(),pending=new Set(),lanes=new Map(),authOperations=new Set(),rampHandlers=[];
  const runtime={id:config.runtimeId??null,manifestSha256:config.runtimeManifestSha256??null,
    versions:{'@pollar/core':SDK_VERSION,'@pollar/react':SDK_VERSION,'@pollar/accesly-adapter':SDK_VERSION}};
  const fixedScope={applicationId:config.applicationId,network:config.stellarNetwork,apiOrigin:baseUrl.origin,
    apiEndpointSha256,apiKeySha256,runtimeId:runtime.id,runtimeManifestSha256:runtime.manifestSha256};
  function currentAuth(){return client?.getAuthState?.()??{step:'idle'};}
  function scope(){
    const auth=currentAuth(),wallet=client?.getWallet?.()??null;
    return {...fixedScope,network:client?.getNetwork?.()??config.stellarNetwork,userId:auth.step==='authenticated'?(auth.session?.userId??auth.session?.user?.id??null):null,
      walletAddress:wallet?.address??null,chain:wallet?.chain??(wallet?'STELLAR':null)};
  }
  function operationScope(entry,args=entry.args){
    const selected=scope(),chain=args?.params?.chain??args?.chain??
      (entry.action==='sdk.ramp.sign'?args?.snapshot?.nextAction?.chain:null);
    if(['STELLAR','POLYGON','SOLANA'].includes(chain)){
      const wallet=(client.getWallets()??[]).find(item=>(item.chain??'STELLAR')===chain);
      return {...selected,chain,walletAddress:wallet?.address??null};
    }
    return selected;
  }
  function snapshot(){
    const get=(name,fallback)=>{try{return publicValue(client?.[name]?.()??fallback);}catch(error){return {step:'error',error:errorValue(error)};}};
    const auth=publicAuth(currentAuth());
    return {
      schema:SNAPSHOT_SCHEMA,revision,ready,closed:closed||closing,observedAt:now(),scope:scope(),runtime:copy(runtime),
      auth,wallet:get('getWallet',null),wallets:get('getWallets',[]),profile:get('getUserProfile',null),
      network:get('getNetwork',config.stellarNetwork),balance:get('getWalletBalanceState',{step:'idle'}),
      assets:get('getEnabledAssetsState',{step:'idle'}),history:get('getTxHistoryState',{step:'idle'}),
      transaction:get('getTransactionState',{step:'idle'}),sessions:get('getSessionsState',{step:'idle'}),
      walletAdapters:get('listWalletAdapters',[]),rampSigningHandlers:copy(rampHandlers),storageDegradation,
      activeOperations:[...operations.values()].filter(item=>item.running||['PENDING','UNCERTAIN'].includes(item.state))
        .map(item=>({operationId:item.operationId,action:item.action,state:item.state,providerIds:copy(item.providerIds)})),
      notificationError:notificationError?publicValue(notificationError):null,
    };
  }
  function announceState(){
    revision++;const selected=snapshot();
    const next=stateDelivery.catch(()=>{}).then(()=>onState(selected));
    stateDelivery=next;next.catch(error=>{notificationError=errorValue(error);});return next;
  }
  async function artifacts(entry){
    const selected={};
    const walk=async(value,path='')=>{
      if(!value||typeof value!=='object')return;
      for(const [key,item] of Object.entries(value)){
        const location=path?path+'.'+key:key;
        if(PRIVATE_FIELDS.has(key)&&!['accessToken','refreshToken','access_token','refresh_token','privateKey','private_key',
          'dpopJkt','authorization','Authorization','dpop','DPoP'].includes(key)){
          selected[location]={sha256:await sha256(typeof item==='string'?item:canonical(copy(item))),kind:typeof item,
            ...(typeof item==='string'?{characters:item.length}:{})};
        }else if(item&&typeof item==='object')await walk(item,location);
      }
    };
    await walk(entry.args,'args');await walk(entry.nativeResult,'result');await walk(entry.transaction,'transaction');
    return selected;
  }
  function checkpoint(entry){
    return {
      schema:CHECKPOINT_SCHEMA,operationId:entry.operationId,action:entry.action,intentSha256:entry.intentSha256,
      scope:copy(entry.scope),intentScope:copy(entry.intentScope),args:copy(entry.retainedArgs),ephemeralArguments:copy(entry.ephemeralArguments),
      startedAt:entry.startedAt,updatedAt:entry.updatedAt,sequence:entry.sequence,state:entry.state,phase:entry.phase,
      dispatched:entry.dispatched,nativeStarted:entry.nativeStarted,nativeResult:copy(entry.nativeResult),originalResult:copy(entry.originalResult),transaction:copy(entry.transaction),
      transactionEvents:copy(entry.transactionEvents),providerIds:copy(entry.providerIds),
      authStates:copy(entry.authStates),history:copy(entry.history),lastError:copy(entry.lastError),
      observations:copy(entry.observations),readback:copy(entry.readback),rampSnapshot:copy(entry.rampSnapshot),
    };
  }
  async function emitNow(entry,{result=entry.nativeResult,state=entry.state,observation=null,error=null,phase=entry.phase,transactionEvent=null,authState=null}={}){
    if(transactionEvent){entry.transaction=copy(transactionEvent.value);entry.transactionEvents.push(copy(transactionEvent));}
    if(authState)entry.authStates.push(copy(authState));
    entry.state=state;entry.phase=phase;entry.updatedAt=now();entry.sequence++;
    if(result!==undefined)entry.nativeResult=copy(result);
    if(error)entry.lastError=errorValue(error);
    if(observation)entry.observations.push(copy(observation));
    entry.providerIds={...entry.providerIds,...providerIds(entry,entry.nativeResult,entry.transaction,entry.scope)};
    const selected=checkpoint(entry),privateArtifacts=await artifacts({args:selected.args,nativeResult:selected.nativeResult,transaction:selected.transaction});
    const publicCheckpoint={
      schema:'stellar-forge.pollar-browser-public-checkpoint.v1',operationId:selected.operationId,action:selected.action,
      intentSha256:selected.intentSha256,scope:copy(selected.scope),sequence:selected.sequence,phase:selected.phase,state:selected.state,
      dispatched:selected.dispatched,providerIds:copy(selected.providerIds),privateArtifacts,history:historySummary(selected.history),
      nativeTransaction:publicValue(selected.transaction),startedAt:selected.startedAt,updatedAt:selected.updatedAt,
    };
    const envelope={
      schema:OUTCOME_SCHEMA,operationId:selected.operationId,action:selected.action,state:selected.state,
      result:publicValue(selected.nativeResult),scope:copy(selected.scope),providerIds:copy(selected.providerIds),
      observations:observation?[publicValue(observation)]:[],checkpoint:selected,publicCheckpoint,
      ...(error?{error:errorValue(error)}:{}),
    };
    entry.outcome=envelope;
    const next=outcomeDelivery.catch(()=>{}).then(()=>onOutcome(envelope));
    outcomeDelivery=next;
    try{await next;}catch(problem){
      notificationError=errorValue(problem);
      const failed=failure('POLLAR_OUTCOME_DELIVERY_FAILED','The original SDK outcome is retained by this browser; recover this operation before another write.',
        {operationId:entry.operationId,originalState:entry.state});
      failed.outcome=envelope;throw failed;
    }
    announceState().catch(()=>{});return envelope;
  }
  function emit(entry,options={}){
    const retained={...options};
    for(const key of ['result','observation','transactionEvent','authState'])if(Object.hasOwn(retained,key))retained[key]=copy(retained[key]);
    const next=(entry.emission??Promise.resolve()).catch(()=>{}).then(()=>emitNow(entry,retained));
    entry.emission=next;return next;
  }
  function requireScope(entry,{authenticated=true}={}){
    const actual=operationScope(entry);
    for(const key of ['applicationId','network','apiOrigin','apiEndpointSha256','apiKeySha256','runtimeId','runtimeManifestSha256'])
      need(entry.scope[key]===actual[key],'POLLAR_OPERATION_SCOPE_CHANGED','Reopen the original application and runtime for this operation.',{field:key});
    if(authenticated){
      const auth=currentAuth();
      need(auth.step==='authenticated'&&auth.verified===true,'POLLAR_VERIFIED_SESSION_REQUIRED','Finish the original SDK session verification before this action.');
      for(const key of ['userId','walletAddress'])if(entry.scope[key]!==null)
        need(entry.scope[key]===actual[key],'POLLAR_OPERATION_PARTICIPANT_CHANGED','Use the original authenticated participant for this operation.',{field:key});
    }
    return actual;
  }
  function lane(entry){
    if(transactionLane(entry))return 'transaction';
    if(entry.action.startsWith('sdk.history.'))return 'history';
    if(entry.action.startsWith('sdk.auth.'))return 'authentication';
    if(entry.action.startsWith('sdk.ramp.')&&entry.mutates)return 'ramp/'+(entry.args?.txId??'create');
    return null;
  }
  async function exclusive(entry,work){
    const selected=lane(entry);
    if(selected){
      need(!lanes.has(selected),'POLLAR_SDK_BUSY','Wait for the original SDK action in this lane to return.',{lane:selected,operationId:lanes.get(selected)});
      lanes.set(selected,entry.operationId);
    }
    try{return await work();}finally{if(selected&&lanes.get(selected)===entry.operationId)lanes.delete(selected);}
  }
  function getter(name){return client[name]();}
  function originalMethod(entry,args=entry.args){
    const parts=entry.nativeMethod.split('.');let owner=client;
    for(const key of parts.slice(0,-1))owner=owner?.[key];
    const method=owner?.[parts.at(-1)];
    need(typeof method==='function','POLLAR_ORIGINAL_METHOD_MISSING','The retained original runtime does not expose the selected method.',{method:entry.nativeMethod});
    return method.apply(owner,entry.parameters.map(key=>args[key]));
  }

  function authClassification(entry,value){
    if(value.step==='authenticated'&&value.verified===true)return 'COMPLETE';
    if(value.step==='error')return /TIMEOUT|UNEXPECTED|SESSION_CREATE_FAILED/.test(value.errorCode??'')?'UNCERTAIN':'FAILED';
    if(value.step==='wallet_not_installed')return 'FAILED';
    if(entry.completeSteps?.includes(value.step))return 'COMPLETE';
    return 'PENDING';
  }
  function observeAuth(value){
    const observed=publicAuth(value);
    for(const id of [...authOperations]){
      const entry=operations.get(id);if(!entry||TERMINAL.has(entry.state)){authOperations.delete(id);continue;}
      if(!entry.nativeStarted)continue;
      entry.authObserved=true;
      const state=authClassification(entry,value);
      if(value.step==='authenticated'&&value.verified===true){
        const actual=scope();
        if(entry.scope.userId===null)entry.scope={...entry.scope,network:actual.network,userId:actual.userId,walletAddress:actual.walletAddress,chain:actual.chain};
      }
      emit(entry,{state,result:observed,phase:'AUTH_'+value.step.toUpperCase(),authState:{observedAt:now(),value:observed},
        observation:{kind:'sdk-auth-state',method:'onAuthStateChange',observedAt:now(),value:observed}})
        .catch(error=>{notificationError=errorValue(error);});
      if(TERMINAL.has(state))authOperations.delete(id);
    }
    announceState().catch(()=>{});
  }
  function observeTransaction(value){
    if(activeTransaction&&TX_STEPS.has(value?.step)){
      const entry=operations.get(activeTransaction);
      if(entry){
        const event={observedAt:now(),value:copy(value)};
        const state=value.step==='success'?'COMPLETE':'PENDING';
        emit(entry,{state,phase:'SDK_'+value.step.toUpperCase(),transactionEvent:event,
          observation:{kind:'sdk-transaction-state',method:'onTransactionStateChange',...event}})
          .catch(error=>{notificationError=errorValue(error);});
      }
    }
    announceState().catch(()=>{});
  }
  function observeWallet(provisioning){
    for(const entry of operations.values()){
      if(entry.action!=='sdk.wallet.create'||TERMINAL.has(entry.state)||!entry.nativeStarted)continue;
      const actual=scope();if(entry.scope.userId!==actual.userId)continue;
      const wallet=client.getWallet();
      if(entry.providerIds.walletAddress&&entry.providerIds.walletAddress!==wallet?.address)continue;
      const state=provisioning==='READY'?'COMPLETE':provisioning==='FAILED'?'FAILED':'PENDING';
      emit(entry,{state,result:{wallet,provisioning},phase:'WALLET_'+provisioning,
        observation:{kind:'sdk-wallet-provisioning',method:'onWalletStateChange',observedAt:now(),value:provisioning,wallet}})
        .catch(error=>{notificationError=errorValue(error);});
    }
    announceState().catch(()=>{});
  }
  function track(promise){
    pending.add(promise);promise.then(()=>pending.delete(promise),()=>pending.delete(promise));return promise;
  }
  function observation(method,args,value,extra={}){
    return {kind:'sdk-result',method,args:publicValue(args),observedAt:now(),value:copy(value),...extra};
  }
  function classification(entry,result){
    if(entry.action==='sdk.auth.state'||entry.action==='sdk.auth.refresh')return result?.step==='error'?'FAILED':result?.step==='authenticated'&&!result.verified?'PENDING':'COMPLETE';
    if(entry.action==='sdk.auth.cancel'||entry.action==='sdk.auth.logout'||entry.action==='sdk.auth.logoutEverywhere')return 'COMPLETE';
    if(result?.status==='error'){
      if(definiteError(result))return 'FAILED';
      return entry.mutates?'UNCERTAIN':'FAILED';
    }
    if(SIGNATURE_ACTIONS.has(entry.action))return result?.status==='signed'?'COMPLETE':'FAILED';
    if(entry.action==='sdk.transaction.build')return result?.status==='built'?'COMPLETE':'FAILED';
    if(transactionAction(entry)){
      if(result?.status==='success')return 'COMPLETE';
      if(result?.status==='pending')return 'PENDING';
      return 'UNCERTAIN';
    }
    if(entry.action==='sdk.transaction.status')return 'COMPLETE';
    if(entry.resultGetter&&result?.step==='error')return 'FAILED';
    if(entry.resultGetter&&['loading','idle'].includes(result?.step))return 'PENDING';
    if(entry.action==='sdk.wallet.provisioning'&&result===null)return 'FAILED';
    if(entry.action==='sdk.application.read'&&result===null)return 'FAILED';
    if(entry.action==='sdk.wallet.create'){
      const value=result?.provisioning??result?.wallet?.provisioning??result?.provisioning;
      return value==='READY'?'COMPLETE':value==='FAILED'?'FAILED':'PENDING';
    }
    if(entry.resultKind==='ramp'&&entry.mutates){
      if(result?.reconciliationRequired===true)return 'UNCERTAIN';
      const state=result?.lifecycleState??result?.status;
      if(state==='completed'||state==='refunded')return 'COMPLETE';
      if(state==='failed')return 'FAILED';
      return 'PENDING';
    }
    if(entry.action==='sdk.distribution.claim'){
      // The original response acknowledges submission; confirmation is a separate native read.
      return typeof result?.txHash==='string'&&result.txHash?'PENDING':'COMPLETE';
    }
    return 'COMPLETE';
  }
  async function callRead(entry,method,args){
    requireScope(entry,{authenticated:true});
    const parts=method.split('.');let owner=client;
    for(const key of parts.slice(0,-1))owner=owner?.[key];
    const fn=owner?.[parts.at(-1)];
    need(typeof fn==='function','POLLAR_ORIGINAL_METHOD_MISSING','The retained SDK read method is absent.',{method});
    try{
      const value=copy(await fn.apply(owner,args)),selected=observation(method,args,value);
      entry.readback=selected;
      return {value,observation:selected};
    }catch(error){
      const selected=observation(method,args,null,{error:errorValue(error)});entry.readback=selected;
      await emit(entry,{state:entry.state,observation:selected,error,phase:'READBACK_FAILED'});
      throw error;
    }
  }
  async function collectHistory(entry){
    requireScope(entry);
    const first=copy(entry.args.params??{});
    entry.history??={pages:[],firstParams:first,nextParams:first,firstTotal:null,observedTotals:[],
      recordCount:0,uniqueRecordCount:0,overlappingRecordIds:[],changedRecordIds:[],complete:false,
      firstObservedAt:null,lastObservedAt:null,partialReason:null};
    const history=entry.history,identities=new Map(),pageBodies=new Set();
    for(const page of history.pages){
      pageBodies.add(page.recordsSha256);
      for(const row of page.value.data.records){
        const id=typeof row.id==='string'?JSON.stringify([row.chain??null,row.id]):'sha256:'+await sha256(canonical(row));
        identities.set(id,canonical(row));
      }
    }
    if(history.complete)return emit(entry,{state:'COMPLETE',result:{pages:history.pages,coverage:historySummary(history)},phase:'HISTORY_COMPLETE'});
    for(;;){
      if(closing||closed){
        history.partialReason='BROWSER_CLOSED';
        return emit(entry,{state:'PENDING',result:{pages:history.pages,coverage:historySummary(history)},phase:'HISTORY_PAUSED'});
      }
      requireScope(entry);
      const params=copy(history.nextParams);
      await emit(entry,{state:'PENDING',result:{coverage:historySummary(history)},phase:'HISTORY_READ'});
      await client.fetchTxHistory(params);
      const value=copy(client.getTxHistoryState());
      if(value.step!=='loaded'){
        history.partialReason=value.step==='error'?'ORIGINAL_HISTORY_ERROR':'ORIGINAL_HISTORY_NOT_LOADED';
        return emit(entry,{state:'PENDING',result:{pages:history.pages,coverage:historySummary(history)},phase:'HISTORY_PAUSED',
          observation:observation('fetchTxHistory',[params],value)});
      }
      need(canonical(value.params)===canonical(params),'POLLAR_HISTORY_REQUEST_CHANGED','The SDK history state belongs to another original request.');
      const data=value.data,offset=params.offset??0;
      need(Array.isArray(data?.records)&&Number.isSafeInteger(data.total)&&data.total>=0&&
        Number.isSafeInteger(data.offset)&&data.offset===offset&&Number.isSafeInteger(data.limit)&&data.limit>0,
        'POLLAR_HISTORY_PAGE_INVALID','Keep the original SDK history page and its returned pagination fields.');
      const recordsSha256=await sha256(canonical(data.records)),selected={
        index:history.pages.length,params,value,recordsSha256,observedAt:now(),
      };
      if(data.records.length&&pageBodies.has(recordsSha256)){
        history.partialReason='ORIGINAL_PAGE_REPEATED';
        return emit(entry,{state:'PENDING',result:{pages:history.pages,coverage:historySummary(history)},phase:'HISTORY_PAUSED',
          observation:observation('fetchTxHistory',[params],value,{accepted:false,reason:history.partialReason})});
      }
      if(data.records.length===0&&data.offset<data.total){
        history.partialReason='ORIGINAL_EMPTY_PAGE_BEFORE_TOTAL';
        return emit(entry,{state:'PENDING',result:{pages:history.pages,coverage:historySummary(history)},phase:'HISTORY_PAUSED',
          observation:observation('fetchTxHistory',[params],value,{accepted:false,reason:history.partialReason})});
      }
      pageBodies.add(recordsSha256);
      history.pages.push(selected);history.firstObservedAt??=selected.observedAt;history.lastObservedAt=selected.observedAt;
      history.firstTotal??=data.total;history.observedTotals.push({page:selected.index,total:data.total});
      for(const row of data.records){
        const id=typeof row.id==='string'?JSON.stringify([row.chain??null,row.id]):'sha256:'+await sha256(canonical(row)),
          serialized=canonical(row),previous=identities.get(id);
        if(previous!==undefined){
          if(!history.overlappingRecordIds.includes(id))history.overlappingRecordIds.push(id);
          if(previous!==serialized&&!history.changedRecordIds.includes(id))history.changedRecordIds.push(id);
        }
        identities.set(id,serialized);
      }
      history.recordCount+=data.records.length;history.uniqueRecordCount=identities.size;
      const nextOffset=data.offset+data.records.length;
      need(Number.isSafeInteger(nextOffset),'POLLAR_HISTORY_OFFSET_INVALID','The original native history offset exceeds exact integer range.');
      history.complete=nextOffset>=data.total;
      history.nextParams=history.complete?null:{...params,limit:data.limit,offset:nextOffset};
      history.partialReason=!history.complete&&data.records.length===0?'ORIGINAL_EMPTY_PAGE_BEFORE_TOTAL':null;
      const outcome=await emit(entry,{state:history.complete?'COMPLETE':'PENDING',
        result:{pages:history.pages,coverage:historySummary(history)},phase:history.complete?'HISTORY_COMPLETE':'HISTORY_PAGE_RETAINED',
        observation:observation('fetchTxHistory',[params],value,{accepted:true,page:selected.index,recordsSha256})});
      if(history.complete||history.partialReason)return outcome;
    }
  }
  function retainedArguments(entry,args){
    if(AUTH_ACTIONS.has(entry.action)){
      const selected=publicPollarArguments(entry.action,args);
      return {args:copy(selected.args),ephemeral:selected.redacted};
    }
    return {args:copy(args),ephemeral:[]};
  }
  async function newEntry(action,args,operationId,originalScope){
    need(typeof operationId==='string'&&operationId.length>0&&operationId.length<=200,
      'POLLAR_OPERATION_ID_REQUIRED','Use the original durable browser operation identifier.');
    const catalogue=getPollarAction(action,{surface:'browser'});validatePollarArguments(action,args,{surface:'browser'});
    const retained=retainedArguments(catalogue,args),selectedScope=originalScope?copy(originalScope):operationScope(catalogue,args);
    if(!originalScope&&AUTH_ACTIONS.has(action))Object.assign(selectedScope,{userId:null,walletAddress:null,chain:null});
    const intentSha256=await sha256(canonical({action,args:retained.args,scope:selectedScope}));
    return {...catalogue,operationId,args:copy(args),retainedArgs:retained.args,ephemeralArguments:retained.ephemeral,
      intentSha256,intentScope:copy(selectedScope),scope:selectedScope,startedAt:now(),updatedAt:now(),sequence:0,state:'PENDING',phase:'PREPARED',dispatched:false,
      nativeStarted:false,authObserved:false,nativeResult:null,originalResult:null,transaction:null,transactionEvents:[],authStates:[],providerIds:{},observations:[],history:null,
      readback:null,lastError:null,rampSnapshot:null,running:false,outcome:null};
  }
  async function runOriginal(entry){
    return exclusive(entry,async()=>{
      if(!AUTH_ACTIONS.has(entry.action)&&!['sdk.auth.cancel','sdk.auth.logout','sdk.auth.logoutEverywhere',
        'sdk.auth.state','sdk.auth.refresh','sdk.network.read','sdk.application.read','sdk.wallet.adapters'].includes(entry.action)&&entry.mutates)
        requireScope(entry);
      if(AUTH_ACTIONS.has(entry.action)){
        if(entry.authFlow==='start'){
          for(const id of [...authOperations]){
            const prior=operations.get(id);
            if(prior&&!TERMINAL.has(prior.state))await emit(prior,{state:'FAILED',phase:'AUTH_SUPERSEDED',
              result:publicAuth(currentAuth()),observation:{kind:'sdk-auth-flow-replaced',observedAt:now(),replacementOperationId:entry.operationId}});
            authOperations.delete(id);
          }
        }
        authOperations.add(entry.operationId);
      }
      await emit(entry,{state:'PENDING',phase:'PREPARED'});
      entry.dispatched=true;entry.phase='DISPATCHING';
      await emit(entry,{state:'PENDING',phase:'DISPATCHING'});
      if(entry.operation==='complete-history')return collectHistory(entry);
      if(transactionLane(entry))activeTransaction=entry.operationId;
      try{
        entry.nativeStarted=true;
        let value=await originalMethod(entry);
        if(entry.resultGetter)value=getter(entry.resultGetter);
        if(AUTH_ACTIONS.has(entry.action)){
          value=publicAuth(currentAuth());
          const result=await emit(entry,{result:value,state:entry.authObserved?authClassification(entry,value):'PENDING',phase:'AUTH_'+value.step.toUpperCase(),
            observation:observation(entry.nativeMethod,entry.parameters.map(key=>entry.retainedArgs[key]),value)});
          if(TERMINAL.has(result.state))authOperations.delete(entry.operationId);
          return result;
        }
        if(entry.action==='sdk.auth.cancel'){
          for(const id of [...authOperations]){
            const previous=operations.get(id);
            if(previous&&!TERMINAL.has(previous.state))await emit(previous,{state:'FAILED',phase:'AUTH_CANCELED',
              result:publicAuth(currentAuth()),observation:{kind:'sdk-auth-canceled',observedAt:now(),byOperationId:entry.operationId}});
            authOperations.delete(id);
          }
        }
        if(entry.action==='sdk.auth.state'||entry.action==='sdk.auth.refresh'||entry.action==='sdk.auth.cancel'||
          entry.action==='sdk.auth.logout'||entry.action==='sdk.auth.logoutEverywhere')value=publicAuth(value);
        const copied=copy(value);entry.originalResult=copy(copied);
        const state=classification(entry,copied),
          selected=observation(entry.nativeMethod,entry.parameters.map(key=>entry.retainedArgs[key]),copied);
        if(entry.action==='sdk.session.revoke'){
          // A successful original DELETE is acknowledged even if its subsequent list is unavailable.
          const outcome=await emit(entry,{result:{revokedFamilyId:entry.args.familyId,nativeResult:copied},state:'COMPLETE',phase:'NATIVE_RETURN',observation:selected});
          try{const read=await callRead(entry,'listSessions',[]);return emit(entry,{state:'COMPLETE',result:outcome.result,observation:read.observation,phase:'REVOKE_OBSERVED'});}
          catch{return entry.outcome;}
        }
        const outcome=await emit(entry,{result:copied,state,phase:'NATIVE_RETURN',observation:selected});
        if(entry.action==='sdk.distribution.claim'&&entry.providerIds.transactionHash)return reconcileTransaction(entry);
        return outcome;
      }catch(error){
        if(error.code==='POLLAR_OUTCOME_DELIVERY_FAILED')throw error;
        const state=entry.mutates&&!definiteError(error)&&entry.dispatched?'UNCERTAIN':'FAILED';
        return emit(entry,{state,error,phase:'NATIVE_ERROR',
          observation:{kind:'sdk-error',method:entry.nativeMethod,observedAt:now(),error:errorValue(error)}});
      }finally{if(activeTransaction===entry.operationId)activeTransaction=null;}
    });
  }

  async function reconcileTransaction(entry){
    requireScope(entry);
    const hash=entry.providerIds.transactionHash??entry.transaction?.hash??entry.nativeResult?.hash??entry.nativeResult?.txHash;
    if(!hash)return emit(entry,{state:TERMINAL.has(entry.state)?entry.state:'UNCERTAIN',phase:'TRANSACTION_ID_REQUIRED',
      observation:{kind:'sdk-reconciliation',observedAt:now(),matched:false,reason:'The original SDK returned no transaction hash; its signed bytes and submission token remain in the private checkpoint.'}});
    const selected=await callRead(entry,'getTxStatus',[hash]);
    need(selected.value?.hash===hash&&['PENDING','SUCCESS','FAILED'].includes(selected.value.status),
      'POLLAR_TRANSACTION_OBSERVATION_MISMATCH','The original status result must identify this exact retained transaction.',{hash});
    const state=selected.value.status==='SUCCESS'?'COMPLETE':selected.value.status==='FAILED'?'FAILED':'PENDING';
    return emit(entry,{state,phase:'TRANSACTION_'+selected.value.status,
      result:{nativeResult:entry.originalResult,transactionStatus:selected.value},observation:selected.observation});
  }
  async function reconcileRamp(entry){
    requireScope(entry);
    const txId=entry.providerIds.rampTransactionId??entry.args.txId??entry.nativeResult?.txId;
    if(!txId)return emit(entry,{state:'UNCERTAIN',phase:'RAMP_ID_REQUIRED',
      observation:{kind:'sdk-reconciliation',observedAt:now(),matched:false,reason:'Retain the original ramp transaction ID before selecting its native readback.'}});
    const selected=await callRead(entry,'getRampTransaction',[txId]),incoming=selected.value;
    need(incoming?.txId===txId,'POLLAR_RAMP_OBSERVATION_MISMATCH','The returned ramp snapshot identifies another transaction.');
    const prior=entry.rampSnapshot??(entry.nativeResult?.txId===txId?entry.nativeResult:null);
    const accepted=module.core.mergeRampSnapshot(prior,incoming);
    if(prior&&accepted===prior&&canonical(prior)!==canonical(incoming))
      return emit(entry,{state:entry.state,phase:'RAMP_OLDER_OBSERVATION',observation:{...selected.observation,accepted:false}});
    entry.rampSnapshot=copy(accepted);
    const originalVersion=entry.args.body?.transactionVersion??entry.args.snapshot?.transactionVersion;
    if(Number.isSafeInteger(originalVersion)&&Number.isSafeInteger(incoming.transactionVersion)&&incoming.transactionVersion<originalVersion)
      return emit(entry,{state:'UNCERTAIN',phase:'RAMP_BEFORE_ORIGINAL_ACTION',observation:{...selected.observation,accepted:false}});
    const state=incoming.reconciliationRequired?'UNCERTAIN':
      incoming.lifecycleState==='failed'||incoming.status==='failed'?'FAILED':
      ['completed','refunded'].includes(incoming.lifecycleState??incoming.status)?'COMPLETE':'PENDING';
    return emit(entry,{state,result:incoming,phase:'RAMP_OBSERVED',observation:{...selected.observation,accepted:true,
      actionView:module.core.describeRampAction(incoming)}});
  }
  async function reconcileAuth(entry){
    const value=currentAuth(),expectedSessionId=[...entry.authStates].reverse().map(row=>row.value?.clientSessionId??row.value?.session?.clientSessionId).find(Boolean);
    requireScope(entry,{authenticated:false});
    if(value.step==='authenticated'&&value.verified===true){
      const userId=value.session?.userId??value.session?.user?.id??null,
        sessionMatches=expectedSessionId?value.session?.clientSessionId===expectedSessionId:
          entry.scope.userId!==null&&entry.scope.userId===userId;
      if(!sessionMatches)return emit(entry,{state:'UNCERTAIN',phase:'AUTH_SESSION_UNBOUND',
        observation:{kind:'sdk-auth-state',method:'getAuthState',observedAt:now(),value:publicAuth(value),matched:false}});
      if(entry.scope.userId===null)entry.scope={...entry.scope,...scope()};
      return emit(entry,{state:'COMPLETE',result:publicAuth(value),phase:'AUTH_VERIFIED',
        observation:{kind:'sdk-auth-state',method:'getAuthState',observedAt:now(),value:publicAuth(value),matched:true}});
    }
    if(expectedSessionId&&value.clientSessionId&&value.clientSessionId!==expectedSessionId)
      return emit(entry,{state:'UNCERTAIN',phase:'AUTH_SESSION_CHANGED',
        observation:{kind:'sdk-auth-state',method:'getAuthState',observedAt:now(),value:publicAuth(value),matched:false}});
    const state=entry.completeSteps?.includes(value.step)&&(!expectedSessionId||value.clientSessionId===expectedSessionId)?'COMPLETE':
      value.step==='error'?authClassification(entry,value):'PENDING';
    if(AUTH_OPEN.has(value.step))authOperations.add(entry.operationId);
    return emit(entry,{state,result:publicAuth(value),phase:'AUTH_OBSERVED',
      observation:{kind:'sdk-auth-state',method:'getAuthState',observedAt:now(),value:publicAuth(value)}});
  }
  async function reconcileWallet(entry){
    if(entry.action==='sdk.wallet.trustline'){
      await client.refreshAssets();
      const selected=copy(client.getEnabledAssetsState());
      const asset=entry.args.asset,record=selected.step==='loaded'?selected.data.assets.find(item=>
        item.code===asset.code&&item.issuer===asset.issuer&&(item.chain??'STELLAR')==='STELLAR'):null;
      const decimal=value=>typeof value==='string'&&/^\d+(?:\.\d+)?$/.test(value)?value.replace(/^0+(?=\d)/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''):null;
      const limit=entry.args.options?.limit,remove=limit!==undefined&&decimal(limit)==='0';
      const desired=remove?record?.trustlineEstablished===false:record?.trustlineEstablished===true&&
        (limit===undefined||decimal(limit)!==null&&decimal(limit)===decimal(record.limit));
      const matched=desired===true&&selected.data?.publicKey===entry.scope.walletAddress;
      return emit(entry,{state:matched?'COMPLETE':selected.step==='error'?'UNCERTAIN':'PENDING',
        result:{nativeResult:entry.originalResult,assets:selected,matchingAsset:record??null},phase:'TRUSTLINE_OBSERVED',
        observation:observation('refreshAssets',[],selected,{matched,desiredChange:remove?'remove':'establish',requestedLimit:limit??null})});
    }
    const selected=await callRead(entry,'refreshWalletState',[]),wallet=copy(client.getWallet());
    if(entry.providerIds.walletAddress&&wallet?.address!==entry.providerIds.walletAddress)
      return emit(entry,{state:'UNCERTAIN',phase:'WALLET_OBSERVATION_MISMATCH',
        observation:{...selected.observation,wallet,matched:false}});
    const value=selected.value??wallet?.provisioning;
    const state=value==='READY'?'COMPLETE':value==='FAILED'?'FAILED':value?'PENDING':'UNCERTAIN';
    return emit(entry,{state,phase:'WALLET_OBSERVED',result:{wallet,provisioning:value??null},
      observation:{...selected.observation,wallet,matched:wallet?.address===entry.scope.walletAddress||entry.scope.walletAddress===null}});
  }
  async function observeUncertainAction(entry){
    const table={
      'sdk.requirements.submit':['getRequirementForm',[entry.args.formId]],
      'sdk.requirements.registrySubmit':['getRegistryCheck',[entry.args.optionId]],
      'sdk.requirements.providerSubmit':['getProviderRegistration',[entry.args.corridorId]],
      'sdk.kyc.start':['getKycStatus',[entry.args.body?.providerId,entry.args.body?.corridorId,entry.args.body?.cardProviderId]],
      'sdk.distribution.claim':['listDistributionRules',[]],
    };
    const selected=table[entry.action];
    if(!selected)return emit(entry,{state:TERMINAL.has(entry.state)?entry.state:'UNCERTAIN',phase:'ORIGINAL_READBACK_REQUIRED',
      observation:{kind:'sdk-reconciliation',observedAt:now(),matched:false,reason:'The retained SDK exposes no action-identity readback for this unresolved request.'}});
    const read=await callRead(entry,selected[0],selected[1]);
    return emit(entry,{state:TERMINAL.has(entry.state)?entry.state:'UNCERTAIN',phase:'CURRENT_PROVIDER_STATE',
      observation:{...read.observation,actionIdentityMatched:false}});
  }
  async function restoreEntry(operation){
    need(plain(operation),'POLLAR_OPERATION_REQUIRED','Supply the original browser operation with its complete checkpoint.');
    const saved=operation.checkpoint??operation.outcome?.checkpoint??operation.result?.checkpoint;
    need(saved?.schema===CHECKPOINT_SCHEMA,'POLLAR_ORIGINAL_CHECKPOINT_REQUIRED','Restore the complete original private browser checkpoint.');
    const operationId=operation.operationId??operation.id??saved.operationId,action=operation.action??saved.action;
    need(operationId===saved.operationId&&action===saved.action,'POLLAR_OPERATION_CONFLICT','The selected checkpoint identifies another operation.');
    const existing=operations.get(operationId);
    if(existing){
      need(existing.action===action&&existing.intentSha256===saved.intentSha256,'POLLAR_OPERATION_CONFLICT','The original operation intent differs.');
      return existing;
    }
    const catalogue=getPollarAction(action,{surface:'browser'}),args=copy(saved.args??{}),intentScope=saved.intentScope??saved.scope;
    need(typeof saved.intentSha256==='string'&&await sha256(canonical({action,args,scope:intentScope}))===saved.intentSha256,
      'POLLAR_CHECKPOINT_CHANGED','The complete retained browser intent does not match its original hash.');
    if(!AUTH_ACTIONS.has(action))validatePollarArguments(action,args,{surface:'browser'});
    const entry={...catalogue,operationId,action,args,retainedArgs:args,ephemeralArguments:copy(saved.ephemeralArguments??[]),
      intentSha256:saved.intentSha256,intentScope:copy(intentScope),scope:copy(saved.scope),startedAt:saved.startedAt,
      updatedAt:saved.updatedAt,sequence:saved.sequence??0,state:saved.state??operation.state??'UNCERTAIN',
      phase:saved.phase??'RESTORED',dispatched:saved.dispatched===true,nativeStarted:saved.nativeStarted===true,authObserved:false,
      nativeResult:copy(saved.nativeResult),originalResult:copy(saved.originalResult),
      transaction:copy(saved.transaction),transactionEvents:copy(saved.transactionEvents??[]),authStates:copy(saved.authStates??[]),
      providerIds:copy(saved.providerIds??{}),observations:copy(saved.observations??[]),history:copy(saved.history),
      readback:copy(saved.readback),lastError:copy(saved.lastError),rampSnapshot:copy(saved.rampSnapshot),
      running:false,outcome:null};
    requireScope(entry,{authenticated:false});operations.set(operationId,entry);return entry;
  }
  async function reconcile({operation}={}){
    need(!closed&&!closing,'POLLAR_BROWSER_CLOSED','Open the original browser SDK before reconciling.');
    const entry=await restoreEntry(operation);
    if(entry.running)return entry.promise;
    const work=exclusive(entry,async()=>{
      requireScope(entry,{authenticated:false});
      if(AUTH_ACTIONS.has(entry.action))return reconcileAuth(entry);
      if(entry.action==='sdk.auth.logout'||entry.action==='sdk.auth.logoutEverywhere'||entry.action==='sdk.auth.cancel'){
        const value=publicAuth(currentAuth());
        return emit(entry,{state:value.step==='idle'?'COMPLETE':entry.state,phase:'LOCAL_AUTH_OBSERVED',
          result:value,observation:observation('getAuthState',[],value,{scope:'original-local-session'})});
      }
      if(entry.operation==='complete-history')return collectHistory(entry);
      if(!entry.mutates){
        requireScope(entry,{authenticated:!['sdk.auth.state','sdk.network.read','sdk.application.read','sdk.wallet.adapters'].includes(entry.action)});
        const value=await originalMethod(entry),selected=entry.resultGetter?getter(entry.resultGetter):value;
        return emit(entry,{result:selected,state:classification(entry,selected),phase:'READ_OBSERVED',
          observation:observation(entry.nativeMethod,entry.parameters.map(key=>entry.args[key]),selected)});
      }
      requireScope(entry);
      if(TERMINAL.has(entry.state)&&entry.nativeResult!==null&&!entry.providerIds.transactionHash&&entry.resultKind!=='ramp')
        return emit(entry,{state:entry.state,phase:'ORIGINAL_RESULT_RECOVERED'});
      if(entry.providerIds.transactionHash)return reconcileTransaction(entry);
      if(entry.resultKind==='ramp')return reconcileRamp(entry);
      if(['sdk.wallet.create','sdk.wallet.createAccount','sdk.wallet.trustline'].includes(entry.action))return reconcileWallet(entry);
      if(transactionAction(entry)&&!SIGNATURE_ACTIONS.has(entry.action)&&entry.action!=='sdk.transaction.build')return reconcileTransaction(entry);
      if(entry.action==='sdk.session.revoke'){
        const selected=await callRead(entry,'listSessions',[]);
        need(Array.isArray(selected.value),'POLLAR_SESSION_LIST_INVALID','The original session list is unavailable.');
        const absent=!selected.value.some(row=>row.familyId===entry.args.familyId);
        return emit(entry,{state:absent?'COMPLETE':'PENDING',phase:'SESSION_REVOCATION_OBSERVED',
          result:{familyId:entry.args.familyId,present:!absent,sessions:selected.value},
          observation:{...selected.observation,matched:absent}});
      }
      return observeUncertainAction(entry);
    }).catch(async error=>{
      if(error.code==='POLLAR_OUTCOME_DELIVERY_FAILED')throw error;
      return emit(entry,{state:entry.mutates?'UNCERTAIN':'FAILED',phase:'RECONCILIATION_UNAVAILABLE',error});
    });
    entry.running=true;entry.promise=track(work.finally(()=>{entry.running=false;entry.promise=null;}));return entry.promise;
  }
  async function invoke({action,args={},operationId}={}){
    need(!closed&&!closing&&ready,'POLLAR_BROWSER_CLOSED','Wait for the original browser SDK to finish opening.');
    const previous=operations.get(operationId),candidate=await newEntry(action,args,operationId,previous?.intentScope),existing=operations.get(operationId);
    if(existing){
      need(existing.action===action&&existing.intentSha256===candidate.intentSha256,
        'POLLAR_OPERATION_CONFLICT','Keep the original action and arguments for this operation.');
      requireScope(existing,{authenticated:existing.scope.userId!==null&&!AUTH_ACTIONS.has(existing.action)});
      if(existing.scope.userId!==null&&AUTH_ACTIONS.has(existing.action)&&scope().userId!==null)
        need(existing.scope.userId===scope().userId,'POLLAR_OPERATION_PARTICIPANT_CHANGED','Recover the original authentication operation with its original participant.');
      if(existing.running)return existing.promise;
      if(existing.outcome&&TERMINAL.has(existing.state))return emit(existing,{phase:'ORIGINAL_RESULT_RECOVERED'});
      if(existing.dispatched)return reconcile({operation:{operationId,action,checkpoint:checkpoint(existing)}});
    }
    const entry=existing??candidate;operations.set(operationId,entry);
    const work=runOriginal(entry).catch(async error=>{
      if(error.code==='POLLAR_OUTCOME_DELIVERY_FAILED')throw error;
      return emit(entry,{state:entry.dispatched&&entry.mutates&&!definiteError(error)?'UNCERTAIN':'FAILED',
        error,phase:entry.dispatched?'NATIVE_UNCERTAIN':'PREPARATION_FAILED'});
    });
    entry.running=true;entry.promise=track(work.finally(()=>{
      entry.running=false;entry.promise=null;
      // An email code or provider payload is a one-call native input, never a recovery credential.
      if(AUTH_ACTIONS.has(entry.action))entry.args=copy(entry.retainedArgs);
    }));
    return entry.promise;
  }
  async function verificationToken(){
    need(!closed&&!closing,'POLLAR_BROWSER_CLOSED','The original SDK session is closed.');
    await client.ready();let auth=currentAuth();
    if(auth.step!=='authenticated'||auth.verified!==true)return null;
    if(!Number.isFinite(auth.session?.token?.expiresAt))return null;
    if(auth.session.token.expiresAt<=Math.floor(Date.now()/1000)){
      await client.refresh();auth=currentAuth();
    }
    if(auth.step!=='authenticated'||auth.verified!==true||auth.session?.token?.expiresAt<=Math.floor(Date.now()/1000))return null;
    return typeof auth.session?.token?.accessToken==='string'?auth.session.token.accessToken:null;
  }
  async function close(){
    if(closePromise)return closePromise;
    if(closed)return;
    closing=true;
    closePromise=(async()=>{
      try{
        const finalAuth=[];
        for(const id of [...authOperations]){
          const entry=operations.get(id);
          if(entry&&!TERMINAL.has(entry.state))finalAuth.push(emit(entry,{state:'UNCERTAIN',phase:'BROWSER_AUTH_CLOSED',
            result:publicAuth(currentAuth()),observation:{kind:'sdk-browser-close',observedAt:now()}}));
        }
        authOperations.clear();
        try{client.destroy();}catch(error){notificationError=errorValue(error);}
        await Promise.allSettled(finalAuth);
        await Promise.allSettled([...pending]);
        await Promise.allSettled([...operations.values()].map(entry=>entry.emission).filter(Boolean));
      }finally{
        for(const unsubscribe of subscriptions.splice(0))try{unsubscribe();}catch{}
        closed=true;ready=false;closing=false;if(clients.get(apiKeySha256)===owner)clients.delete(apiKeySha256);
        await Promise.allSettled([stateDelivery,outcomeDelivery]);await announceState().catch(()=>{});
      }
    })();
    return closePromise;
  }
  try{
    module=await import(runtimeUrl.href);
    need(typeof module.core?.PollarClient==='function'&&typeof module.pollarReact?.browserPasskeyCeremony==='function'&&
      typeof module.pollarReact?.browserPasskeySigner==='function'&&module.React&&typeof module.createRoot==='function',
      'POLLAR_RUNTIME_EXPORT_MISSING','Load the complete original Pollar core, React and browser passkey runtime.');
    need(module.core.POLLAR_CORE_VERSION===SDK_VERSION,'POLLAR_RUNTIME_VERSION_CHANGED',
      'Select the retained original Pollar SDK version.',{expected:SDK_VERSION,observed:module.core.POLLAR_CORE_VERSION??null});
    if(typeof module.pollarReact.POLLAR_REACT_VERSION==='string')
      need(module.pollarReact.POLLAR_REACT_VERSION===SDK_VERSION,'POLLAR_RUNTIME_VERSION_CHANGED','The original React SDK version differs.');
    runtime.versions.react=String(module.React.version??'unknown');
    const wallets=[...(integrations.walletAdapters??[])];
    if(integrations.accesly){
      need(typeof module.acceslyAdapter?.createAcceslyAdapter==='function'&&typeof integrations.accesly.signXdr==='function',
        'POLLAR_ACCESLY_CALLBACK_REQUIRED','Supply the original connected Accesly wallet and its own signing callback.');
      wallets.push(module.acceslyAdapter.createAcceslyAdapter(integrations.accesly));
    }
    const native={apiKey:config.apiKey,stellarNetwork:config.stellarNetwork,baseUrl:config.baseUrl??'https://sdk.api.pollar.xyz',
      passkey:integrations.passkey??module.pollarReact.browserPasskeyCeremony,
      passkeySign:integrations.passkeySign??module.pollarReact.browserPasskeySigner,
      ...(wallets.length?{walletAdapters:wallets}:{})};
    for(const key of ['deviceLabel','oauthRedirectUri','requestTimeoutMs','submitTimeoutMs','loginTimeoutMs','logLevel','retry'])
      if(config[key]!==undefined)native[key]=copy(config[key]);
    if(integrations.openAuthUrl)native.openAuthUrl=integrations.openAuthUrl;
    client=new module.core.PollarClient(native);
    for(const selected of integrations.rampSigningHandlers??[]){
      need(['STELLAR','POLYGON','SOLANA'].includes(selected.chain)&&typeof selected.encoding==='string'&&selected.encoding&&typeof selected.handler==='function',
        'POLLAR_RAMP_SIGNER_INVALID','Register an original chain/encoding signing callback.');
      subscriptions.push(client.registerRampSigningHandler(selected.chain,selected.encoding,selected.handler));
      rampHandlers.push({chain:selected.chain,encoding:selected.encoding});
    }
    subscriptions.push(client.onAuthStateChange(observeAuth));
    subscriptions.push(client.onTransactionStateChange(observeTransaction));
    subscriptions.push(client.onWalletStateChange(observeWallet));
    for(const name of ['onNetworkStateChange','onWalletBalanceStateChange','onEnabledAssetsStateChange','onTxHistoryStateChange','onSessionsStateChange'])
      if(typeof client[name]==='function')subscriptions.push(client[name](()=>{announceState().catch(()=>{});}));
    subscriptions.push(client.onStorageDegrade((reason,error)=>{
      storageDegradation={reason,error:error?errorValue(error):null,observedAt:now()};announceState().catch(()=>{});
    }));
    await client.ready();ready=true;await announceState();
    return {
      catalog:()=>copy(POLLAR_BROWSER_ACTIONS),
      describe:snapshot,invoke,reconcile,close,verificationToken,
    };
  }catch(error){
    for(const unsubscribe of subscriptions.splice(0))try{unsubscribe();}catch{}
    try{client?.destroy();}catch{}
    if(clients.get(apiKeySha256)===owner)clients.delete(apiKeySha256);
    throw error;
  }
}
