import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as netConnect } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SourceTextModule } from 'node:vm';
const run=promisify(execFile),root=process.argv[2],directory=process.argv[3];
const runtime=join(directory,'runtime'),base=join(root,'stellar/scf-starforge-20261009/mpp-charge');
const native=await (await import(pathToFileURL(join(base,'runtime.mjs')))).loadNative(runtime);
const {hash,stable,openWorkspace}=await import(pathToFileURL(join(base,'storage.mjs')));
const api=await import(pathToFileURL(join(base,'customer/index.mjs')));
const {serveMerchant,serveWorkspace}=await import(pathToFileURL(join(base,'server.mjs')));
const {bindingFacts}=await import(pathToFileURL(join(base,'config.mjs')));
const origin='https://merchant.example.com',payer=native.sdk.Keypair.random().publicKey();
const recipient=native.sdk.Keypair.random().publicKey(),asset=native.sdk.StrKey.encodeContract(Buffer.alloc(32,23));
const profile={title:'Native customer report service',publicOrigin:origin,secretEnv:'MPP_JOURNEY_HMAC',
 dependencyRoot:runtime,lifetimeSeconds:300,routes:[{id:'report',method:'POST',path:'/report',
 description:'Customer integration report',payment:{network:'stellar:testnet',currency:asset,recipient,
 amountAtomic:'7',decimals:7},resource:{kind:'json',value:{rows:3,privateMarker:'private-merchant-resource'}}}]};
