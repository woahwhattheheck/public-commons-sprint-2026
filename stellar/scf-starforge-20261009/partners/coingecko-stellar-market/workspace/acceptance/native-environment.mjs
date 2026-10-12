// MIT. Native acceptance uses the original Starforge provider, facilitator and buyer.
import {readFile,writeFile,mkdir,rename,chmod,stat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {connect as tcpConnect} from 'node:net';
import {isDeepStrictEqual} from 'node:util';

const ENV_FILE=resolve(process.argv[2]);
const PREPARE=process.argv.includes('--prepare');
const E=JSON.parse(await readFile(ENV_FILE,'utf8'));
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'../../../../../..');
if(ROOT!==resolve(E.sourceRoot))throw new Error('Native helper and configured original source root differ.');
import {MarketModel} from '../model.mjs';
import {startMarketWorkspace} from '../server.mjs';
import {CONTRACTS,requestFromContext} from '../../contracts.mjs';
import {prepareCoinGeckoProduct,startCoinGeckoService} from '../../provider.mjs';
import {originalBazaarExample} from '../capture.mjs';
import {prepareReview} from '../../../../sf88-operator-buyer-cli/prepare.mjs';
import {initializeWorkspace,openWorkspace} from '../../../../sf88-operator-buyer-cli/workspace.mjs';
import {createPublicHttpsFetch} from '../../../../sf31-buyer-client/public-transport.mjs';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code})};
async function json(path){return JSON.parse(await readFile(path,'utf8'))}
async function exists(path){return stat(path).then(()=>true).catch(error=>{if(error.code==='ENOENT')return false;throw error})}
async function save(path,value){
 await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
 const tmp=path+'.writing-'+process.pid;await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});
 await rename(tmp,path);await chmod(path,0o600);
}
const STATE_FILE=join(E.directory,'preparation.json');
let C=await exists(STATE_FILE)?await json(STATE_FILE):{schema:'coingecko.native-preparation.v1',steps:{},requests:{},vendorCaptures:{},sampleCaptures:{},sources:[]};
const persist=()=>save(STATE_FILE,C);
const actor='Native CoinGecko source preparation';
let model,workspace,seller,facilitator,tls,proxy,stopping=false;
const sockets=new Set();
const track=socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));socket.on('error',()=>{});return socket};
const listen=(server,port)=>new Promise((accept,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.off('error',reject);accept(server.address().port)})});
async function closeServer(server){if(!server)return;await new Promise(done=>server.close(done));}
async function stop(){
 if(stopping)return;stopping=true;
 await workspace?.close();
 if(model){model.close();model=null}
 await seller?.close();
 await facilitator?.drain();
 for(const socket of sockets)socket.destroy();
 await Promise.allSettled([closeServer(tls),closeServer(proxy)]);
}
async function retainedStep(key,body,perform){
 let step=C.steps[key];
 if(step?.done)return step.value;
 if(!step){step=C.steps[key]={body};await persist()}
 const result=await perform(step.body);step.value=result.value??result;step.done=true;await persist();return step.value;
}
const envelope=(key,value={})=>({actor,opId:E.operationId+':'+key,...(C.projectId?{revision:model.store.project(C.projectId).revision}:{}),...value});
function requestFor(contract,metadata){
 const url=new URL(metadata.url);
 const marker='/api/v3/x402';
 need(url.pathname.startsWith(marker+'/'),'ORIGINAL_VENDOR_PATH_CHANGED');
 const suffix=url.pathname.slice(marker.length);
 const names=[];
 const pattern=contract.pathTemplate.replace(/[.*+?^$()|[\]\\]/g,'\\$&').replace(/\{([^}]+)\}/g,(_,name)=>{names.push(name);return'([^/]+)'});
 const match=new RegExp('^'+pattern+'$').exec(suffix);
 need(match,'ORIGINAL_VENDOR_ENDPOINT_MISMATCH');
 const pathParams=Object.fromEntries(names.map((name,index)=>[name,decodeURIComponent(match[index+1])]));
 const query={};for(const[key,value]of url.searchParams){need(!Object.hasOwn(query,key),'REPEATED_ORIGINAL_QUERY');query[key]=value}
 const normalized=requestFromContext(contract.id,{pathParams,query});
 return{...normalized,name:contract.name+' / original provider example',
   notes:'Original CoinGecko HTTP source retained separately. This development merchant serves that source’s exact Bazaar output example; its values are not current quotes.'};
}
async function sourcePacket(){
 const definitions=[
  ['simple-price','public-unpaid-response','public-payment-required'],
  ['token-prices','onchain-token-price-response','onchain-token-price-payment-required'],
  ['search-pools','search-pools-response','search-pools-payment-required'],
  ['trending-pools','trending-pools-response','trending-pools-payment-required'],
  ['token-data','token-data-response','token-data-payment-required']
 ];
 const sources=[];
 for(const[endpoint,stem,challengeStem]of definitions){
  const metadataFile=join(E.vendorSourceDirectory,stem+'.json'),bodyFile=join(E.vendorSourceDirectory,stem+'.bin');
  const metadataBytes=await readFile(metadataFile),metadata=JSON.parse(metadataBytes);
  const body=await readFile(bodyFile);
  need(metadata.status===402&&metadata.method==='GET'&&metadata.signed_payment_supplied===false,'ORIGINAL_UNSIGNED_SOURCE_REQUIRED');
  need(metadata.body_sha256===digest(body)&&metadata.bytes===body.length,'ORIGINAL_HTTP_BODY_CHANGED');
  const header=Object.entries(metadata.headers).find(([name])=>name.toLowerCase()==='payment-required')?.[1];
  need(typeof header==='string','ORIGINAL_PAYMENT_REQUIRED_HEADER');
  const rawChallenge=Buffer.from(header,'base64');
  const companion=await readFile(join(E.vendorSourceDirectory,challengeStem+'.json'));
  const original=JSON.parse(rawChallenge);
  need(original.x402Version===2&&isDeepStrictEqual(JSON.parse(companion),original),'ORIGINAL_CHALLENGE_COMPANION_CHANGED');
  const sample=originalBazaarExample(rawChallenge),contract=CONTRACTS.find(c=>c.id===endpoint);
  sources.push({endpoint,metadataFile,bodyFile,metadataBytes,metadata,body,rawChallenge,sample,
    request:requestFor(contract,metadata),metadataSha256:digest(metadataBytes),bodySha256:digest(body),sampleSha256:digest(sample.bytes)});
 }
 return sources;
}
async function startTransport(product,resolveData){
 if(PREPARE){
  seller=await startCoinGeckoService({product,port:E.ports.seller,resolveData});
 }else{
  const[{createNativeFacilitator},{createNativeSellerServer}]=await Promise.all([
   import('../../../../native-facilitator/runtime.mjs'),
   import('../../../../sf30-seller-sdk/native-factory.mjs')
  ]);
  facilitator=await createNativeFacilitator(C.facilitatorConfig,{environment:process.env});
  seller=await startCoinGeckoService({product,port:E.ports.seller,resolveData,
   nativeFactory:compiled=>createNativeSellerServer(compiled,{facilitatorClient:facilitator})});
 }
 E.ports.seller=new URL(seller.url).port*1;
 tls=httpsServer({key:await readFile(E.tlsKeyFile),cert:await readFile(E.tlsCertificateFile)},(request,response)=>{
  const upstream=httpRequest({hostname:'127.0.0.1',port:E.ports.seller,path:request.url,method:request.method,
   headers:request.headers,agent:false},incoming=>{response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response)});
  upstream.on('error',()=>{if(!response.headersSent)response.writeHead(502,{'content-type':'application/json'});response.end('{"error":"DEVELOPMENT_UPSTREAM_UNAVAILABLE"}')});
  request.once('aborted',()=>upstream.destroy());response.once('close',()=>{if(!response.writableEnded)upstream.destroy()});
  request.pipe(upstream);
 });
 tls.on('connection',track);
 E.ports.tls=await listen(tls,E.ports.tls);
 const merchantHost=new URL(E.merchantOrigin).hostname.toLowerCase(),rpcHost=new URL(E.rpcUrl).hostname.toLowerCase();
 proxy=httpServer((req,res)=>{res.writeHead(405);res.end()});
 proxy.on('connection',track);
 proxy.on('connect',(request,socket,head)=>{
  const target=String(request.url).toLowerCase();
  if(target!==merchantHost+':443'&&target!==rpcHost+':443'){socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return}
  const local=target===merchantHost+':443',upstream=track(tcpConnect({host:local?'127.0.0.1':rpcHost,port:local?E.ports.tls:443}));
  upstream.setTimeout(90000,()=>upstream.destroy());
  upstream.once('connect',()=>{socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);upstream.pipe(socket);socket.pipe(upstream)});
  upstream.once('error',()=>socket.destroy());socket.once('error',()=>upstream.destroy());socket.once('close',()=>upstream.destroy());
 });
 E.ports.proxy=await listen(proxy,E.ports.proxy);
 process.env.COINGECKO_STAGING_PROXY='http://127.0.0.1:'+E.ports.proxy;
 await save(ENV_FILE,E);
 const merchantFetch=createPublicHttpsFetch({trustedProxy:{mode:'explicit-connect',origin:E.merchantOrigin,proxyEnv:'COINGECKO_STAGING_PROXY'},timeoutMs:45000});
 const standardFetch=createPublicHttpsFetch({timeoutMs:45000});
 return(input,init)=>new URL(input).origin===E.merchantOrigin?merchantFetch(input,init):standardFetch(input,init);
}
async function prepare(sources,product,fetchImpl){
 model=new MarketModel(E.stateDirectory,{buyerProfiles:[E.profile]});
 if(!C.projectId){
  const project=await retainedStep('project',{actor,opId:E.operationId+':project',name:'CoinGecko / original sources and testnet staging'},body=>model.createProject(body));
  C.projectId=project.id;await persist();
 }
 await retainedStep('config',envelope('config',{config:{merchantOrigin:E.merchantOrigin,merchantPrefix:'/api/v3/stellar',buyerProfileId:E.profile.id}}),
  body=>model.saveConfig(C.projectId,body));
 for(const source of sources){
  const id=source.endpoint;
  const request=await retainedStep(id+':request',envelope(id+':request',{request:source.request}),body=>model.saveRequest(C.projectId,body));
  C.requests[id]=request.id;await persist();
  const metadata=await retainedStep(id+':metadata',envelope(id+':metadata',{filename:source.metadataFile.split('/').pop(),contentType:'application/json',contentBase64:source.metadataBytes.toString('base64')}),
   body=>model.upload(C.projectId,body));
  const originalBody=await retainedStep(id+':body',envelope(id+':body',{filename:source.bodyFile.split('/').pop(),contentType:'application/octet-stream',contentBase64:source.body.toString('base64')}),
   body=>model.upload(C.projectId,body));
  const capture=await retainedStep(id+':capture',envelope(id+':capture',{requestId:request.id,fileId:metadata.id,responseBodyFileId:originalBody.id,
   name:source.request.name+' / original unsigned 402'}),body=>model.importResponse(C.projectId,body));
  C.vendorCaptures[id]=capture.id;await persist();
  const sample=await retainedStep(id+':sample',envelope(id+':sample',{captureId:capture.id,name:source.request.name+' / retained Bazaar example'}),
   body=>model.sample(C.projectId,body));
  C.sampleCaptures[id]=sample.id;await persist();
 }
 const collection=await retainedStep('collection',envelope('collection',{collection:{name:'Five original market families',description:'Exact original vendor definitions with an additional provider-controlled testnet route.',requestIds:sources.map(s=>C.requests[s.endpoint])}}),
  body=>model.saveCollection(C.projectId,body));
 C.collectionId=collection.id;await persist();
 const savedPlan=await retainedStep('provider',envelope('provider',{plan:C.providerPlan}),body=>model.saveProviderPlan(C.projectId,body));
 C.providerPlanId=savedPlan.id;await persist();
 const baseline=await retainedStep('baseline',envelope('baseline',{name:'Original provider examples / five source families',collectionId:C.collectionId,captureIds:sources.map(s=>C.sampleCaptures[s.endpoint])}),
  body=>model.createSnapshot(C.projectId,body));
 C.baselineSnapshotId=baseline.id;await persist();
 if(!C.profileReady){
  const request=model.request(C.requests['simple-price']).request;
  if(!C.operatorDraft){
   const response=await fetchImpl(request.urls.merchant,{method:'GET',headers:{Accept:'application/json'},redirect:'manual'});
   const body=Buffer.from(await response.arrayBuffer()),header=response.headers.get('payment-required');
   need(response.status===402&&header,'NATIVE_CHALLENGE_REQUIRED_FOR_PROFILE');
   const raw=Buffer.from(header,'base64'),challenge=JSON.parse(raw);
   need(challenge.resource.url===request.urls.merchant,'ORIGINAL_NATIVE_RESOURCE_URL_CHANGED');
   const catalog=Buffer.concat([Buffer.from('{"resources":['),raw,Buffer.from(']}')]);
   const prepared=prepareReview(catalog,{rowIndex:0,acceptIndex:0,intentId:E.operationId+':profile',
    url:request.urls.merchant,method:'GET',responseOut:join(E.directory,'profile-preparation-response.bin')});
   const draftPath=join(E.directory,'buyer-review.json');
   await writeFile(draftPath,prepared.data,{flag:'wx',mode:0o600});
   C.operatorDraft=draftPath;C.preparedChallenge={url:request.urls.merchant,status:response.status,bodySha256:digest(body),
    challengeSha256:digest(raw),mode:seller.mode,executed:false};
   await save(join(E.directory,'profile-original-challenge.json'),{url:request.urls.merchant,status:402,headers:Object.fromEntries(response.headers),bodyBase64:body.toString('base64'),challenge});
   await persist();
  }
  const initialization=await initializeWorkspace(['--config',C.operatorDraft,'--dir',E.profile.workspacePath,
   '--actor','coingecko-native-operator','--service','coingecko-five-family-market','--payer',C.accounts.buyer,'--python',E.python,
   '--secret-env',E.buyerSecretEnv,'--rpc',E.rpcUrl,'--https-proxy-env','COINGECKO_STAGING_PROXY',
   '--total-atomic',String(BigInt(C.requirement.amount)*5n),'--daily-atomic',String(BigInt(C.requirement.amount)*5n)],
   {environment:process.env,resume:await exists(E.profile.workspacePath)});
  C.profileInitialization=initialization;C.profileReady=true;await persist();
 }else await openWorkspace(['--dir',E.profile.workspacePath]);
 await save(E.operatorConfigFile,{buyerProfiles:[E.profile]});
 C.sources=sources.map(s=>({endpoint:s.endpoint,url:s.metadata.url,observedAt:s.metadata.observed_at,
  metadataFile:s.metadataFile,metadataSha256:s.metadataSha256,bodyFile:s.bodyFile,bodySha256:s.bodySha256,
  requestId:C.requests[s.endpoint],vendorCaptureId:C.vendorCaptures[s.endpoint],sampleCaptureId:C.sampleCaptures[s.endpoint],sampleSha256:s.sampleSha256}));
 C.status='PREPARED';C.completedAt=new Date().toISOString();C.paymentsInitiated=0;
 C.counts=model.project(C.projectId).counts;await persist();
 await save(join(E.directory,'NATIVE_PREPARATION_RESULT.json'),{status:'PASS',observedAt:C.completedAt,projectId:C.projectId,
  collectionId:C.collectionId,providerPlanId:C.providerPlanId,baselineSnapshotId:C.baselineSnapshotId,
  requests:C.requests,vendorCaptures:C.vendorCaptures,sampleCaptures:C.sampleCaptures,sourceFamilies:C.sources,
  profile:C.profileInitialization,providerPlan:C.providerPlan,requirementSource:C.requirementSource,
  counts:C.counts,paymentsInitiated:0,preparedChallenge:C.preparedChallenge,
  sourceRoot:ROOT,sourceRef:E.sourceRef,stateDirectory:E.stateDirectory,operatorConfigFile:E.operatorConfigFile});
 model.close();model=null;
}
async function main(){
 const publicBytes=await readFile(E.publicConfigFile),publicConfig=JSON.parse(publicBytes);
 const originalBytes=await readFile(E.originalPaidResult);
 need(digest(originalBytes)===E.originalPaidResultSha256,'ORIGINAL_PAID_TERMS_SOURCE_CHANGED');
 const original=JSON.parse(originalBytes),requirement=original.outcome.requirement;
 need(publicConfig.network==='stellar:testnet'&&requirement.network==='stellar:testnet'&&requirement.scheme==='exact'&&
  requirement.asset===publicConfig.asset,'ORIGINAL_TESTNET_ASSIGNMENT_CHANGED');
 need(typeof publicConfig.accounts.buyer==='string'&&typeof publicConfig.accounts.facilitator==='string'&&
  requirement.payTo===publicConfig.accounts.merchant,'ORIGINAL_PUBLIC_ACCOUNT_SHAPE_CHANGED');
 if(C.publicConfigSha256)need(C.publicConfigSha256===digest(publicBytes),'PUBLIC_ACCOUNT_SOURCE_CHANGED');
 C.publicConfigSha256=digest(publicBytes);C.accounts=publicConfig.accounts;C.requirement=requirement;
 C.requirementSource={file:E.originalPaidResult,sha256:E.originalPaidResultSha256,pointer:'/outcome/requirement'};
 C.providerPlan??={name:'CoinGecko testnet staging / retained provider examples',publicOrigin:E.merchantOrigin,pathPrefix:'/api/v3/stellar',
  endpointIds:CONTRACTS.map(c=>c.id),accepts:[requirement],endpointAccepts:{},
  upstream:{origin:'',basePath:'',apiKeyEnv:''}};
 C.facilitatorConfig??={schema:'stellar-forge.native-facilitator.v1',network:'stellar:testnet',rpcUrl:E.rpcUrl,
  signers:[{address:C.accounts.facilitator,secretEnv:E.facilitatorSecretEnv}],payments:{assets:[requirement.asset],
   recipients:[requirement.payTo],maxAtomic:requirement.amount,paymentFlows:['authorization']},
  limits:{maxTransactionFeeStroops:1000000,inclusionFeeStroops:100,maxVerifyInFlight:2,maxSettleInFlight:1,drainGraceMs:60000},
  operations:{ownershipDirectory:E.signerOwnershipDirectory,rpcTimeoutMs:20000,readinessMaxAgeMs:30000,maxLedgerAgeSeconds:120,requireReady:true}};
 await persist();
 const sources=await sourcePacket();
 const sourceBinding=sources.map(source=>({endpoint:source.endpoint,url:source.metadata.url,
  metadataSha256:source.metadataSha256,bodySha256:source.bodySha256,sampleSha256:source.sampleSha256}));
 if(C.sourceBinding)need(isDeepStrictEqual(C.sourceBinding,sourceBinding),'ORIGINAL_SOURCE_PACKET_CHANGED');
 else{C.sourceBinding=sourceBinding;await persist()}
 const byEndpoint=new Map(sources.map(source=>[source.endpoint,source]));
 const resolveData=async({endpoint,signal})=>{
  signal?.throwIfAborted();const source=byEndpoint.get(endpoint);need(source,'EXACT_PROVIDER_EXAMPLE_REQUIRED');
  const record={observedAt:new Date().toISOString(),endpoint,dataBasis:'provider_bazaar_example',
   originalSource:source.metadataFile,originalSourceSha256:source.metadataSha256,bodySha256:source.sampleSha256,bytes:source.sample.bytes.length};
  await writeFile(join(E.directory,'served-original-examples.ndjson'),JSON.stringify(record)+'\n',{flag:'a',mode:0o600});
  return{status:200,headers:{'content-type':'application/json','cache-control':'no-store'},body:source.sample.bytes};
 };
 const product=await prepareCoinGeckoProduct(C.providerPlan);
 const fetchImpl=await startTransport(product,resolveData);
 if(PREPARE||C.status!=='PREPARED')await prepare(sources,product,fetchImpl);
 if(PREPARE){await stop();process.stdout.write(JSON.stringify({status:'PREPARED',projectId:C.projectId,continuationProjectId:C.projectId,
  buyerProfileId:E.profile.id,providerPlan:product.plan,resultFile:join(E.directory,'NATIVE_PREPARATION_RESULT.json')})+'\n');return}
 workspace=await startMarketWorkspace({directory:E.stateDirectory,port:E.ports.workspace,buyerProfiles:[E.profile],fetchImpl,
  providerMode:'ORIGINAL_SF30_SF88_TESTNET_WITH_RETAINED_PROVIDER_EXAMPLES'});
 E.ports.workspace=new URL(workspace.url).port*1;await save(ENV_FILE,E);
 const ready={status:'READY',workspaceUrl:workspace.url,url:workspace.url,continuationProjectId:C.projectId,projectId:C.projectId,
  buyerProfileId:E.profile.id,providerPlan:product.plan,providerPlanId:C.providerPlanId,collectionId:C.collectionId,
  baselineSnapshotId:C.baselineSnapshotId,requests:C.requests,vendorCaptures:C.vendorCaptures,sampleCaptures:C.sampleCaptures,
  sources:C.sources,stateDirectory:E.stateDirectory,sourceRoot:ROOT,sourceRef:E.sourceRef,environmentFile:ENV_FILE,
  operatorConfigFile:E.operatorConfigFile,merchantOrigin:E.merchantOrigin,ports:E.ports,
  dataBasis:'Original retained CoinGecko Bazaar examples; no current market quote is claimed.',nativeStatus:facilitator.status()};
 await save(join(E.directory,'READY.json'),ready);
 process.stdout.write(JSON.stringify(ready)+'\n');
 for(const name of ['SIGTERM','SIGINT'])process.once(name,()=>stop().then(()=>process.exit(0)).catch(error=>{process.stderr.write(JSON.stringify({error:error.code??error.name})+'\n');process.exit(1)}));
 // The parent keeps this process alive and closes it with SIGTERM after the native UI journey.
 // A launcher with stdin=ignore must not terminate an otherwise healthy local service.
}
main().catch(async error=>{
 const failure={status:'FAILED',mode:PREPARE?'prepare':'serve',observedAt:new Date().toISOString(),code:error.code??error.name,message:error.message};
 await save(join(E.directory,'failures',failure.observedAt.replaceAll(':','-')+'-'+process.pid+'.json'),failure).catch(()=>{});
 await save(join(E.directory,'NATIVE_LAST_FAILURE.json'),failure).catch(()=>{});
 process.stderr.write(JSON.stringify({error:error.code??error.name,message:error.message})+'\n');
 await stop().catch(()=>{});process.exitCode=1;
});
