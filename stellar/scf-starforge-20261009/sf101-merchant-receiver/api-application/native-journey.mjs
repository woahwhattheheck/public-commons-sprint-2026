#!/usr/bin/env node
// MIT. Real TESTNET purchase -> signed SF98 delivery -> purchased application.
// Private operation directories retain original buyer, receiver and job state.
import {readFile,open,mkdir,lstat,realpath,link,unlink} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {createServer as httpServer,request as httpRequest} from 'node:http';
import {createServer as httpsServer,request as httpsRequest} from 'node:https';
import {connect as netConnect} from 'node:net';
import {connect as tlsConnect} from 'node:tls';
import {spawn} from 'node:child_process';
import {Keypair,Asset,Networks,Horizon,rpc} from '@stellar/stellar-sdk';
import {Buyer} from '../../sf88-operator-buyer-cli/node/index.mjs';
import {recoverLostOutput,readLostOutputRecovery,exportLostOutputProof} from '../../sf88-operator-buyer-cli/lost-output.mjs';
import {initializeWorkspace} from '../../sf88-operator-buyer-cli/workspace.mjs';
import {createNativeFacilitator} from '../../native-facilitator/runtime.mjs';
import {createNativeSellerServer} from '../../sf30-seller-sdk/native-factory.mjs';
import {acquireStateLease} from '../../merchant-fleet-gateway/state-lease.mjs';
import {drainOnce} from '../../sf98-merchant-delivery/deliver.mjs';
import {compileCheckout,validateHandoff} from '../checkout-config.mjs';
import {initializeMerchant,prepareHandoff,startCheckout,inspectOrder} from '../checkout.mjs';
import {retrieveFile} from '../purchase.mjs';
import {createPublicHttpsFetch} from '../../sf31-buyer-client/public-transport.mjs';
import {createApiAccessPurchase,ApiAccessResult} from '../api-access/purchase.mjs';
import {configureApplication,readApplication,KEY_ENV} from './configuration.mjs';
import {startApplication} from './worker.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)), SCF=resolve(HERE,'../..');
const RPC='https://soroban-testnet.stellar.org';
const NETWORK='stellar:testnet', AMOUNT='10000';
const INTENT='api-pass-native-chain-921ba0-20261011';
const ORDER='api-pass-native-chain-921ba0';
const REQUEST='api-application-analyze-921ba0-20261011';
const PLAN='{"allowanceUnits":8,"routes":[{"id":"echo","method":"GET","path":"/echo","units":1},{"id":"slow","method":"POST","path":"/slow","units":2},{"id":"lost","method":"GET","path":"/lost","units":3},{"id":"application_error","method":"GET","path":"/application-error","units":1},{"id":"mime","method":"GET","path":"/mime","units":1}],"schema":"stellar-forge.sf101.api-pass.v1","title":"Original API access operation"}\n';
const PLAN_SHA='b73aec59dd56c826f55799a39b2ad01f5383ce784e1f487e81ac14329d1e4ff8';
const INPUT='{"values":[2,4,6,8],"window":2}\n';
const CLAIM_ENV='SCF_API_NATIVE_CLAIM', BUYER_ENV='SCF_API_NATIVE_BUYER_SECRET';
const FEE_ENV='SCF_API_NATIVE_FEE_SECRET', PROXY_ENV='SCF_API_NATIVE_BUYER_PROXY';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code});};
const exists=path=>lstat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const jsonBytes=value=>Buffer.from(canonical(value)+'\n');
async function readJson(path){return JSON.parse(await readFile(path,'utf8'));}
async function writeExact(path,bytes){
 bytes=Buffer.from(bytes);
 if(await exists(path)){need(sha(await readFile(path))===sha(bytes),'RETAINED_OPERATION_INPUT_CHANGED');return;}
 const temporary=join(dirname(path),'.native-'+randomBytes(12).toString('hex'));
 const file=await open(temporary,'wx',0o600);
 try{
  try{await file.writeFile(bytes);await file.sync();}finally{await file.close();}
  try{await link(temporary,path);}catch(error){
   if(error.code!=='EEXIST')throw error;
   need(sha(await readFile(path))===sha(bytes),'RETAINED_OPERATION_INPUT_CHANGED');
  }
  const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
 }finally{await unlink(temporary).catch(()=>{});}
}
async function retain(path,value){
 if(await exists(path))return readJson(path);
 await writeExact(path,jsonBytes(value));return value;
}
async function privateJson(path){
 const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink()&&!(info.mode&0o077),'PRIVATE_OPERATION_FILE_REQUIRED');
 return readJson(path);
}
const listen=server=>new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',()=>done(server.address().port));});
const stopServer=server=>new Promise(done=>{if(!server)return done();server.close(done);server.closeIdleConnections?.();});
function child(executable,args,{environment=process.env,timeoutMs=180000}={}){
 return new Promise((done,fail)=>{
  const running=spawn(executable,args,{env:environment,stdio:['ignore','pipe','pipe'],shell:false});
  const chunks=[],errors=[];let size=0,errorBytes=0,timedOut=false;
  const timer=setTimeout(()=>{timedOut=true;running.kill('SIGKILL');},timeoutMs);
  running.stdout.on('data',value=>{size+=value.length;if(size>8*1024*1024)running.kill('SIGKILL');else chunks.push(value);});
  running.stderr.on('data',value=>{errorBytes+=value.length;if(errorBytes<32768)errors.push(value);});
  running.once('error',error=>{clearTimeout(timer);fail(error);});
  running.once('close',code=>{
   clearTimeout(timer);
   if(code!==0||timedOut){
    const error=Object.assign(new Error(timedOut?'ORIGINAL_CHILD_TIMEOUT':'ORIGINAL_CHILD_FAILED'),
     {code:timedOut?'ORIGINAL_CHILD_TIMEOUT':'ORIGINAL_CHILD_FAILED',exitCode:code});
    // Original structured error codes can be shared; stderr and credentials stay private.
    try{const result=JSON.parse(Buffer.concat(errors).toString('utf8'));
     if(/^[A-Z][A-Z0-9_]{1,100}$/.test(result.error||''))error.originalCode=result.error;}catch{}
    fail(error);
   }else done(Buffer.concat(chunks));
  });
 });
}
const pythonJson=async(python,path,args,options)=>JSON.parse(await child(python,[path,...args],options));
function service(python,path,args,environment){
 const running=spawn(python,[path,...args],{env:environment,stdio:['ignore','pipe','pipe'],shell:false});
 let ready=false,output='',errors='',code=null;
 running.stdout.on('data',part=>{if(output.length<65536)output+=part.toString('utf8');});
 running.stderr.on('data',part=>{if(errors.length<8192)errors+=part.toString('utf8');});
 const ended=new Promise(done=>{
  running.once('error',()=>{code=1;done();});
  running.once('close',value=>{code=value;done();});
 });
 return{
  running,ended,
  async ready(){
   for(let count=0;count<150;count++){
    need(code===null,'ORIGINAL_SERVICE_EXITED_BEFORE_READY');
    try{const value=JSON.parse(output);ready=true;return value;}catch{}
    await new Promise(done=>setTimeout(done,100));
   }
   throw Object.assign(new Error('ORIGINAL_SERVICE_READY_TIMEOUT'),{code:'ORIGINAL_SERVICE_READY_TIMEOUT'});
  },
  async stop(){if(code===null){running.kill('SIGTERM');const force=setTimeout(()=>running.kill('SIGKILL'),10000);
   await ended;clearTimeout(force);}}
 };
}
function parse(argv){
 const result={host:'merchant.routescan39da.scf.test',python:'/usr/bin/python3',
  workerPort:43111,apiPort:43112,consolePort:43113,receiverPort:43110};
 const keys={'--dir':'directory','--tls-dir':'tlsDirectory','--host':'host','--python':'python',
  '--worker-port':'workerPort','--api-port':'apiPort','--console-port':'consolePort','--receiver-port':'receiverPort',
  '--recover-transaction':'recoveryTransaction','--approved-request':'approvedRequestFile'};
 const used=new Set();
 for(let index=0;index<argv.length;index++){
  const key=keys[argv[index]];need(key&&!used.has(key)&&argv[index+1],'NATIVE_JOURNEY_OPTIONS_REQUIRED');
  used.add(key);result[key]=key.endsWith('Port')?Number(argv[++index]):argv[++index];
 }
 need(result.directory&&result.tlsDirectory,'PRIVATE_DIRECTORY_AND_TRUSTED_TLS_DIRECTORY_REQUIRED');
 for(const key of ['directory','tlsDirectory']){need(resolve(result[key])===result[key],'ABSOLUTE_CANONICAL_PATH_REQUIRED');}
 need(/^[a-z0-9][a-z0-9.-]{2,252}$/.test(result.host)&&result.host.includes('.'),'MERCHANT_HOST_REQUIRED');
 need((result.recoveryTransaction===undefined)===(result.approvedRequestFile===undefined),'RECOVERY_TRANSACTION_AND_APPROVED_REQUEST_REQUIRED');
 if(result.recoveryTransaction!==undefined){need(/^[a-f0-9]{64}$/.test(result.recoveryTransaction),'ORIGINAL_RECOVERY_TRANSACTION_REQUIRED');
  need(resolve(result.approvedRequestFile)===result.approvedRequestFile,'ABSOLUTE_APPROVED_REQUEST_REQUIRED');}
 const ports=['workerPort','apiPort','consolePort','receiverPort'].map(key=>result[key]);
 need(ports.every(port=>Number.isInteger(port)&&port>0&&port<65536)&&new Set(ports).size===ports.length,'DISTINCT_PRIVATE_PORTS_REQUIRED');
 return result;
}
async function fundedAccounts(directory){
 const path=join(directory,'accounts.private.json');
 let saved;
 if(await exists(path))saved=await privateJson(path);
 else{
  const accounts={};
  for(const role of ['buyer','fee','merchant']){const pair=Keypair.random();accounts[role]={address:pair.publicKey(),secret:pair.secret()};}
  saved={schema:'stellar-forge.testnet-native-accounts.v1',network:NETWORK,accounts};
  // Retain keys before a single Friendbot request is dispatched.
  await writeExact(path,jsonBytes(saved));
 }
 need(saved.network===NETWORK,'ORIGINAL_TESTNET_ACCOUNTS_REQUIRED');
 const horizon=new Horizon.Server('https://horizon-testnet.stellar.org'),server=new rpc.Server(RPC);
 const observed={};
 for(const role of ['buyer','fee','merchant']){
  const account=saved.accounts?.[role];
  need(account&&Keypair.fromSecret(account.secret).publicKey()===account.address,'RETAINED_TESTNET_ACCOUNT_INVALID');
  let state;
  try{state=await horizon.loadAccount(account.address);}
  catch(error){
   need(error.name==='NotFoundError'||error.response?.status===404,'ORIGINAL_ACCOUNT_LOOKUP_FAILED');
   await retain(join(directory,'funding-'+role+'-requested.json'),{network:NETWORK,address:account.address,requestedAt:new Date().toISOString()});
   await server.requestAirdrop(account.address);
   state=await horizon.loadAccount(account.address);
  }
  observed[role]={address:state.accountId(),nativeBalance:state.balances.find(value=>value.asset_type==='native')?.balance};
 }
 const value={network:NETWORK,asset:Asset.native().contractId(Networks.TESTNET),
  buyer:saved.accounts.buyer.address,fee:saved.accounts.fee.address,merchant:saved.accounts.merchant.address};
 await writeExact(join(directory,'accounts.public.json'),jsonBytes(value));
 await retain(join(directory,'funding-result.json'),{state:'TESTNET_ACCOUNTS_FUNDED',network:NETWORK,accounts:observed,completedAt:new Date().toISOString()});
 process.env[BUYER_ENV]=saved.accounts.buyer.secret;process.env[FEE_ENV]=saved.accounts.fee.secret;
 return value;
}
async function transport(options,checkout,receiverOrigin){
 const sockets=new Set(),counts={merchantConnect:0,rpcConnect:0,refusedConnect:0,paidCheckoutResponses:0};
 const origin='https://'+options.host;
 const tls=httpsServer({key:await readFile(join(options.tlsDirectory,'server-key.pem')),
  cert:await readFile(join(options.tlsDirectory,'server.pem'))},(request,response)=>{
  let target,path=request.url;
  if(path.startsWith('/purchase/api-pass'))target=new URL(checkout.seller.url);
  else if(path==='/internal/x402-events'){target=new URL(receiverOrigin);path='/sf98/events';}
  else if(path.startsWith('/deliver/'))target=new URL(receiverOrigin);
  else{response.writeHead(404);response.end();return;}
  const outgoing=httpRequest({hostname:target.hostname,port:target.port,method:request.method,path,
   headers:{...request.headers,connection:'close'},agent:false},incoming=>{
   if(request.headers['payment-signature']&&incoming.statusCode===200)counts.paidCheckoutResponses++;
   response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
  });
  outgoing.on('error',()=>{if(!response.headersSent)response.writeHead(502);response.end();});
  request.pipe(outgoing);
 });
 const tlsPort=await listen(tls);
 const proxy=httpServer((request,response)=>{response.writeHead(405);response.end();});
 function track(socket){sockets.add(socket);socket.once('close',()=>sockets.delete(socket));return socket;}
 function attach(socket,upstream,head){
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');if(head.length)upstream.write(head);
  socket.pipe(upstream);upstream.pipe(socket);
 }
 function egress(socket,head){
  const value=process.env.HTTPS_PROXY??process.env.https_proxy??process.env.HTTP_PROXY??process.env.http_proxy;
  if(!value){
   const upstream=track(netConnect({host:'soroban-testnet.stellar.org',port:443},()=>attach(socket,upstream,head)));
   upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());return;
  }
  const target=new URL(value);need(['http:','https:'].includes(target.protocol)&&!target.username&&!target.password,'SUPPORTED_EGRESS_PROXY_REQUIRED');
  const secure=target.protocol==='https:';
  const upstream=track(secure?tlsConnect({host:target.hostname,port:Number(target.port||443),servername:target.hostname}):
   netConnect({host:target.hostname,port:Number(target.port||80)}));
  upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
  upstream.once(secure?'secureConnect':'connect',()=>upstream.write('CONNECT soroban-testnet.stellar.org:443 HTTP/1.1\r\nHost: soroban-testnet.stellar.org:443\r\n\r\n'));
  let pending=Buffer.alloc(0);
  const handshake=data=>{
   pending=Buffer.concat([pending,data]);if(pending.length>16384){upstream.destroy();socket.destroy();return;}
   const end=pending.indexOf('\r\n\r\n');if(end<0)return;
   upstream.removeListener('data',handshake);
   if(!/^HTTP\/1\.[01] 200(?: |\r)/.test(pending.toString('latin1',0,end))){upstream.destroy();socket.end('HTTP/1.1 502 Bad Gateway\r\n\r\n');return;}
   socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
   if(pending.length>end+4)socket.write(pending.subarray(end+4));if(head.length)upstream.write(head);
   socket.pipe(upstream);upstream.pipe(socket);
  };
  upstream.on('data',handshake);
 }
 proxy.on('connect',(request,socket,head)=>{
  track(socket);
  if(request.url===options.host+':443'&&!head.length){
   counts.merchantConnect++;const upstream=track(netConnect({host:'127.0.0.1',port:tlsPort},()=>attach(socket,upstream,head)));
   upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());socket.on('close',()=>upstream.destroy());
  }else if(request.url==='soroban-testnet.stellar.org:443'&&!head.length){
   counts.rpcConnect++;try{egress(socket,head);}catch{socket.destroy();}
  }else{counts.refusedConnect++;socket.end('HTTP/1.1 403 Forbidden\r\n\r\n');}
 });
 const proxyUrl='http://127.0.0.1:'+await listen(proxy);
 // This explicit owned TESTNET transport reaches the real receiver over verified
 // TLS. It makes no public-DNS assertion; drainOnce retains the original SF98 lease,
 // event ID, retry state and acknowledgement. Product public delivery is unchanged.
 async function signedDelivery({event,secret,timeoutMs,signal}){
  need(event.orderReference===ORDER&&event.network===NETWORK&&event.amountAtomic===AMOUNT,'ORIGINAL_NATIVE_EVENT_BINDING_REQUIRED');
  const payload=JSON.stringify({schema:'stellar-forge.sf98.webhook.v1',eventId:event.id,occurredAt:event.at,
   routeId:event.routeId,method:event.method,network:event.network,amountAtomic:event.amountAtomic,
   assetDigest:event.assetDigest,orderReference:event.orderReference,
   ...(event.recipientDigest==null?{}:{recipientDigest:event.recipientDigest}),settlement:'ORIGINAL_NATIVE_SUCCESS'});
  const timestamp=String(Math.floor(Date.now()/1000));
  const digest=createHmac('sha256',secret).update(timestamp+'.'+payload).digest('hex');
  return new Promise((done,fail)=>{
   const request=httpsRequest({hostname:'127.0.0.1',port:tlsPort,servername:options.host,
    path:'/internal/x402-events',method:'POST',agent:false,timeout:timeoutMs,signal,
    headers:{host:options.host,'content-type':'application/json','content-length':Buffer.byteLength(payload),
     'idempotency-key':event.id,'x-sf98-timestamp':timestamp,'x-sf98-signature':'sha256='+digest,
     'user-agent':'sf98-native-merchant-delivery/1'}},response=>{
    const httpStatus=response.statusCode||0;response.destroy();done({ok:httpStatus>=200&&httpStatus<300,httpStatus});
   });
   request.once('timeout',()=>request.destroy(new Error('WEBHOOK_TIMEOUT')));request.once('error',fail);request.end(payload);
  });
 }
 async function preflight(){
  // Same verified certificate and original approved host used by buyer CONNECT.
  await new Promise((done,fail)=>{
   const request=httpsRequest({hostname:'127.0.0.1',port:tlsPort,servername:options.host,path:'/not-an-offer',
    method:'GET',headers:{host:options.host},agent:false,timeout:10000},response=>{
     response.destroy();if(response.statusCode!==404)fail(new Error('ORIGINAL_TLS_PROXY_PREFLIGHT_FAILED'));else done();
    });
   request.once('timeout',()=>request.destroy(new Error('TLS_PREFLIGHT_TIMEOUT')));request.once('error',fail);request.end();
  });
 }
 return{origin,proxyUrl,counts,signedDelivery,preflight,async close(){for(const socket of sockets)socket.destroy();await stopServer(proxy);await stopServer(tls);}};
}
async function waitForReceiver(port,running){
 for(let index=0;index<150;index++){
  need(running.running.exitCode===null,'ORIGINAL_RECEIVER_EXITED');
  const connected=await new Promise(done=>{
   const socket=netConnect({host:'127.0.0.1',port},()=>{socket.destroy();done(true);});
   socket.once('error',()=>done(false));socket.setTimeout(1000,()=>{socket.destroy();done(false);});
  });
  if(connected)return;await new Promise(done=>setTimeout(done,100));
 }
 throw new Error('ORIGINAL_RECEIVER_READY_TIMEOUT');
}
async function run(options){
 process.umask(0o077);process.env.PYTHONDONTWRITEBYTECODE='1';
 need(process.allowedNodeEnvironmentFlags.has('--use-system-ca'),'NODE_SYSTEM_CA_SUPPORT_REQUIRED');
 process.env.NODE_OPTIONS=[process.env.NODE_OPTIONS,'--use-system-ca','--preserve-symlinks-main'].filter(Boolean).join(' ');
 process.env.SF36_OBSERVER_USE_SYSTEM_CA='1';
 await mkdir(options.directory,{mode:0o700,recursive:true});
 need(await realpath(options.directory)===options.directory,'CANONICAL_PRIVATE_OPERATION_DIRECTORY_REQUIRED');
 need(!((await lstat(options.directory)).mode&0o077),'PRIVATE_OPERATION_DIRECTORY_REQUIRED');
 const root=options.directory,lease=await acquireStateLease(root);
 let checkout,facilitator,network,receiver,application,gateway;
 const out=value=>process.stdout.write(JSON.stringify(value)+'\n');
 try{
  const {recoveryTransaction,approvedRequestFile,...identityOptions}=options;
  const identity={schema:'stellar-forge.sf101.native-api-journey.v1',intentId:INTENT,orderReference:ORDER,requestId:REQUEST,
   network:NETWORK,amountAtomic:AMOUNT,planSha256:PLAN_SHA,applicationInputSha256:sha(INPUT),...identityOptions};
  await writeExact(join(root,'operation.json'),jsonBytes(identity));
  need(sha(PLAN)===PLAN_SHA,'ORIGINAL_API_PLAN_BYTES_REQUIRED');
  if(await exists(join(root,'journey-result.json'))){out(await readJson(join(root,'journey-result.json')));return;}
  await writeExact(join(root,'api-plan.json'),PLAN);await writeExact(join(root,'application-input.json'),INPUT);
  const accounts=await fundedAccounts(root);
  let secrets;
  if(await exists(join(root,'merchant.private.json')))secrets=await privateJson(join(root,'merchant.private.json'));
  else{secrets={claim:randomBytes(32).toString('hex'),webhook:randomBytes(32).toString('hex')};
   await writeExact(join(root,'merchant.private.json'),jsonBytes(secrets));}
  need(/^[a-f0-9]{64}$/.test(secrets.claim)&&/^[a-f0-9]{64}$/.test(secrets.webhook),'ORIGINAL_MERCHANT_SECRETS_REQUIRED');
  process.env[CLAIM_ENV]=secrets.claim;process.env.SF98_WEBHOOK_SECRET=secrets.webhook;
  const payment={scheme:'exact',network:NETWORK,amount:AMOUNT,asset:accounts.asset,payTo:accounts.merchant,
   maxTimeoutSeconds:600,extra:{areFeesSponsored:true,paymentFlow:'authorization'}};
  const input={schema:'stellar-forge.sf101.checkout-service.v1',publicOrigin:'https://'+options.host,
   path:'/purchase/api-pass',routeId:'native_api_pass_purchase',description:'Original purchased API allowance',
   payment,state:join(root,'merchant'),outbox:join(root,'outbox'),python:options.python,workerCount:2,maxPending:32};
  await writeExact(join(root,'checkout.json'),jsonBytes(input));
  const compiled=compileCheckout(input);
  if(!await exists(join(compiled.state,'merchant.sqlite3')))await initializeMerchant(compiled);
  const handoffPath=join(root,'order-handoff.json');
  if(!await exists(handoffPath)){
   let enrolled=false;
   try{await inspectOrder(compiled,ORDER);enrolled=true;}catch{}
   await prepareHandoff(compiled,{ref:ORDER,output:handoffPath,...(enrolled?{}:{file:join(root,'api-plan.json')}),claimEnv:CLAIM_ENV,env:process.env});
  }
  const handoff=validateHandoff(await readJson(handoffPath));
  need(handoff.file.bytes===412&&handoff.file.sha256===PLAN_SHA&&handoff.orderReference===ORDER,'ORIGINAL_API_HANDOFF_CHANGED');
  const policy={schema:'stellar-forge.native-facilitator.v1',network:NETWORK,rpcUrl:RPC,
   signers:[{address:accounts.fee,secretEnv:FEE_ENV}],payments:{assets:[accounts.asset],recipients:[accounts.merchant],maxAtomic:AMOUNT},
   limits:{maxTransactionFeeStroops:1000000,inclusionFeeStroops:100,maxVerifyInFlight:2,maxSettleInFlight:1,drainGraceMs:60000},
   operations:{ownershipDirectory:join(root,'signer-ownership'),requireReady:true,rpcTimeoutMs:15000}};
  await writeExact(join(root,'facilitator.json'),jsonBytes(policy));
  facilitator=await createNativeFacilitator(policy,{environment:process.env});
  checkout=await startCheckout(compiled,{port:0,operationsPort:0,env:process.env,maxInFlight:1,
   nativeFactory:routes=>createNativeSellerServer(routes,{facilitatorClient:facilitator})});
  need(checkout.seller.mode==='NATIVE_X402','ORIGINAL_NATIVE_CHECKOUT_REQUIRED');
  receiver=service(options.python,join(SCF,'sf101-merchant-receiver/receiver.py'),
   ['serve','--state',compiled.state,'--port',String(options.receiverPort)],process.env);
  await waitForReceiver(options.receiverPort,receiver);
  network=await transport(options,checkout,'http://127.0.0.1:'+options.receiverPort);
  await network.preflight();process.env[PROXY_ENV]=network.proxyUrl;
  const observer=JSON.parse(await child(process.execPath,['--use-system-ca',join(HERE,'native-observer-preflight.mjs'),network.proxyUrl],
   {environment:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8'}}));
  need(observer.passphrase==='Test SDF Network ; September 2015','ORIGINAL_OBSERVER_TRANSPORT_REQUIRED');
  await retain(join(root,'original-observer-preflight.json'),observer);
  const gatewayInput=join(root,'gateway-source.json');
  if(!await exists(gatewayInput))await pythonJson(options.python,join(HERE,'../api-access/cli.py'),
   ['configure','--state',compiled.state,'--plan',join(root,'api-plan.json'),'--upstream','http://127.0.0.1:'+options.workerPort,
    '--out',gatewayInput,'--actor','921ba0-native-operator','--timeout','120']);
  const jobs=await readJson(join(SCF,'sf30-seller-sdk/jobs/example-merchant.json'));
  jobs.application=join(SCF,'sf30-seller-sdk/jobs/example-application.mjs');jobs.publicOrigin=network.origin;
  for(const definition of Object.values(jobs.functions))definition.payment=payment;
  await writeExact(join(root,'jobs-source.json'),jsonBytes(jobs));
  const profilePath=join(root,'application/application.json');
  if(!await exists(profilePath))await configureApplication({merchant:join(root,'jobs-source.json'),gateway:gatewayInput,
   directory:join(root,'application'),port:options.workerPort,mappings:[{id:'slow',functionId:'analyze'}],bindRoutes:true});
  const runtime=await readApplication(profilePath);
  application=await startApplication(runtime,{env:process.env,python:options.python});
  gateway=service(options.python,join(HERE,'../api-access/cli.py'),
   ['serve','--config',runtime.profile.gateway,'--api-port',String(options.apiPort),'--console-port',String(options.consolePort)],
   {...process.env,[KEY_ENV]:runtime.capability});
  const gatewayReady=await gateway.ready();
  need(gatewayReady.apiUrl==='http://127.0.0.1:'+options.apiPort,'ORIGINAL_GATEWAY_ORIGIN_CHANGED');
  const customerDirectory=join(root,'customer'),workspace=join(root,'operator-workspace'),buyerState=join(root,'buyer-state');
  await mkdir(buyerState,{recursive:true,mode:0o700});
  await mkdir(customerDirectory,{recursive:true,mode:0o700});
  const expected={scheme:payment.scheme,network:payment.network,asset:payment.asset,payTo:payment.payTo,
   maxAtomic:payment.amount,maxTimeoutSeconds:payment.maxTimeoutSeconds,paymentFlow:payment.extra.paymentFlow};
  const sourceRequest={operation:{intentId:INTENT,url:handoff.purchaseUrl,method:'GET',orderReference:ORDER,expect:expected},
   responseFile:{destination:join(customerDirectory,'purchase-response.bin'),maxBytes:16384,timeoutMs:30000,expectedContentType:'application/json'},
   requestTimeoutMs:180000};
  await writeExact(join(root,'source-request.json'),jsonBytes(sourceRequest));
  if(!await exists(join(workspace,'workspace.json')))await retain(join(root,'workspace-initialization.json'),
   await initializeWorkspace(['--config',join(root,'source-request.json'),'--dir',workspace,'--actor','921ba0-native-operator',
    '--service','api-pass-native-application','--payer',accounts.buyer,'--python',options.python,
    '--secret-env',BUYER_ENV,'--rpc',RPC,'--https-proxy-env',PROXY_ENV,'--total-atomic',AMOUNT,'--daily-atomic',AMOUNT],
    {environment:process.env}));
  const buyer=new Buyer({runtimeDirectory:join(SCF,'sf88-operator-buyer-cli'),stateDirectory:buyerState});
  const purchase=await createApiAccessPurchase({directory:customerDirectory,buyer,workspaceDirectory:workspace,
   inboxDirectory:join(root,'inbox'),handoffFile:handoffPath,intentId:INTENT,gatewayBaseUrl:gatewayReady.apiUrl,
   claimEnv:CLAIM_ENV,python:options.python,environment:process.env});
  const recoveryOptions={root:join(root,'inbox'),intentId:INTENT,workspace};
  let lostRecovery=await readLostOutputRecovery(recoveryOptions);
  if(recoveryTransaction!==undefined){
   const preimage=await privateJson(approvedRequestFile);
   const expectedRequestSha256=sha(canonical(preimage));
   if(!lostRecovery){
    const recovered=await recoverLostOutput({...recoveryOptions,transaction:recoveryTransaction,approvedRequest:preimage,expectedRequestSha256});
    lostRecovery=recovered.lostOutputFinalization;
   }
   need(lostRecovery.transaction===recoveryTransaction&&lostRecovery.requestSha256===expectedRequestSha256,
    'RETAINED_RECOVERY_SELECTION_CHANGED');
   await retain(join(root,'original-lost-output-finalization.json'),lostRecovery);
  }
  let current=await purchase.inspect(),executedHere=false;
  if(current.native?.attempt){
   if(!lostRecovery)await purchase.recover();
   current=await purchase.inspect();
  }
  else{
   const review=await purchase.review();await retain(join(root,'original-review.json'),review);
   out({phase:'ORIGINAL_NATIVE_PURCHASE_READY',intentId:INTENT,network:NETWORK,amountAtomic:AMOUNT,
    payer:accounts.buyer,merchant:accounts.merchant,planSha256:PLAN_SHA});
   executedHere=true;
   await retain(join(root,'original-execution.json'),await purchase.execute({review}));
   current=await purchase.inspect();
  }
  if(!lostRecovery){
   const purchaseResponse=await purchase.response();
   need(purchaseResponse,'ORIGINAL_PURCHASE_RESPONSE_REQUIRED');await purchaseResponse.verify();
  }else{
   await mkdir(join(root,'recovered-proofs'),{mode:0o700,recursive:true});
   const proof=await exportLostOutputProof({...recoveryOptions,output:join(root,'recovered-proofs',lostRecovery.transaction+'.json')});
   await retain(join(root,'original-lost-output-proof.json'),proof);
   const nativeRows=await checkout.outbox.rows();
   const matching=nativeRows.filter(row=>row.event.orderReference===ORDER&&row.event.routeId===handoff.routeId&&
    row.event.network===NETWORK&&row.event.amountAtomic===AMOUNT&&
    row.event.transactionFingerprint===sha(lostRecovery.transaction));
   need(matching.length===1,'ORIGINAL_PAID_SF98_EVENT_REQUIRED');
  }
  const delivery=await drainOnce(checkout.outbox,{url:network.origin+'/internal/x402-events',allowedHost:options.host,
   secret:secrets.webhook,send:network.signedDelivery,limit:10,concurrency:1,timeoutMs:7000});
  await retain(join(root,'original-delivery.json'),delivery);
  const downloadedPlan=join(root,'purchased-api-plan.json');
  if(await exists(downloadedPlan))need(sha(await readFile(downloadedPlan))===PLAN_SHA,'RETAINED_PAID_PLAN_BYTES_CHANGED');
  else{
   const paidFile=await retrieveFile({handoff,destination:downloadedPlan,token:secrets.claim,
    fetchImpl:createPublicHttpsFetch({trustedProxy:{mode:'explicit-connect',origin:network.origin,proxyUrl:network.proxyUrl}})});
   need(paidFile.file.sha256===PLAN_SHA&&paidFile.file.bytes===412,'ORIGINAL_PAID_PLAN_DOWNLOAD_CHANGED');
   await retain(join(root,'original-paid-plan-download.json'),paidFile);
  }
  const attached=await pythonJson(options.python,join(HERE,'../api-access/cli.py'),['attach','--state',compiled.state,'--order',ORDER]);
  await retain(join(root,'original-pass-attachment.json'),attached);
  const finalized=lostRecovery?null:await purchase.finalize({outboxDirectory:compiled.outbox});
  const finalization=lostRecovery?.result??finalized?.native?.finalization?.result;
  need(['FINALIZED','IDEMPOTENT_FINALIZED'].includes(finalization?.outcome),'ORIGINAL_PAYMENT_ACCOUNTING_NOT_FINALIZED');
  if(finalized)await retain(join(root,'original-finalization.json'),finalized);
  const resultPath=join(root,'application-result.json');
  let result;
  if(await exists(resultPath)){result=new ApiAccessResult(await readJson(resultPath));await result.verify();}
  else{
   const page=await purchase.api.calls({limit:100});
   const existing=(page.calls||[]).find(row=>row.requestId===REQUEST);
   if(existing){
    result=await purchase.api.recover(REQUEST,{output:join(root,'application-response-recovered-'+Date.now()+'.json')});
   }else{
    const destination=join(root,'application-response.json');
    need(!await exists(destination),'RETAINED_RESPONSE_REQUIRES_ORIGINAL_REQUEST_RECOVERY');
    result=await purchase.api.call({route:'slow',requestId:REQUEST,method:'POST',bodyFile:join(root,'application-input.json'),
     contentType:'application/json',output:destination});
   }
   await retain(resultPath,result.metadata);
  }
  need(result.status===200&&result.metadata.units===2,'ORIGINAL_APPLICATION_RESULT_REQUIRED');
  const replayPath=join(root,'application-replay.json');
  let replay;
  if(await exists(replayPath)){replay=new ApiAccessResult(await readJson(replayPath));await replay.verify();}
  else{
   replay=await purchase.api.recover(REQUEST,{output:join(root,'application-replay-response-'+Date.now()+'.json')});
   await retain(replayPath,replay.metadata);
  }
  need(replay.metadata.sha256===result.metadata.sha256&&replay.metadata.bytes===result.metadata.bytes,'ORIGINAL_APPLICATION_REPLAY_BYTES_CHANGED');
  const appState=await pythonOrNodeApplicationInspect(options.python,profilePath);
  await retain(join(root,'original-application-execution.json'),appState);
  const pass=await purchase.api.inspect();await retain(join(root,'original-allowance.json'),pass);
  if(!await exists(join(root,'original-api-usage.json')))
   await retain(join(root,'original-api-usage-export.json'),
    await pythonJson(options.python,join(HERE,'../api-access/cli.py'),
     ['export','--state',compiled.state,'--order',ORDER,'--out',join(root,'original-api-usage.json')]));
  if(!await exists(join(root,'buyer-history.html')))await retain(join(root,'original-buyer-report.json'),
   await purchase.exportReport(join(root,'buyer-history.html')));
  const original=await purchase.inspect();
  const outcome=original.native?.outcome??current.native?.outcome;
  const completed={schema:'stellar-forge.sf101.native-api-journey-result.v1',state:'NATIVE_API_PURCHASE_AND_APPLICATION_COMPLETED',
   completedAt:new Date().toISOString(),intentId:INTENT,orderReference:ORDER,requestId:REQUEST,
   payment:{network:NETWORK,amountAtomic:AMOUNT,payer:accounts.buyer,merchant:accounts.merchant,asset:accounts.asset,
    transaction:lostRecovery?.transaction??finalization.receipt_ref?.split('/').at(-1)??null,
    finalization:finalization.outcome,recovery:lostRecovery?'ORIGINAL_SF36_LOST_OUTPUT_RECOVERY':null},
   plan:{bytes:412,sha256:PLAN_SHA},application:{input:JSON.parse(INPUT),status:result.status,units:result.metadata.units,
    bytes:result.metadata.bytes,sha256:result.metadata.sha256,value:await result.json(),sameRequestReplay:true},
   originalState:{buyerState,inbox:join(root,'inbox'),workspace,merchant:compiled.state,outbox:compiled.outbox,
    application:profilePath,privateDirectory:root},
   executedThisProcess:executedHere,transport:network.counts,facilitator:facilitator.status()};
  await writeExact(join(root,'journey-result.json'),jsonBytes(completed));out(completed);
 }catch(error){
  const failure={state:'NATIVE_API_JOURNEY_INCOMPLETE',intentId:INTENT,orderReference:ORDER,requestId:REQUEST,
   code:/^[A-Z][A-Z0-9_]{1,120}$/.test(error.code||'')?error.code:'NATIVE_API_JOURNEY_FAILED',
   originalCode:error.originalCode??null,exitCode:error.exitCode??null,at:new Date().toISOString()};
  try{await writeExact(join(root,'journey-error-'+Date.now()+'.json'),jsonBytes({...failure,message:String(error.message??'').slice(0,2000),stack:String(error.stack??'').slice(0,5000)}));}catch{}
  out(failure);process.exitCode=1;
 }finally{
  await gateway?.stop().catch(()=>{});await application?.stop().catch(()=>{});
  await receiver?.stop().catch(()=>{});await checkout?.close().catch(()=>{});
  await facilitator?.drain().catch(()=>{});await network?.close().catch(()=>{});await lease.close();
 }
}
async function pythonOrNodeApplicationInspect(python,profile){
 return JSON.parse(await child(process.execPath,[join(HERE,'cli.mjs'),'inspect','--config',profile,
  '--order',ORDER,'--request-id',REQUEST,'--python',python]));
}
if(process.argv.includes('--help')){
 process.stdout.write('Run with Node 24 and trusted TLS: node --use-system-ca native-journey.mjs --dir PRIVATE_ABSOLUTE_DIRECTORY --tls-dir EXISTING_TRUSTED_TLS_DIRECTORY [--host merchant.routescan39da.scf.test] [--python /usr/bin/python3]\n');
}else if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 run(parse(process.argv.slice(2))).catch(error=>{
  process.stderr.write(JSON.stringify({ok:false,error:/^[A-Z][A-Z0-9_]{1,120}$/.test(error.code||'')?error.code:'NATIVE_API_JOURNEY_SETUP_FAILED'})+'\n');process.exitCode=1;
 });
}