const environment={MPP_JOURNEY_HMAC:'b'.repeat(64)},merchantDirectory=join(directory,'merchant');
let workspace=await openWorkspace(merchantDirectory,{create:true});
await workspace.configure('merchant',profile,0);
let merchant=await serveMerchant({workspace,profile,port:0,environment}),consoleApp,customer;
const received=[],sockets=new Set();
const tlsServer=httpsServer({key:await readFile(join(directory,'tls.key')),
 cert:await readFile(join(directory,'tls.crt'))},(request,response)=>{
 const pieces=[];request.on('data',part=>pieces.push(part));
 request.on('end',()=>received.push({method:request.method,url:request.url,body:hash(Buffer.concat(pieces))}));
 const upstream=httpRequest({hostname:'127.0.0.1',port:merchant.port,path:request.url,
 method:request.method,headers:{...request.headers,host:'merchant.example.com'}},incoming=>{
  response.writeHead(incoming.statusCode,incoming.headers);incoming.pipe(response);
 });
 upstream.on('error',error=>response.destroy(error));request.pipe(upstream);
});
const proxy=httpServer();
for(const server of [tlsServer,proxy])server.on('connection',socket=>{
 sockets.add(socket);socket.on('close',()=>sockets.delete(socket));
});
proxy.on('connect',(request,socket,head)=>{
 if(request.url!=='merchant.example.com:443'||head.length){socket.destroy();return;}
 const upstream=netConnect(tlsServer.address().port,'127.0.0.1',()=>{
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.pipe(upstream);upstream.pipe(socket);
 });
 upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
 socket.on('close',()=>upstream.destroy());
});
const listen=server=>new Promise((resolve,reject)=>{
 server.once('error',reject);server.listen(0,'127.0.0.1',resolve);
});
await listen(tlsServer);await listen(proxy);
try {
 const contract=api.merchantContract(profile);
 assert(!JSON.stringify(contract).includes('private-merchant-resource'));
 assert(!JSON.stringify(contract).includes('MPP_JOURNEY_HMAC'));
 assert.equal(api.parseContract(new Uint8Array(Buffer.from(JSON.stringify(contract)))).sha256,contract.sha256);
 const bundle=await api.createCustomerBundle({contract});
 assert.equal(bundle.sha256,(await api.createCustomerBundle({contract})).sha256);
 const handoff=join(directory,'handoff');
 assert.equal((await api.receiveCustomerBundle({bundle,directory:handoff})).state,'COMPLETE');
 assert.equal((await api.inspectCustomerExport(handoff)).files.length,12);
 await unlink(join(handoff,'merchant_client.pyi'));
 assert.equal((await api.inspectCustomerExport(handoff)).state,'INCOMPLETE');
 assert.equal((await api.resumeCustomerExport(handoff)).state,'COMPLETE');
 const hostile=structuredClone(bundle),changed=hostile.files.find(file=>file.name==='merchant-client-bridge.mjs');
 changed.content+='\n// Unaccepted companion alteration.\n';
 changed.bytes=Buffer.byteLength(changed.content);changed.sha256=hash(changed.content);
 hostile.sha256=hash(stable({schema:hostile.schema,generatorVersion:hostile.generatorVersion,
  contractSha256:hostile.contractSha256,origin:hostile.origin,
  files:hostile.files.map(({name,bytes,sha256})=>({name,bytes,sha256}))}));
 await assert.rejects(api.receiveCustomerBundle({bundle:hostile,directory:join(directory,'altered-handoff')}),
  error=>error.code==='MPP_CUSTOMER_COMPANION_SOURCE_CHANGED');
 async function installSurface(destination) {
  const installed=join(destination,'node_modules/@tokenjunkielabs/starforge-merchant');
  await mkdir(installed,{recursive:true,mode:0o700});
  await writeFile(join(installed,'package.json'),JSON.stringify({name:'@tokenjunkielabs/starforge-merchant',
   version:'0.1.0-source.native-customer',type:'module',exports:{'./mpp/customer':{
    types:'./source/stellar/scf-starforge-20261009/mpp-charge/customer/index.d.mts',
    import:'./source/stellar/scf-starforge-20261009/mpp-charge/customer/index.mjs'}}}));
  await symlink(root,join(installed,'source'),'dir');
 }
 await installSurface(handoff);
 const configuration={...api.customerConfigurationTemplate(contract),workspace:join(directory,'customer-workspace'),
  dependencyRoot:runtime,operator:{python:'/usr/bin/python3',ledger:join(directory,'original-ledger.json'),
   policy:join(directory,'original-policy.json'),actor:'journey',service:'report'},
  signer:{payer,keyEnv:'MPP_JOURNEY_SIGNER'},transport:{mode:'explicit-connect',origin,
   proxyUrl:'http://127.0.0.1:'+proxy.address().port}};
 const generated=await import(pathToFileURL(join(handoff,'merchant-client.mjs')));
 assert.equal(generated.source.contractSha256,contract.sha256);
 await generated.initialize(configuration);
 customer=await generated.connect(configuration);
 const inputs={purchaseId:'native-node-001',query:{tag:['north','south'],edition:'2026-10'},
  json:{groupBy:'region',name:'München'}};
 const purchase=await customer.prepare('report',inputs),view=await purchase.inspect();
 assert.equal(view.phase,'REVIEW_READY');assert.equal(view.challenge.method,'stellar');
 assert.equal(view.challenge.request.amount,'7');
 assert.equal(view.request.url,origin+'/report?edition=2026-10&tag=north&tag=south');
 assert.equal(view.request.bodySha256,bindingFacts(api.buildCustomerRequest(contract,'report',{
  query:inputs.query,json:inputs.json})).bodySha256);
 const calls=received.filter(row=>row.url.startsWith('/report')).length;
 assert.equal((await (await customer.prepare('report',inputs)).inspect()).challenge.id,view.challenge.id);
 assert.equal(received.filter(row=>row.url.startsWith('/report')).length,calls);
 await assert.rejects(customer.prepare('report',{...inputs,json:{groupBy:'other'}}),
  error=>error.code==='MPP_CUSTOMER_PURCHASE_ID_ALREADY_BOUND');
 await assert.rejects(purchase.result(),error=>error.code==='MPP_CUSTOMER_RESPONSE_PENDING');
 assert.equal((await customer.refresh()).difference.changed,false);
 await customer.close();customer=null;
 const python=[
 'import json, sys',
 'sys.path.insert(0, sys.argv[1])',
 'from merchant_client import Customer, CustomerError',
 'customer=Customer(json.loads(sys.argv[2]),node=sys.argv[3],timeout_seconds=90)',
 "purchase=customer.prepare('report',purchase_id='native-python-001',query={'edition':'2026-10'},json_body={'groupBy':'region','name':'Zürich'})",
 'view=purchase.inspect()',
 "assert view['phase']=='REVIEW_READY' and view['challenge']['method']=='stellar'",
 "assert view['challenge']['request']['amount']=='7'",
 "same=customer.prepare('report',purchase_id='native-python-001',query={'edition':'2026-10'},json_body={'groupBy':'region','name':'Zürich'})",
 "assert same.inspect()['challenge']['id']==view['challenge']['id']",
 'try:',
 " customer.prepare('missing',purchase_id='retained-preparation-id')",
 'except CustomerError as error:',
 " assert error.purchase_id=='retained-preparation-id' and error.code=='MPP_CUSTOMER_OFFER_NOT_FOUND'",
 'else:',
 " raise AssertionError('Missing offer was accepted')",
 "assert customer.list()['total']==2",
 "print(json.dumps({'nativePrepare':'REVIEW_READY','sameChallengeReopened':True,'retainedErrorId':True}))"
 ].join('\n');
 const pythonResult=await run('/usr/bin/python3',['-c',python,handoff,JSON.stringify(configuration),process.execPath],
  {env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},maxBuffer:1024*1024,timeout:180000});
 const pythonFacts=JSON.parse(pythonResult.stdout);
 const revised=structuredClone(profile);revised.routes[0].resource.value.rows=4;
 const currentContract=api.merchantContract(revised);
 assert.notEqual(currentContract.profileId,contract.profileId);
 await merchant.close();merchant=await serveMerchant({workspace,profile:revised,port:0,environment});
 await workspace.configure('merchant',revised,1);
 customer=await generated.connect(configuration);
 assert.equal((await customer.refresh()).difference.profileChanged,true);
 await assert.rejects(customer.prepare('report',{purchaseId:'stale-contract-001',json:{groupBy:'region'}}),
  error=>error.code==='MPP_CUSTOMER_NATIVE_CONTRACT_CHANGED');
 assert.equal((await customer.purchase('native-node-001').inspect()).challenge.id,view.challenge.id);
 assert.equal((await customer.list()).items.find(row=>row.id==='stale-contract-001').phase,'CONTRACT_REVIEW_REQUIRED');
 await customer.close();customer=null;
 const revisedHandoff=join(directory,'revised-handoff');
 await api.exportCustomerPackage({contract:currentContract,directory:revisedHandoff});await installSurface(revisedHandoff);
 const currentGenerated=await import(pathToFileURL(join(revisedHandoff,'merchant-client.mjs')));
 customer=await currentGenerated.connect(configuration);
 assert.equal((await customer.purchase('native-node-001').inspect()).customer.activeContractChanged,true);
 assert.equal((await (await customer.prepare('report',{purchaseId:'native-revised-001',json:{groupBy:'region'}})).inspect()).phase,'REVIEW_READY');
 await customer.close();customer=null;
 assert.equal((await fetch('http://127.0.0.1:'+merchant.port+'/_mpp/contract').then(r=>r.json())).sha256,currentContract.sha256);
 const openapi=await fetch('http://127.0.0.1:'+merchant.port+'/_mpp/openapi.json').then(r=>r.json());
 assert.equal(openapi.openapi,'3.1.0');assert.equal(openapi.paths['/report'].post.operationId,'report');
 await merchant.close();merchant=null;await workspace.close();workspace=null;
 consoleApp=await serveWorkspace({directory:merchantDirectory,port:0,environment});
 assert((await fetch(consoleApp.origin).then(r=>r.text())).includes('Customer handoff'));
 const token=new URL(consoleApp.url).hash.slice(1),headers={authorization:'Bearer '+token};
 assert.equal((await fetch(consoleApp.origin+'/api/customer/package')).status,401);
 assert.equal((await fetch(consoleApp.origin+'/api/customer',{headers}).then(r=>r.json())).contract.sha256,currentContract.sha256);
 assert.equal((await fetch(consoleApp.origin+'/api/customer/package?profileId='+contract.profileId,{headers})).status,409);
 const download=await fetch(consoleApp.origin+'/api/customer/package?profileId='+currentContract.profileId,{headers});
 assert.equal(download.status,200);assert(download.headers.get('content-disposition').includes('attachment'));
 assert.equal(api.parseCustomerBundle(await download.text()).contractSha256,currentContract.sha256);
 new SourceTextModule(await readFile(join(base,'public/app.js'),'utf8'));
 const observed={runtime:native.versions,customerFiles:12,receiving:'complete and resumed original file identities',
  node:{nativePrepare:'REVIEW_READY',sameChallengeReopened:true,exactQueryAndBody:true},python:pythonFacts,
  contractRevision:'changed merchant profile rejected before approval; original purchases reopen after accepting new contract',
  console:'customer offers, authenticated bundle, revision selection',public:'native contract and OpenAPI3.1',
  requestCount:received.length,paymentStage:'REVIEW_READY'};
 await writeFile(join(directory,'result.json'),JSON.stringify(observed,null,2)+'\n');
 console.log(JSON.stringify(observed));
} finally {
 await customer?.close().catch(()=>{});await consoleApp?.close().catch(()=>{});
 await merchant?.close().catch(()=>{});await workspace?.close().catch(()=>{});
 for(const socket of sockets)socket.destroy();
 await Promise.all([tlsServer,proxy].map(server=>new Promise(resolve=>server.close(resolve))));
}
