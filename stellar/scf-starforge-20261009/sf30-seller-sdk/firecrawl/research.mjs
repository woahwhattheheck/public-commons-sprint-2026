// MIT. Customer research workflow delegates purchases and recovery to the original SF88 Buyer.
import {readFile,open,lstat,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {native,runtimeRoot} from './runtime.mjs';
import {ResearchStore} from './store.mjs';
import {plain,need,sha,encoded,policy,OPERATIONS,resultView,prepareInput} from './contract.mjs';
const {Buyer}=await native('sf88-operator-buyer-cli/node/index.mjs');
const same=isDeepStrictEqual;
const canonical=path=>{need(typeof path==='string'&&resolve(path)===path,'CANONICAL_PATH_REQUIRED');return path;};
export async function privateJson(path,max=1048576){
  canonical(path);need(await realpath(path)===path,'PRIVATE_FILE_REQUIRED');
  const info=await lstat(path);need(info.isFile()&&(info.mode&0o077)===0&&info.size<=max,'PRIVATE_FILE_REQUIRED');
  const raw=await readFile(path);need(raw.length<=max,'INPUT_FILE_TOO_LARGE');
  return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
}
export async function publish(path,bytes){
  canonical(path);need(Buffer.isBuffer(bytes),'EXPORT_BYTES_REQUIRED');
  const parentPath=dirname(path),info=await lstat(parentPath);
  need(info.isDirectory()&&(info.mode&0o077)===0&&await realpath(parentPath)===parentPath,'PRIVATE_EXPORT_PARENT_REQUIRED');
  const temporary=join(parentPath,'.publishing-'+randomUUID()),result={path,bytes:bytes.length,sha256:sha(bytes)};
  let file,published=false;
  try{
    file=await open(temporary,'wx',0o600);await file.writeFile(bytes);await file.sync();await file.close();file=null;
    await link(temporary,path);published=true;
    const parent=await open(parentPath,'r');try{await parent.sync();}finally{await parent.close();}
    return result;
  }catch(error){
    if(published)error.publication={...result,status:'PUBLISHED_DURABILITY_UNCONFIRMED'};
    throw error;
  }finally{
    if(file)await file.close().catch(()=>{});
    await unlink(temporary).catch(()=>{});
  }
}
/** Retain the original standalone client/profile beside the original operator.
 * An existing private state root may already contain that operator; customer
 * filenames remain create-only and no existing directory or setting is replaced. */
export async function initializeResearch({stateRoot,sellerClient,operatorProfile,originalOperatorDirectory}){
  canonical(stateRoot);
  let clientBytes,profile;
  if(sellerClient){
    canonical(sellerClient);const info=await lstat(sellerClient);
    need(info.isFile()&&!info.isSymbolicLink()&&info.size<=2097152,'ORIGINAL_SELLER_CLIENT_REQUIRED');
    clientBytes=await readFile(sellerClient);
    need(clientBytes.length<=2097152&&/^\/\/ MIT\. Generated from original SF30 seller OpenAPI SHA-256 [a-f0-9]{64}\.\n/.test(clientBytes.toString('utf8',0,180)),
      'ORIGINAL_GENERATED_CLIENT_REQUIRED');
  }
  if(originalOperatorDirectory){
    canonical(originalOperatorDirectory);need(originalOperatorDirectory.startsWith(stateRoot+'/'),'OPERATOR_OUTSIDE_STATE_ROOT');
  }
  if(operatorProfile)profile=(await privateJson(canonical(operatorProfile),65536)).value;
  else if(originalOperatorDirectory){
    const cfg=(await privateJson(join(originalOperatorDirectory,'operator.json'),65536)).value;
    profile=Object.fromEntries(['operator','signerModule','trustedPayer','bodyCaptureTimeoutMs','buyerTransport','requestTimeoutMs']
      .filter(key=>Object.hasOwn(cfg,key)).map(key=>[key,cfg[key]]));
  }
  if(profile)need(plain(profile)&&Object.keys(profile).every(key=>
    ['operator','signerModule','trustedPayer','bodyCaptureTimeoutMs','buyerTransport','requestTimeoutMs'].includes(key)),
    'ORIGINAL_OPERATOR_PROFILE_REQUIRED');
  try{await mkdir(stateRoot,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
  const rootInfo=await lstat(stateRoot);
  need(rootInfo.isDirectory()&&(rootInfo.mode&0o077)===0&&await realpath(stateRoot)===stateRoot,'PRIVATE_CANONICAL_STATE_ROOT_REQUIRED');
  for(const name of ['settings.json','research','buyer','seller-client.mjs','operator-profile.json']){
    try{await lstat(join(stateRoot,name));need(false,'RESEARCH_ALREADY_INITIALIZED');}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const researchDirectory=join(stateRoot,'research'),buyerDirectory=join(stateRoot,'buyer');
  await mkdir(researchDirectory,{mode:0o700});await mkdir(buyerDirectory,{mode:0o700});
  const settings={schema:'stellar-forge.firecrawl-research-settings.v1',stateRoot,researchDirectory,buyerDirectory,
    ...(clientBytes?{sellerClient:join(stateRoot,'seller-client.mjs')}:{}),
    ...(profile?{operatorProfile:join(stateRoot,'operator-profile.json')}:{}),
    ...(originalOperatorDirectory?{originalOperatorDirectory}:{})};
  const retained=[];
  if(clientBytes)retained.push(await publish(settings.sellerClient,clientBytes));
  if(profile)retained.push(await publish(settings.operatorProfile,encoded(profile)));
  retained.push(await publish(join(stateRoot,'settings.json'),encoded(settings)));
  const workspace=await ResearchWorkspace.open(settings);workspace.close();
  return {settings,retained};
}
export class ResearchWorkspace{
  static async open(settings){
    need(plain(settings)&&settings.schema==='stellar-forge.firecrawl-research-settings.v1'&&
      Object.keys(settings).every(k=>['schema','stateRoot','researchDirectory','buyerDirectory','operatorProfile','sellerClient','policy','originalOperatorDirectory'].includes(k)),
      'RESEARCH_SETTINGS_INVALID');
    const base=canonical(settings.stateRoot);
    for(const key of ['researchDirectory','buyerDirectory']){
      canonical(settings[key]);need(settings[key].startsWith(base+'/'),'RESEARCH_PATH_OUTSIDE_STATE_ROOT');
    }
    if(settings.operatorProfile!==undefined)canonical(settings.operatorProfile);
    if(settings.sellerClient!==undefined)canonical(settings.sellerClient);
    if(settings.originalOperatorDirectory!==undefined)canonical(settings.originalOperatorDirectory);
    const store=await ResearchStore.open(settings.researchDirectory);
    try{
      const buyer=new Buyer({runtimeDirectory:join(runtimeRoot,'sf88-operator-buyer-cli'),
        stateDirectory:settings.buyerDirectory,...(settings.operatorProfile?{operatorProfile:settings.operatorProfile}:{})});
      return new ResearchWorkspace(settings,store,buyer);
    }catch(error){store.close();throw error;}
  }
  constructor(settings,store,buyer){this.settings=structuredClone(settings);this.store=store;this.buyer=buyer;this.policy=policy(settings.policy);}
  async client(){
    need(this.settings.sellerClient,'TRUSTED_ORIGINAL_SELLER_CLIENT_REQUIRED');
    const path=this.settings.sellerClient,before=await readFile(path),digest=sha(before);
    need(before.length<=2097152,'SELLER_CLIENT_TOO_LARGE');
    const module=await import(pathToFileURL(path).href+'?source='+digest);
    need(sha(await readFile(path))===digest&&typeof module.createSellerClient==='function','SELLER_CLIENT_CHANGED');
    return {client:module.createSellerClient({buyer:this.buyer}),sha256:digest};
  }
  saveQuery(value){return this.store.saveQuery(value,this.policy);}
  async prepare(id,{expectedRevision,maxAtomic,acceptIndex}){
    let q=this.store.query(id);
    need(q.phase==='DRAFT'||q.phase==='PREPARING','REQUEST_ALREADY_PREPARED');
    let record;
    if(q.phase==='PREPARING'){
      record=q.prepared;
      need(record&&record.maxAtomic===maxAtomic&&record.acceptIndex===acceptIndex,'PREPARATION_SELECTION_CHANGED');
    }else{
      const {client,sha256}=await this.client();
      const request=client.request(q.operation,{body:q.input},{intentId:'firecrawl-'+q.id,maxAtomic,acceptIndex,paymentFlow:'authorization'});
      need(request.method==='POST'&&new URL(request.url).pathname===OPERATIONS[q.operation].path,'FIRECRAWL_MERCHANT_ROUTE_MISMATCH');
      record={request:structuredClone(request),clientSha256:sha256,clientSource:client.source,maxAtomic,acceptIndex,
        inputSha256:q.input_sha,nativeWorkspace:this.settings.originalOperatorDirectory??null};
    }
    q=this.store.beginPrepare(id,expectedRevision,record);
    let op;
    try{
      const options={requestTimeoutMs:Math.min(180000,this.policy.sourceTimeoutMs+30000),
        responseFile:{maxBytes:this.policy.maxResponseBytes,timeoutMs:Math.min(120000,this.policy.sourceTimeoutMs+10000)}};
      if(record.nativeWorkspace){
        const {body,...operation}=record.request;
        op=await this.buyer.fromWorkspace(record.nativeWorkspace,{...options,configuration:{operation},body});
      }else op=await this.buyer.fromRequest(record.request,options);
    }catch(error){
      if(error.code!=='INTENT_ALREADY_EXISTS_USE_RECOVER')throw error;
      op=this.buyer.operation(record.request.intentId);
    }
    const review=await op.review();
    const config=JSON.parse(await readFile(op.configPath,'utf8'));
    need(review.bodySha256===sha(Buffer.from(record.request.body??''))&&
      config.operation.url===record.request.url&&config.operation.method===record.request.method&&
      same(config.operation.expect,record.request.expect)&&same(config.operation.headers??{},record.request.headers??{})&&
      (review.nativeWorkspace??null)===(record.nativeWorkspace??null),'ORIGINAL_PREPARATION_BINDING_MISMATCH');
    return this.store.prepared(id,q.input_sha,{...record,review});
  }
  async review(id){
    const q=this.store.query(id);need(q.prepared?.request?.intentId,'QUERY_NOT_PREPARED');
    return this.buyer.operation(q.prepared.request.intentId).review();
  }
  async inspect(id){
    const q=this.store.query(id);
    if(!q.prepared?.request?.intentId)return {query:q,native:null};
    return {query:q,native:await this.buyer.operation(q.prepared.request.intentId).inspect()};
  }
  async execute(id,{signal}={}){
    const q=this.store.query(id);need(q.prepared?.review,'QUERY_NOT_PREPARED');
    const result=await this.buyer.operation(q.prepared.request.intentId).execute({review:q.prepared.review,signal});
    return this.consume(id,result);
  }
  async collect(id){
    const q=this.store.query(id);need(q.prepared?.review,'QUERY_NOT_PREPARED');
    const result=await this.buyer.operation(q.prepared.request.intentId).recover();
    if(!result)return {query:q,native:await this.buyer.operation(q.prepared.request.intentId).inspect(),capture:null};
    return this.consume(id,result);
  }
  async consume(id,result){
    const q=this.store.query(id);
    const record={native:result.native,process:{exitCode:result.record.exitCode,exitSignal:result.record.exitSignal,
      runtimeError:result.record.runtimeError,recovered:result.record.recovered},delivery:result.delivery};
    if(result.delivery.status!=='SAVED')return {query:q,...record,capture:null};
    const bytes=await result.bytes({limit:this.policy.maxResponseBytes});
    const captured=this.store.attachCapture(id,q.input_sha,bytes,{kind:'NATIVE_BUYER',provenance:{
      intentId:q.prepared.request.intentId,merchantUrl:q.prepared.request.url,
      configSha256:q.prepared.review.configSha256,requestBodySha256:q.prepared.review.bodySha256,
      provider:'Firecrawl',...record}});
    return {query:this.store.query(id),...record,capture:{id:captured.id,sha256:captured.sha,bytes:bytes.length}};
  }
  /** Explicit observation import for a provider's retained raw source response.
   * This never constructs a Buyer receipt or changes an existing native attempt. */
  async importObservation(id,{responseFile,requestFile,provenanceFile}){
    const q=this.store.query(id);need(q.phase==='DRAFT'||(q.phase==='CAPTURED'&&!q.prepared),'OBSERVATION_REQUIRES_UNPURCHASED_QUERY');
    const info=await lstat(responseFile);need(info.isFile()&&!info.isSymbolicLink()&&info.size<=this.policy.maxResponseBytes,'OBSERVATION_FILE_INVALID');
    const raw=await readFile(responseFile);need(raw.length<=this.policy.maxResponseBytes,'OBSERVATION_FILE_INVALID');
    const requestBytes=await readFile(requestFile);need(requestBytes.length<=65536,'OBSERVATION_REQUEST_TOO_LARGE');
    const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(requestBytes));
    need(same(request,prepareInput(q.operation,q.input,this.policy)),'OBSERVATION_REQUEST_MISMATCH');
    const provenance=JSON.parse(await readFile(provenanceFile,'utf8'));
    need(provenance.requestSha256===sha(requestBytes)&&typeof provenance.capturedAt==='string','OBSERVATION_REQUEST_PROVENANCE_REQUIRED');
    need(plain(provenance)&&provenance.url==='https://api.firecrawl.dev'+OPERATIONS[q.operation].upstream&&
      provenance.status===200&&provenance.sha256===sha(raw),'OBSERVATION_PROVENANCE_MISMATCH');
    const capture=this.store.attachCapture(id,q.input_sha,raw,{kind:'PROVIDER_OBSERVATION',provenance:{
      ...provenance,accounting:'No buyer payment record supplied',importedAt:new Date().toISOString()}});
    return {id:capture.id,sha256:capture.sha,kind:capture.kind};
  }
  compare(leftId,rightId){
    const left=this.store.capture(leftId),right=this.store.capture(rightId);
    const index=capture=>{
      const values=new Map();
      for(const row of resultView(capture.query.operation,capture.payload).rows){
        const identity=JSON.stringify([row.group,row.url,row.imageUrl]);
        const list=values.get(identity)??[];list.push(row);values.set(identity,list);
      }
      return values;
    };
    const a=index(left),b=index(right),changes=[];
    for(const key of new Set([...a.keys(),...b.keys()])){
      const from=a.get(key)??[],to=b.get(key)??[];
      for(let i=0;i<Math.max(from.length,to.length);i++){
        const old=from[i],next=to[i],fields=[];
        if(old&&next)for(const field of ['title','description','date','contentSha256'])if(!same(old[field],next[field]))fields.push(field);
        if(!old||!next||fields.length)changes.push({status:!old?'ADDED':!next?'REMOVED':'CHANGED',url:(next??old).url,
          group:(next??old).group,occurrence:i,fields,from:old??null,to:next??null});
      }
    }
    return {left:{id:left.id,sha256:left.sha,input:left.query.input},right:{id:right.id,sha256:right.sha,input:right.query.input},changes,
      semantics:'Differences between the two retained provider responses; result rank and source coverage may change.'};
  }
  async recovery(){
    const root=this.settings.stateRoot,settingsFile=join(root,'settings.json');
    need(this.settings.originalOperatorDirectory,'ORIGINAL_OPERATOR_DIRECTORY_REQUIRED');
    need(same((await privateJson(settingsFile,65536)).value,this.settings),'RESEARCH_SETTINGS_CHANGED');
    const include=[this.settings.researchDirectory,this.settings.buyerDirectory,settingsFile,
      this.settings.sellerClient,this.settings.operatorProfile].filter(Boolean);
    need([this.settings.originalOperatorDirectory,...include].every(path=>path.startsWith(root+'/')),'RESEARCH_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
    return {engine:this.buyer.workspaceRecovery(),selection:{directory:this.settings.originalOperatorDirectory,stateRoot:root,include}};
  }
  close(){this.store.close();}
}
