// MIT. Valyu customer application on the original SF30 client and SF88 Buyer.
import {readFile,lstat,mkdir,realpath} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {native,runtimeRoot} from './runtime.mjs';
import {ValyuStore} from './store.mjs';
import {normalizeValyuProvider,normalizeValyuRequest} from './config.mjs';
import {projectValyuDelivery,valyuUpstreamSha256} from './delivery.mjs';
import {canonical,privateDirectory,privateJson,publish,readBytes,need,object,digest,jsonBytes,now} from './files.mjs';
const {Buyer}=await native('sf88-operator-buyer-cli/node/index.mjs');
export const SETTINGS_SCHEMA='stellar-forge.valyu-workspace.v1';
const PROFILE_KEYS=['operator','signerModule','trustedPayer','bodyCaptureTimeoutMs','buyerTransport','requestTimeoutMs'];
const generated=raw=>/^\/\/ MIT\. Generated from original SF30 seller OpenAPI SHA-256 [a-f0-9]{64}\.\n/.test(raw.toString('utf8',0,180));
const inside=(root,path)=>canonical(path).startsWith(root+'/');
async function retain(path,raw){
  try{
    const old=await readBytes(path,Math.max(raw.length,65536));
    need(digest(old)===digest(raw),'INITIALIZATION_FILE_DIFFERS');
    return {path,bytes:old.length,sha256:digest(old),existing:true};
  }catch(e){if(e.code!=='ENOENT')throw e;return publish(path,raw);}
}
export async function initializeValyu({stateRoot,sellerClient,operatorProfile,originalOperatorDirectory,provider={},merchantPath='/research/search'}){
  canonical(stateRoot);await privateDirectory(stateRoot);
  need(typeof merchantPath==='string'&&merchantPath.startsWith('/')&&!merchantPath.includes('?')&&!merchantPath.includes('#'),'MERCHANT_PATH_INVALID');
  const normalized=normalizeValyuProvider(provider);
  let clientBytes,profile;
  if(sellerClient){
    canonical(sellerClient);clientBytes=await readBytes(sellerClient,2097152);
    need(generated(clientBytes),'ORIGINAL_GENERATED_CLIENT_REQUIRED');
  }
  if(originalOperatorDirectory){
    canonical(originalOperatorDirectory);need(inside(stateRoot,originalOperatorDirectory),'OPERATOR_OUTSIDE_STATE_ROOT');
    await privateDirectory(originalOperatorDirectory,{create:false});
  }
  if(operatorProfile)profile=await privateJson(canonical(operatorProfile));
  else if(originalOperatorDirectory){
    const original=await privateJson(join(originalOperatorDirectory,'operator.json'));
    profile=Object.fromEntries(PROFILE_KEYS.filter(k=>Object.hasOwn(original,k)).map(k=>[k,original[k]]));
  }
  if(profile)need(object(profile)&&Object.keys(profile).every(k=>PROFILE_KEYS.includes(k)),'ORIGINAL_OPERATOR_PROFILE_REQUIRED');
  const settings={schema:SETTINGS_SCHEMA,stateRoot,researchDirectory:join(stateRoot,'research'),buyerDirectory:join(stateRoot,'buyer'),
    provider:normalized,merchantPath,
    ...(clientBytes?{sellerClient:join(stateRoot,'seller-client.mjs'),sellerClientSha256:digest(clientBytes)}:{}),
    ...(profile?{operatorProfile:join(stateRoot,'operator-profile.json')}:{ }),
    ...(originalOperatorDirectory?{originalOperatorDirectory}:{})};
  await privateDirectory(settings.researchDirectory);await privateDirectory(settings.buyerDirectory);
  const files=[];
  if(clientBytes)files.push(await retain(settings.sellerClient,clientBytes));
  if(profile)files.push(await retain(settings.operatorProfile,jsonBytes(profile)));
  files.push(await retain(join(stateRoot,'settings.json'),jsonBytes(settings)));
  const workspace=await ValyuWorkspace.open(settings);workspace.close();
  return {settings,files};
}
export class ValyuWorkspace{
  static async open(settings){
    need(object(settings)&&settings.schema===SETTINGS_SCHEMA&&Object.keys(settings).every(k=>
      ['schema','stateRoot','researchDirectory','buyerDirectory','provider','merchantPath','sellerClient','sellerClientSha256','operatorProfile','originalOperatorDirectory'].includes(k)),'WORKSPACE_SETTINGS_INVALID');
    await privateDirectory(settings.stateRoot,{create:false});
    for(const key of ['researchDirectory','buyerDirectory'])need(inside(settings.stateRoot,settings[key]),'WORKSPACE_PATH_OUTSIDE_ROOT');
    for(const key of ['sellerClient','operatorProfile','originalOperatorDirectory'])if(settings[key]!==undefined)
      need(inside(settings.stateRoot,settings[key]),'WORKSPACE_PATH_OUTSIDE_ROOT');
    const provider=normalizeValyuProvider(settings.provider??{});
    const store=await ValyuStore.open(settings.researchDirectory,{provider});
    try{
      const buyer=new Buyer({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli'),stateDirectory:settings.buyerDirectory,
        ...(settings.operatorProfile?{operatorProfile:settings.operatorProfile}:{})});
      return new ValyuWorkspace(settings,store,buyer,provider);
    }catch(e){store.close();throw e;}
  }
  constructor(settings,store,buyer,provider){this.settings=structuredClone(settings);this.store=store;this.buyer=buyer;this.provider=provider;}
  state(options){
    return {...this.store.list(options),provider:this.provider,
      paymentConfigured:!!this.settings.sellerClient&&(!!this.settings.operatorProfile||!!this.settings.originalOperatorDirectory),
      merchantPath:this.settings.merchantPath??'/research/search'};
  }
  saveQuery(value){return this.store.saveQuery(value);}
  async client(){
    need(this.settings.sellerClient,'ORIGINAL_SELLER_CLIENT_REQUIRED');
    const path=this.settings.sellerClient,raw=await readBytes(path,2097152),sha256=digest(raw);
    need(generated(raw)&&sha256===this.settings.sellerClientSha256,'ORIGINAL_SELLER_CLIENT_CHANGED');
    const module=await import(pathToFileURL(path).href+'?source='+sha256);
    need(digest(await readBytes(path,2097152))===sha256&&typeof module.createSellerClient==='function','ORIGINAL_SELLER_CLIENT_CHANGED');
    return {client:module.createSellerClient({buyer:this.buyer}),sha256};
  }
  async prepare(id,{expectedRevision,maxAtomic,acceptIndex}){
    let q=this.store.query(id);
    need(['DRAFT','PREPARING'].includes(q.phase),'REQUEST_ALREADY_PREPARED');
    need(typeof maxAtomic==='string'&&/^(0|[1-9][0-9]*)$/.test(maxAtomic)&&Number.isSafeInteger(acceptIndex)&&acceptIndex>=0,'EXPLICIT_PAYMENT_SELECTION_REQUIRED');
    let record;
    if(q.phase==='PREPARING'){
      record=q.prepared;need(record?.maxAtomic===maxAtomic&&record.acceptIndex===acceptIndex,'PREPARATION_SELECTION_CHANGED');
    }else{
      const {client,sha256}=await this.client();
      const request=client.request('valyuSearch',{body:q.input},{intentId:'valyu-'+q.id,maxAtomic,acceptIndex,paymentFlow:'authorization'});
      need(request.method==='POST'&&new URL(request.url).pathname===(this.settings.merchantPath??'/research/search')&&
        typeof request.body==='string'&&isDeepStrictEqual(JSON.parse(request.body),q.input),'VALYU_MERCHANT_REQUEST_MISMATCH');
      record={request:structuredClone(request),clientSha256:sha256,clientSource:client.source,maxAtomic,acceptIndex,
        requestSha256:q.requestSha256,nativeWorkspace:this.settings.originalOperatorDirectory??null};
    }
    q=this.store.beginPrepare(id,expectedRevision,record);
    const options={requestTimeoutMs:Math.min(180000,this.provider.timeoutMs+30000),
      responseFile:{maxBytes:this.provider.maxResponseBytes,timeoutMs:Math.min(120000,this.provider.timeoutMs+10000)}};
    let operation;
    try{
      if(record.nativeWorkspace){
        const {body,...originalOperation}=record.request;
        operation=await this.buyer.fromWorkspace(record.nativeWorkspace,{...options,configuration:{operation:originalOperation},body});
      }else operation=await this.buyer.fromRequest(record.request,options);
    }catch(e){
      if(e.code!=='INTENT_ALREADY_EXISTS_USE_RECOVER')throw e;
      operation=this.buyer.operation(record.request.intentId);
    }
    const review=await operation.review(),config=JSON.parse(await readFile(operation.configPath,'utf8'));
    need(review.bodySha256===digest(Buffer.from(record.request.body))&&config.operation.url===record.request.url&&
      config.operation.method===record.request.method&&isDeepStrictEqual(config.operation.expect,record.request.expect)&&
      isDeepStrictEqual(config.operation.headers??{},record.request.headers??{})&&
      (review.nativeWorkspace??null)===(record.nativeWorkspace??null),'ORIGINAL_PREPARATION_BINDING_MISMATCH');
    return this.store.prepared(id,q.requestSha256,{...record,review});
  }
  async review(id){
    const q=this.store.query(id);need(q.prepared?.request?.intentId,'QUERY_NOT_PREPARED');
    return this.buyer.operation(q.prepared.request.intentId).review();
  }
  async inspect(id){
    const q=this.store.query(id);
    return {query:q,native:q.prepared?.request?.intentId?await this.buyer.operation(q.prepared.request.intentId).inspect():null};
  }
  async execute(id,{signal}={}){
    const q=this.store.query(id);need(q.prepared?.review,'QUERY_NOT_PREPARED');
    try{return await this.consume(id,await this.buyer.operation(q.prepared.request.intentId).execute({review:q.prepared.review,signal}));}
    catch(e){if(e.code==='ATTEMPT_ALREADY_RECORDED_USE_RECOVER')return this.collect(id);throw e;}
  }
  async collect(id){
    const q=this.store.query(id);need(q.prepared?.review,'QUERY_NOT_PREPARED');
    const result=await this.buyer.operation(q.prepared.request.intentId).recover();
    if(!result)return {query:q,native:await this.buyer.operation(q.prepared.request.intentId).inspect(),capture:null};
    return this.consume(id,result);
  }
  async consume(id,result){
    const q=this.store.query(id),receipt={native:result.native,
      process:{exitCode:result.record.exitCode??null,exitSignal:result.record.exitSignal??null,
        runtimeError:result.record.runtimeError??null,recovered:!!result.record.recovered},delivery:result.delivery};
    if(result.delivery.status!=='SAVED')return {query:q,...receipt,capture:null};
    const raw=await result.bytes({limit:this.provider.maxResponseBytes});
    const capture=this.store.attachCapture(id,q.requestSha256,raw,{kind:'NATIVE_BUYER',provenance:{
      intentId:q.prepared.request.intentId,merchantUrl:q.prepared.request.url,provider:'Valyu',
      configSha256:q.prepared.review.configSha256,requestBodySha256:q.prepared.review.bodySha256,
      capturedAt:result.record.recordedAt??now(),
      nativeStatus:typeof result.native.status==='string'&&/^[A-Z0-9_]{1,120}$/.test(result.native.status)?result.native.status:null,
      httpStatus:Number.isInteger(result.native.httpStatus)?result.native.httpStatus:null,
      deliveryStatus:result.delivery.status,deliverySha256:result.delivery.sha256,deliveredBytes:result.delivery.bytes,
      exitCode:result.record.exitCode??null,exitSignal:result.record.exitSignal??null,
      runtimeErrorPresent:!!result.record.runtimeError,recovered:!!result.record.recovered}});
    return {query:this.store.query(id),...receipt,capture:this.store.captureView(capture.id)};
  }
  async importObservation(id,{responseFile,requestFile,provenanceFile}){
    const q=this.store.query(id);
    need(!q.prepared&&['DRAFT','CAPTURED'].includes(q.phase),'OBSERVATION_REQUIRES_UNPURCHASED_QUERY');
    const raw=await readBytes(canonical(responseFile),this.provider.maxResponseBytes),
      requestRaw=await readBytes(canonical(requestFile),65536),
      request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(requestRaw)),
      provenance=await privateJson(canonical(provenanceFile),1048576);
    need(isDeepStrictEqual(normalizeValyuRequest(request,this.provider),normalizeValyuRequest(q.input,this.provider)),'OBSERVATION_REQUEST_MISMATCH');
    need(provenance.url==='https://api.valyu.ai/v1/search'&&[200,206].includes(provenance.status)&&
      provenance.requestSha256===digest(requestRaw)&&provenance.sha256===digest(raw)&&
      typeof provenance.capturedAt==='string'&&Number.isFinite(Date.parse(provenance.capturedAt)),'OBSERVATION_PROVENANCE_MISMATCH');
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    const delivery=payload.schema==='stellar-forge.valyu-search-delivery.v1'?payload:
      projectValyuDelivery(payload,{request,profile:this.provider.deliveryProfile,upstreamSha256:valyuUpstreamSha256(raw),receivedAt:provenance.capturedAt,httpStatus:provenance.status});
    const retained=Buffer.from(JSON.stringify(delivery));
    const capture=this.store.attachCapture(id,q.requestSha256,retained,{kind:'PROVIDER_OBSERVATION',observedRequest:request,
      provenance:{url:provenance.url,status:provenance.status,requestSha256:provenance.requestSha256,capturedAt:provenance.capturedAt,
        upstreamSha256:delivery.provider.upstreamSha256,sourceResponseSha256:provenance.sha256,sha256:digest(retained),importedAt:now()}});
    raw.fill(0);
    return this.store.captureView(capture.id);
  }
  async recovery(){
    const root=this.settings.stateRoot,settingsFile=join(root,'settings.json');
    need(this.settings.originalOperatorDirectory,'ORIGINAL_OPERATOR_DIRECTORY_REQUIRED');
    need(isDeepStrictEqual(await privateJson(settingsFile),this.settings),'WORKSPACE_SETTINGS_CHANGED');
    const include=[this.settings.researchDirectory,this.settings.buyerDirectory,settingsFile,
      this.settings.sellerClient,this.settings.operatorProfile].filter(Boolean);
    need([this.settings.originalOperatorDirectory,...include].every(path=>inside(root,path)),'RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
    return {engine:this.buyer.workspaceRecovery(),selection:{directory:this.settings.originalOperatorDirectory,stateRoot:root,include}};
  }
  close(){this.store.close();}
}
