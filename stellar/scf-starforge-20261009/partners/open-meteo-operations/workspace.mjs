// MIT. Complete weather customer operations over the original SF88 buyer and recovery.
import {readFile,lstat,realpath,mkdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {native,runtimeRoot} from './runtime.mjs';
import {WeatherStore} from './store.mjs';
import {absolute,privateDirectory,readPrivate,readJson,publish,publishJson} from './files.mjs';
import {SCHEMA,FAMILIES,MAX_RESPONSE_BYTES,providerProfile,providerUrl,publicQuery,need,keys,sha,clone,canonical,parsePayload,ATTRIBUTION} from './contract.mjs';
import {series,compare} from './analysis.mjs';
const {Buyer,WorkspaceRecovery}=await native('sf88-operator-buyer-cli/node/index.mjs');
const {createPublicHttpsFetch}=await native('sf31-buyer-client/public-transport.mjs');
export async function initializeWeather({stateRoot,originalOperatorDirectory,sellerClient,setupDirectory,provider={mode:'evaluation'}}){
 absolute(stateRoot);await privateDirectory(stateRoot,{create:true});provider=providerProfile(provider);
 need(originalOperatorDirectory!==undefined,'ORIGINAL_BUYER_OPERATOR_REQUIRED');absolute(originalOperatorDirectory);
 need(originalOperatorDirectory.startsWith(stateRoot+'/'),'ORIGINAL_OPERATOR_OUTSIDE_STATE_ROOT');
 const {openWorkspace}=await native('sf88-operator-buyer-cli/workspace.mjs');
 await openWorkspace(['--dir',originalOperatorDirectory],{accounting:true});
 for(const name of ['settings.json','weather','buyer','seller-client.mjs']){
  try{await lstat(join(stateRoot,name));need(false,'WEATHER_ALREADY_INITIALIZED');}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 let clientBytes;
 if(sellerClient){
  absolute(sellerClient);const st=await lstat(sellerClient);
  need(st.isFile()&&!st.isSymbolicLink()&&st.size<=2097152&&await realpath(sellerClient)===sellerClient,'ORIGINAL_SELLER_CLIENT_REQUIRED');
  clientBytes=await readFile(sellerClient);
  need(clientBytes.length<=2097152&&/^\/\/ MIT\. Generated from original SF30 seller OpenAPI SHA-256 [a-f0-9]{64}\.\n/.test(clientBytes.toString('utf8',0,180)),'ORIGINAL_GENERATED_CLIENT_REQUIRED');
 }
 if(setupDirectory){need(setupDirectory===join(stateRoot,'setup'),'SETUP_PATH_BINDING_CHANGED');await privateDirectory(setupDirectory);}
 const settings={schema:SCHEMA,stateRoot,weatherDirectory:join(stateRoot,'weather'),buyerDirectory:join(stateRoot,'buyer'),
  originalOperatorDirectory,provider,...(setupDirectory?{setupDirectory}:{}),...(clientBytes?{sellerClient:join(stateRoot,'seller-client.mjs'),sellerClientSha256:sha(clientBytes)}:{})};
 await privateDirectory(settings.weatherDirectory,{create:true});await privateDirectory(settings.buyerDirectory,{create:true});
 if(clientBytes)await publish(settings.sellerClient,clientBytes);
 const stored=await publishJson(join(stateRoot,'settings.json'),settings);
 const workspace=await WeatherWorkspace.open(settings);await workspace.close();
 return {settings,stored};
}
export async function readWeatherSettings(path){const settings=await readJson(absolute(path));return validateSettings(settings);}
function validateSettings(settings){
 keys(settings,['schema','stateRoot','weatherDirectory','buyerDirectory','originalOperatorDirectory','provider','sellerClient','sellerClientSha256','setupDirectory']);
 need(settings.schema===SCHEMA,'WEATHER_SETTINGS_SCHEMA_INVALID');absolute(settings.stateRoot);
 for(const key of ['weatherDirectory','buyerDirectory','originalOperatorDirectory']){absolute(settings[key]);need(settings[key].startsWith(settings.stateRoot+'/'),'WEATHER_PATH_OUTSIDE_STATE_ROOT');}
 need(settings.weatherDirectory===join(settings.stateRoot,'weather')&&settings.buyerDirectory===join(settings.stateRoot,'buyer'),'WEATHER_PATH_BINDING_CHANGED');
 providerProfile(settings.provider);
 if(settings.setupDirectory!==undefined)need(settings.setupDirectory===join(settings.stateRoot,'setup'),'SETUP_PATH_BINDING_CHANGED');
 if(settings.sellerClient!==undefined)need(settings.sellerClient===join(settings.stateRoot,'seller-client.mjs')&&/^[a-f0-9]{64}$/.test(settings.sellerClientSha256),'CLIENT_PATH_BINDING_CHANGED');
 return clone(settings);
}
export class WeatherWorkspace{
 static async open(input,{environment=process.env}={}){
  const settings=validateSettings(input);await privateDirectory(settings.stateRoot);
  const saved=await readJson(join(settings.stateRoot,'settings.json'));
  need(isDeepStrictEqual(settings,saved),'WEATHER_SETTINGS_CHANGED');
  await privateDirectory(settings.originalOperatorDirectory);await privateDirectory(settings.buyerDirectory);
  const store=await WeatherStore.open(settings.weatherDirectory);
  try{
   const buyer=new Buyer({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli'),stateDirectory:settings.buyerDirectory,environment,timeoutMs:360000});
   return new WeatherWorkspace(settings,store,buyer,environment);
  }catch(error){await store.close();throw error;}
 }
 constructor(settings,store,buyer,environment){this.settings=clone(settings);this.store=store;this.buyer=buyer;this.environment={...environment};this.tail=Promise.resolve();this.closed=false;this.active=null;}
 serial(fn){need(!this.closed,'WEATHER_WORKSPACE_CLOSED');const operation=this.tail.then(fn);this.tail=operation.catch(()=>{});return operation;}
 summary(){return this.serial(()=>this.store.summary());}
 saveSite(input){return this.serial(()=>this.store.saveSite(input));}
 saveRequest(input){return this.serial(()=>this.store.saveRequest(input));}
 saveDecision(input){return this.serial(()=>this.store.saveDecision(input));}
 freezeReport(input){return this.serial(()=>this.store.freezeReport(input));}
 report(id){return this.serial(()=>this.store.report(id));}
 events(options){return this.serial(()=>this.store.events(options));}
 capture(id){return this.serial(()=>this.store.capture(id));}
 series(id,variable,options){return this.serial(()=>series(this.store.capture(id).view,variable,options));}
 compare(left,right,options){return this.serial(()=>compare(this.store.capture(left).view,this.store.capture(right).view,options));}
 async sourceCapture(id,{expectedRevision,signal}={}){
  return this.serial(async()=>{
   const q=this.store.beginSource(id,expectedRevision),request=q.spec.request,profile=this.settings.provider;
   const publicUrl=providerUrl(request,profile);let response,retainedRead;
   try{
   const privateUrl=providerUrl(request,profile,{env:this.environment,credential:true});
   // The original transport pins this configured origin and uses its normal
   // public-DNS/TLS policy or the explicitly selected resolving CONNECT proxy.
   const options={timeoutMs:100000,...(profile.proxyEnv?{trustedProxy:{mode:'explicit-connect',origin:privateUrl.origin,proxyEnv:profile.proxyEnv}}:{})};
   if(profile.proxyEnv)need(this.environment[profile.proxyEnv]===process.env[profile.proxyEnv],'PROVIDER_PROXY_ENVIRONMENT_CHANGED');
   const fetch=createPublicHttpsFetch(options);
    response=await fetch(privateUrl.href,{method:'GET',headers:{accept:'application/json'},redirect:'manual',signal});
    need(response.status===200,'WEATHER_PROVIDER_HTTP_'+response.status);
    need(/^application\/json(?:;|$)/i.test(response.headers.get('content-type')??''),'WEATHER_PROVIDER_CONTENT_TYPE');
    const reader=response.body.getReader(),chunks=[];let count=0;
    try{for(;;){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;need(count<=MAX_RESPONSE_BYTES,'WEATHER_RESPONSE_TOO_LARGE');chunks.push(Buffer.from(value));}}
    catch(error){await reader.cancel().catch(()=>{});throw error;}
    const bytes=Buffer.concat(chunks);
    const provenance={kind:'PROVIDER_CAPTURE',sourceAttempt:q.sourceAttempt,
     sourceUrl:publicUrl.href,providerMode:profile.mode,httpStatus:200,retrievedAt:new Date().toISOString(),
     requestSha256:sha(Buffer.from(publicQuery(request).toString())),httpRequests:1,
     accounting:'A provider read; local HTTP request count is not the provider billing-unit count.',attribution:ATTRIBUTION};
    retainedRead=this.store.retainSourceRead(id,q.specSha256,bytes,provenance);
    const captured=this.store.attachCapture(id,q.specSha256,bytes,provenance);
    return {request:this.store.request(id),capture:withoutRaw(captured)};
   }catch(error){
    await response?.body?.cancel().catch(()=>{});
    const failure={code:safeCode(error),sourceAttempt:q.sourceAttempt,sourceUrl:publicUrl.href,observedAt:new Date().toISOString(),...(retainedRead?{retainedRead}: {})};
    this.store.sourceFailed(id,q.specSha256,failure);throw Object.assign(new Error(failure.code),{code:failure.code});
   }
  });
 }
 reprocessSource(id,{expectedRevision}={}){
  return this.serial(()=>{const q=this.store.request(id),read=this.store.sourceRead(id);
   need(q.native===null&&read?.specSha256===q.specSha256,'RETAINED_PROVIDER_READ_REQUIRED');
   this.store.beginSource(id,expectedRevision,{reprocess:true});
   try{const capture=this.store.attachCapture(id,q.specSha256,read.raw,read.provenance);return {request:this.store.request(id),capture:withoutRaw(capture),sourceHttpRequests:0};}
   catch(error){this.store.sourceFailed(id,q.specSha256,{code:safeCode(error),retainedRead:{id:read.id,sha256:read.sha256,bytes:read.bytes},observedAt:new Date().toISOString()});throw error;}
  });
 }
 async client(){
  need(this.settings.sellerClient,'ORIGINAL_MERCHANT_CLIENT_REQUIRED');
  const bytes=await readPrivate(this.settings.sellerClient,2097152);need(sha(bytes)===this.settings.sellerClientSha256,'ORIGINAL_CLIENT_CHANGED');
  const module=await import(pathToFileURL(this.settings.sellerClient).href+'?source='+this.settings.sellerClientSha256);
  need(typeof module.createSellerClient==='function'&&sha(await readPrivate(this.settings.sellerClient,2097152))===this.settings.sellerClientSha256,'ORIGINAL_CLIENT_CHANGED');
  return module.createSellerClient({buyer:this.buyer});
 }
 prepare(id,{expectedRevision,maxAtomic,acceptIndex=0,directEvaluation=false,signal}={}){
  return this.serial(async()=>{
   let q=this.store.request(id);need(q.revision===expectedRevision,'REQUEST_REVISION_CHANGED');
   need(typeof maxAtomic==='string'&&/^[1-9]\d{0,37}$/.test(maxAtomic)&&Number.isSafeInteger(acceptIndex)&&acceptIndex>=0,'EXPLICIT_BUYER_BUDGET_REQUIRED');
   let record;
   if(q.state==='PREPARING'){
    record=q.native;need(record.maxAtomic===maxAtomic&&record.acceptIndex===acceptIndex&&record.directEvaluation===directEvaluation,'PREPARATION_SELECTION_CHANGED');
   }else{
    need(q.state==='DRAFT','BUYER_PREPARATION_REQUIRES_NEW_REQUEST');let request;
    if(directEvaluation){
     need(this.settings.provider.mode==='evaluation','DIRECT_BUYER_IS_EVALUATION_ONLY');
     const cfg=await readJson(join(this.settings.originalOperatorDirectory,'operator.json'),65536);
     need(cfg.operation?.expect,'ORIGINAL_EXPECTED_TERMS_REQUIRED');
     request={url:providerUrl(q.spec.request,this.settings.provider).href,method:'GET',intentId:'weather-'+q.id,
      headers:{accept:'application/json'},expect:{...cfg.operation.expect,maxAtomic}};
    }else{
     const client=await this.client();
     request=client.request(FAMILIES[q.spec.request.family].operation,{query:Object.fromEntries(publicQuery(q.spec.request))},
      {intentId:'weather-'+q.id,maxAtomic,acceptIndex,paymentFlow:'authorization'});
     const url=new URL(request.url);
     need(request.method==='GET'&&url.pathname===FAMILIES[q.spec.request.family].merchantPath&&url.searchParams.toString()===publicQuery(q.spec.request).toString(),'WEATHER_MERCHANT_REQUEST_MISMATCH');
    }
    record={request:clone(request),specSha256:q.specSha256,maxAtomic,acceptIndex,directEvaluation,
     nativeWorkspace:this.settings.originalOperatorDirectory,sellerClientSha256:this.settings.sellerClientSha256??null};
   }
   q=this.store.beginPrepare(id,expectedRevision,record);
   let op;
   try{op=await this.buyer.fromWorkspace(record.nativeWorkspace,{configuration:{operation:record.request},
    requestTimeoutMs:120000,responseFile:{maxBytes:MAX_RESPONSE_BYTES,timeoutMs:110000},signal});}
   catch(error){if(error.code!=='INTENT_ALREADY_EXISTS_USE_RECOVER')throw error;op=this.buyer.operation(record.request.intentId);}
   const review=await op.review(),config=await readJson(op.configPath,65536);
   need(review.native?.bodyPresent===false&&review.native.bodyBytes===0&&!Object.hasOwn(config.operation,'body')&&!Object.hasOwn(config.operation,'bodyFile')&&review.nativeWorkspace===record.nativeWorkspace&&
    config.operation.url===record.request.url&&config.operation.method==='GET'&&
    isDeepStrictEqual(config.operation.expect,record.request.expect)&&isDeepStrictEqual(config.operation.headers??{},record.request.headers??{}),'NATIVE_WEATHER_BINDING_CHANGED');
   return this.store.prepared(id,q.specSha256,{...record,review});
  });
 }
 inspect(id){return this.serial(async()=>{const q=this.store.request(id);return {request:q,native:q.native?await this.buyer.operation(q.native.request.intentId).inspect():null};});}
 execute(id,{signal}={}){
  return this.serial(async()=>{const q=this.store.request(id);need(q.native?.review,'BUYER_NOT_PREPARED');
   const result=await this.buyer.operation(q.native.request.intentId).execute({review:q.native.review,signal});return this.consume(q,result);});
 }
 recover(id){
  return this.serial(async()=>{const q=this.store.request(id);need(q.native?.review,'BUYER_NOT_PREPARED');
   const result=await this.buyer.operation(q.native.request.intentId).recover();
   if(!result)return {request:q,native:await this.buyer.operation(q.native.request.intentId).inspect(),capture:null};
   return this.consume(q,result);});
 }
 async consume(q,result){
  const outcome={native:result.native,delivery:result.delivery,process:{exitCode:result.record.exitCode??null,
   exitSignal:result.record.exitSignal??null,runtimeError:result.record.runtimeError??null,recovered:result.record.recovered??false}};
  this.store.nativeOutcome(q.id,outcome);
  if(result.delivery.status!=='SAVED')return {request:this.store.request(q.id),...outcome,capture:null};
  const bytes=await result.bytes({limit:MAX_RESPONSE_BYTES});
  const capture=this.store.attachCapture(q.id,q.specSha256,bytes,{kind:'NATIVE_BUYER',intentId:q.native.request.intentId,
   configSha256:q.native.review.configSha256,requestUrl:q.native.request.url,providerMode:this.settings.provider.mode,
   retrievedAt:result.record.recordedAt??new Date().toISOString(),delivery:result.delivery,native:result.native,attribution:ATTRIBUTION});
  return {request:this.store.request(q.id),...outcome,capture:withoutRaw(capture)};
 }
 recoverySelection(){return {directory:this.settings.originalOperatorDirectory,stateRoot:this.settings.stateRoot,
  include:[this.settings.weatherDirectory,this.settings.buyerDirectory,join(this.settings.stateRoot,'settings.json'),
   ...(this.settings.sellerClient?[this.settings.sellerClient]:[]),...(this.settings.setupDirectory?[this.settings.setupDirectory]:[])]};}
 recoveryReview(){return this.serial(async()=>this.buyer.workspaceRecovery().inspect(this.recoverySelection()));}
 snapshot({output,passphraseEnv='OPEN_METEO_BACKUP_PASSPHRASE',signal}={}){
  return this.serial(async()=>{
   absolute(output);need(!output.startsWith(this.settings.stateRoot+'/'),'BACKUP_MUST_BE_OUTSIDE_STATE');
   const selection=this.recoverySelection();await this.buyer.workspaceRecovery().inspect(selection);
   this.store.closeDatabase();
   let result,problem;
   try{result=await this.buyer.workspaceRecovery().snapshot({...selection,output,quiesced:true,passphraseEnv,signal});}
   catch(error){problem=error;}
   try{this.store.reopenDatabase();}catch(error){
    if(result)return {native:result.native,process:result.process,weatherReopenError:safeCode(error)};
    if(problem)problem.weatherReopenError=safeCode(error);else throw error;
   }
   if(problem)throw problem;return result;
  });
 }
 job(){return this.active?{id:this.active.id,kind:this.active.kind,state:this.active.state,startedAt:this.active.startedAt,
  finishedAt:this.active.finishedAt??null,result:this.active.result??null,error:this.active.error??null}:null;}
 start(kind,run){
  need(!this.closed,'WEATHER_WORKSPACE_CLOSED');if(this.active?.state==='RUNNING')return this.job();
  const job={id:'job-'+randomUUID(),kind,state:'RUNNING',startedAt:new Date().toISOString(),controller:new AbortController()};
  this.active=job;job.promise=Promise.resolve().then(()=>run(job.controller.signal)).then(result=>{job.result=cleanResult(result);job.state='COMPLETED';},error=>{
   job.error={code:safeCode(error),...(error.result?{native:cleanResult(error.result)}:{})};job.state=job.controller.signal.aborted?'CANCELLED':'FAILED';
  }).finally(()=>{job.finishedAt=new Date().toISOString();});return this.job();
 }
 cancel(id){need(this.active?.id===id,'ACTIVE_JOB_CHANGED');if(this.active.state==='RUNNING')this.active.controller.abort(Object.assign(new Error('OPERATOR_CANCELLED'),{code:'OPERATOR_CANCELLED'}));return this.job();}
 async close(){if(this.closed)return;this.active?.controller.abort();await this.active?.promise;await this.tail;this.closed=true;await this.store.close();}
}
export function safeCode(error){const code=String(error?.code??'WEATHER_OPERATION_FAILED');return /^[A-Z0-9_]{1,120}$/.test(code)?code:'WEATHER_OPERATION_FAILED';}
export function withoutRaw(capture){const {raw,view,...rest}=capture;return rest;}
export function cleanResult(result){
 if(result===null||result===undefined)return result??null;
 if(result instanceof Uint8Array)return {bytes:result.byteLength,sha256:sha(result)};
 if(Array.isArray(result))return result.map(cleanResult);
 if(typeof result==='object'){
  const allowed={};for(const [k,v]of Object.entries(result)){if(['raw','view','promise','controller','run'].includes(k)||typeof v==='function')continue;allowed[k]=cleanResult(v);}return allowed;
 }
 return result;
}
export async function verifyWeather({bundle,expectedRecordSha256,passphraseEnv='OPEN_METEO_BACKUP_PASSPHRASE',environment=process.env,signal}){
 return new WorkspaceRecovery({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli'),environment})
  .verify({bundle: absolute(bundle),expectedRecordSha256,passphraseEnv,signal});
}
export async function restoreWeather({bundle,expectedRecordSha256,passphraseEnv='OPEN_METEO_BACKUP_PASSPHRASE',environment=process.env,signal}){
 return new WorkspaceRecovery({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli'),environment})
  .restore({bundle:absolute(bundle),expectedRecordSha256,passphraseEnv,signal});
}
