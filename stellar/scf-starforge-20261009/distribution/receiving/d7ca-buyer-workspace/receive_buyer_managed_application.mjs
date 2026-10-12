// MIT. Receive original SDK/customer inputs through the original managed Buyer application.
// One retained operation journal owns the selected runtime, application and native purchase.
// The local merchant uses the original handoff's public terms and customer bytes. Its
// explicit CONNECT transport and private CA exercise the unchanged spawned SF88 client;
// a disposable local signer exercises approval/reservation without a blockchain transfer.
import {readFile, writeFile, open, lstat, realpath, mkdir, rename, unlink, link} from 'node:fs/promises';
import {createServer as httpServer} from 'node:http';
import {createServer as httpsServer} from 'node:https';
import {connect} from 'node:net';
import {spawn} from 'node:child_process';
import {createHash, randomUUID, randomBytes} from 'node:crypto';
import {isAbsolute, join, resolve, dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {isDeepStrictEqual as same} from 'node:util';

const ROOT='stellar/scf-starforge-20261009/';
const SCHEMA='stellar-forge.buyer-runbook.managed-reception.v1';
const INPUT='stellar-forge.buyer-runbook.managed-reception-input.v1';
const OPERATION='D7CA-SCF-BUYER-RECEIVING-APPLICATION-20261012';
const HASH=/^[a-f0-9]{64}$/;
const HANDOFF_SHA='e813efe8c32ee02ca25a8fd7edbb381734ed40c3cbf8edc1a0c36395ff0f7e6a';
const CUSTOMER_SHA='61d1d9c5745bdaa4fab39240651bc242a5186b15393fd475082fcf6e84f400ab';
const KEY_NAMES=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const SDK_FILES=['client-export.json','seller-client.mjs','seller-client.d.mts','seller-openapi.json','package.json','README.md'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const ordered=value=>plain(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,ordered(value[key])])):
  Array.isArray(value)?value.map(ordered):value;
const canonical=value=>JSON.stringify(ordered(value));
const moduleAt=(root,path)=>import(pathToFileURL(join(root,ROOT+path)).href);
const jsonBytes=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
function need(value,code){if(!value)throw Object.assign(new Error(code),{code});}
function absolute(value) {
  need(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&!value.includes('\0'),
    'BUYER_RECEIVING_CANONICAL_PATH_REQUIRED');return value;
}
async function exists(path){try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDir(path,create=false) {
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0&&
    (typeof process.getuid!=='function'||stat.uid===process.getuid())&&await realpath(path)===path,
    'BUYER_RECEIVING_PRIVATE_DIRECTORY_REQUIRED');
}
async function retain(path,bytes) {
  const expected=Buffer.from(bytes),temporary=path+'.'+randomUUID()+'.tmp';
  const matches=async()=>{
    const stat=await lstat(path);
    need(stat.isFile()&&!stat.isSymbolicLink()&&(stat.mode&0o077)===0&&
      (await readFile(path)).equals(expected),'BUYER_RECEIVING_RETAINED_INPUT_CHANGED');
  };
  if(await exists(path)){await matches();return;}
  const file=await open(temporary,'wx',0o600);
  try {
    await file.writeFile(expected);await file.sync();await file.close();
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;await matches();}
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function command(executable,args,{input='',maxBytes=1024*1024,environment=process.env}={}) {
  return new Promise((accept,reject)=>{
    const child=spawn(executable,args,{shell:false,env:environment,stdio:['pipe','pipe','pipe']});
    const output=[],errors=[];let length=0,problem;
    const collect=(target,part)=>{length+=part.length;if(length>maxBytes){
      problem=Object.assign(new Error('BUYER_RECEIVING_COMMAND_OUTPUT_LIMIT'),{code:'BUYER_RECEIVING_COMMAND_OUTPUT_LIMIT'});
      child.kill('SIGTERM');
    }else target.push(part);};
    child.stdout.on('data',part=>collect(output,part));child.stderr.on('data',part=>collect(errors,part));
    child.once('error',reject);child.stdin.on('error',()=>{});
    child.once('close',(code,signal)=>problem?reject(problem):accept({
      code,signal,stdout:Buffer.concat(output).toString('utf8'),stderr:Buffer.concat(errors).toString('utf8')}));
    child.stdin.end(input);
  });
}
async function listen(server,port) {
  await new Promise((accept,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);accept();});
  });
  return server.address().port;
}
async function closeServer(server,sockets) {
  if(!server?.listening)return;
  const finished=new Promise(accept=>server.close(accept));
  for(const socket of sockets)socket.destroy();
  server.closeAllConnections?.();await finished;
}
function track(server,sockets){server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});}

async function openFixture(config,journal,persist,installed,original) {
  const directory=join(config.receptionDirectory,'fixture');
  await privateDir(directory,true);
  const certFile=join(directory,'merchant-ca.pem'),keyFile=join(directory,'merchant-key.pem');
  const cert=await exists(certFile),key=await exists(keyFile);
  need(Boolean(cert)===Boolean(key),'BUYER_RECEIVING_RETAINED_CA_INCOMPLETE');
  if(!cert) {
    const generated=await command(config.opensslExecutable??'/usr/bin/openssl',[
      'req','-x509','-newkey','rsa:2048','-nodes','-days','3',
      '-subj','/CN='+new URL(original.handoff.purchaseUrl).hostname,
      '-addext','subjectAltName=DNS:'+new URL(original.handoff.purchaseUrl).hostname,
      '-keyout',keyFile,'-out',certFile,
    ]);
    need(generated.code===0,'BUYER_RECEIVING_CA_CREATION_FAILED');
  }
  const ca=await readFile(certFile),keyBytes=await readFile(keyFile);
  journal.fixture??={intentId:'d7ca-buyer-'+randomUUID(),operationId:'original-customer-file',
    planId:'d7ca-buyer-'+randomUUID().replaceAll('-',''),proxyPort:null,createdAt:new Date().toISOString()};
  journal.fixture.caSha256??=sha(ca);
  need(journal.fixture.caSha256===sha(ca),'BUYER_RECEIVING_RETAINED_CA_CHANGED');
  await persist();
  const originalUrl=new URL(original.handoff.purchaseUrl);
  need(originalUrl.origin==='https://paid-file.example','BUYER_RECEIVING_ORIGINAL_MERCHANT_CHANGED');
  const terms={...original.handoff.payment};
  const expectedTerms={scheme:terms.scheme,network:terms.network,asset:terms.asset,payTo:terms.payTo,
    maxAtomic:terms.amount,maxTimeoutSeconds:terms.maxTimeoutSeconds,
    paymentFlow:terms.extra?.paymentFlow??'authorization'};
  const callsFile=join(directory,'merchant-calls.jsonl'),signaturesFile=join(directory,'signatures.jsonl');
  const recordCall=async value=>{
    const file=await open(callsFile,'a',0o600);
    try{await file.writeFile(JSON.stringify(value)+'\n');await file.sync();}finally{await file.close();}
  };
  const sockets=new Set(),merchantSockets=new Set();
  let merchant,proxy;
  try {
    merchant=httpsServer({key:keyBytes,cert:ca},(req,res)=>{
      void(async()=>{
        need(req.method===original.handoff.method&&req.url===originalUrl.pathname+originalUrl.search&&
          req.headers.host===originalUrl.host,'BUYER_RECEIVING_ORIGINAL_REQUEST_CHANGED');
        let total=0;for await(const chunk of req)total+=chunk.length;
        need(total===0,'BUYER_RECEIVING_ORIGINAL_BODY_CHANGED');
        const signature=req.headers['payment-signature'];
        await recordCall({at:new Date().toISOString(),method:req.method,path:req.url,
          orderReference:req.headers['x-sf98-order-id']??null,
          signed:typeof signature==='string',signatureSha256:typeof signature==='string'?sha(signature):null});
        need(req.headers['x-sf98-order-id']===original.handoff.orderReference,
          'BUYER_RECEIVING_ORIGINAL_ORDER_HEADER_CHANGED');
        if(!signature) {
          const challenge={x402Version:2,resource:{url:original.handoff.purchaseUrl},accepts:[terms]};
          res.writeHead(402,{'payment-required':Buffer.from(JSON.stringify(challenge)).toString('base64')});
          res.end('payment required');return;
        }
        const accepted=JSON.parse(Buffer.from(signature,'base64').toString('utf8'));
        need(accepted.x402Version===2&&same(accepted.accepted,terms)&&
          accepted.payload?.receivingIntentId===journal.fixture.intentId&&
          accepted.resource?.url===original.handoff.purchaseUrl,
          'BUYER_RECEIVING_NATIVE_SIGNED_TERMS_CHANGED');
        res.writeHead(200,{'content-type':'application/octet-stream',
          'content-length':String(original.customer.length),'x-content-sha256':CUSTOMER_SHA});
        res.end(original.customer);
      })().catch(async error=>{
        await recordCall({at:new Date().toISOString(),error:error.code??'MERCHANT_RECEIVING_FAILED'}).catch(()=>{});
        if(!res.headersSent)res.writeHead(500,{'content-type':'text/plain'});
        res.end('Original receiving request did not match.');
      });
    });
    track(merchant,merchantSockets);
    const merchantPort=await listen(merchant,0);
    proxy=httpServer((_req,res)=>{res.writeHead(405);res.end();});
    track(proxy,sockets);
    proxy.on('connect',(req,client,head)=>{
      if(req.url!==originalUrl.hostname+':443') {
        client.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');return;
      }
      const upstream=connect({host:'127.0.0.1',port:merchantPort});
      sockets.add(upstream);upstream.once('close',()=>sockets.delete(upstream));
      upstream.once('error',()=>client.destroy());client.once('error',()=>upstream.destroy());
      upstream.once('connect',()=>{
        client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if(head.length)upstream.write(head);
        client.pipe(upstream);upstream.pipe(client);
      });
      client.once('close',()=>upstream.destroy());upstream.once('close',()=>client.destroy());
    });
    const proxyPort=await listen(proxy,journal.fixture.proxyPort??0);
    if(journal.fixture.proxyPort===null){journal.fixture.proxyPort=proxyPort;await persist();}
    need(proxyPort===journal.fixture.proxyPort,'BUYER_RECEIVING_PROXY_INSTANCE_CHANGED');
    const keysFile=join(directory,'operator-environment.json');
    let keys;
    if(await exists(keysFile))keys=JSON.parse(await readFile(keysFile,'utf8'));
    else {
      keys=Object.fromEntries(KEY_NAMES.map(name=>[name,randomBytes(32).toString('base64')]));
      await retain(keysFile,jsonBytes(keys));
    }
    need(plain(keys)&&Object.keys(keys).length===3&&KEY_NAMES.every(name=>
      typeof keys[name]==='string'&&Buffer.from(keys[name],'base64').length===32),
      'BUYER_RECEIVING_ORIGINAL_KEYS_CHANGED');
    const requestFile=join(directory,'original-request.json'),workspace=join(directory,'operator-workspace');
    await retain(requestFile,jsonBytes({operation:{intentId:journal.fixture.intentId,
      url:original.handoff.purchaseUrl,method:original.handoff.method,
      orderReference:original.handoff.orderReference,expect:expectedTerms},
      buyerTransport:{mode:'explicit-connect',origin:originalUrl.origin,proxyEnv:'D7CA_BUYER_PROXY'}}));
    const {initializeWorkspace,openWorkspace}=await moduleAt(installed.sourceRoot,'sf88-operator-buyer-cli/workspace.mjs');
    if(!await exists(join(workspace,'workspace.json'))) {
      await initializeWorkspace(['--config',requestFile,'--dir',workspace,
        '--actor','d7ca-buyer-receiving','--service','original-paid-file','--payer',terms.payTo,
        '--python',config.pythonExecutable??'/usr/bin/python3','--total-atomic',terms.amount,
        '--daily-atomic',terms.amount],{environment:keys,resume:Boolean(await exists(workspace))});
    }
    const native=await openWorkspace(['--dir',workspace]);
    const signerFile=join(directory,'receiving-signer.mjs');
    const signerSource=[
      "import {open} from 'node:fs/promises';",
      "import {isDeepStrictEqual as same} from 'node:util';",
      'const terms='+JSON.stringify(terms)+';',
      'const intentId='+JSON.stringify(journal.fixture.intentId)+';',
      'const url='+JSON.stringify(original.handoff.purchaseUrl)+';',
      'const destination='+JSON.stringify(signaturesFile)+';',
      'export async function sign({intent,challenge,accepted}) {',
      ' if(!Object.isFrozen(intent)||intent.intentId!==intentId||intent.url!==url||',
      '   intent.amount!==terms.amount||!same(accepted,terms)||challenge.resource.url!==url)',
      "   throw Object.assign(new Error('RECEIVING_SIGNER_BINDING_CHANGED'),{code:'RECEIVING_SIGNER_BINDING_CHANGED'});",
      " const file=await open(destination,'a',0o600);",
      " try{await file.writeFile(JSON.stringify({intentId,requestSha256:intent.requestSha256??null,amount:intent.amount})+'\\n');",
      ' await file.sync();}finally{await file.close();}',
      ' return {x402Version:2,accepted,resource:challenge.resource,payload:{receivingIntentId:intentId}};',
      '}','',
    ].join('\n');
    await retain(signerFile,Buffer.from(signerSource));
    const configsDirectory=join(config.receptionDirectory,'buyer-configs');
    await privateDir(configsDirectory,true);
    const operationConfig={...native.config,signerModule:signerFile};
    await retain(join(configsDirectory,'original-customer.json'),jsonBytes(operationConfig));
    const environmentFile=join(directory,'application-environment.json');
    await retain(environmentFile,jsonBytes({...keys,NODE_EXTRA_CA_CERTS:certFile,
      D7CA_BUYER_PROXY:'http://127.0.0.1:'+proxyPort,
      PYTHONDONTWRITEBYTECODE:'1',NODE_DISABLE_COMPILE_CACHE:'1'}));
    return {directory,workspace,config:operationConfig,configsDirectory,environmentFile,signaturesFile,callsFile,
      close:async()=>{await closeServer(proxy,sockets);await closeServer(merchant,merchantSockets);}};
  }catch(error){
    await Promise.allSettled([closeServer(proxy,sockets),closeServer(merchant,merchantSockets)]);throw error;
  }
}

async function nativeLedger(installed,fixture,python,intentId,expectedAmount) {
  const program=[
    'import base64,json,sys',
    'from pathlib import Path',
    'sys.path.insert(0,sys.argv[1])',
    'from governor import Governor',
    'keys=json.load(sys.stdin)',
    'policy=json.loads(Path(sys.argv[2]).read_text())',
    "names=('SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64')",
    'g=Governor(sys.argv[3],policy,*(base64.b64decode(keys[n],validate=True) for n in names))',
    'try:',
    " g.db.execute('BEGIN')",
    ' try:',
    '  result=g.audit()',
    "  rows=g.db.execute('SELECT request_id,request_digest,amount,state,actual FROM reservations ORDER BY request_id').fetchall()",
    "  print(json.dumps({'audit':result,'reservations':[dict(zip(('request_id','request_sha256','amount','state','actual'),r)) for r in rows]}))",
    " finally:g.db.execute('ROLLBACK')",
    'finally:g.close()','',
  ].join('\n');
  const result=await command(python,['-I','-B','-c',program,
    join(installed.sourceRoot,ROOT,'sf36-spend-governor'),
    fixture.config.operator.policy,fixture.config.operator.ledger],{
    input:await readFile(join(fixture.directory,'operator-environment.json'),'utf8'),
    environment:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},
  });
  need(result.code===0,'BUYER_RECEIVING_ORIGINAL_GOVERNOR_READ_FAILED');
  const value=JSON.parse(result.stdout);
  need(value.audit?.outcome==='JOURNAL_CONSISTENT'&&value.audit.rows===1&&
    value.reservations?.length===1&&value.reservations[0].request_id===intentId&&
    value.reservations[0].amount===expectedAmount&&HASH.test(value.reservations[0].request_sha256),
    'BUYER_RECEIVING_ORIGINAL_RESERVATION_CHANGED');
  return value;
}
async function jsonLines(path){
  if(!await exists(path))return [];
  return (await readFile(path,'utf8')).split('\n').filter(Boolean).map(line=>JSON.parse(line));
}
async function receiveInputs(config) {
  const handoffBytes=await readFile(config.handoffFile),customer=await readFile(config.customerFile);
  need(handoffBytes.length===768&&sha(handoffBytes)===HANDOFF_SHA&&
    customer.length===524288&&sha(customer)===CUSTOMER_SHA,
    'BUYER_RECEIVING_ORIGINAL_CUSTOMER_INPUT_CHANGED');
  const handoff=JSON.parse(handoffBytes);
  need(handoff.schema==='stellar-forge.sf101.purchase-handoff.v1'&&
    handoff.payment?.scheme==='exact'&&handoff.payment.network==='stellar:testnet'&&
    handoff.payment.amount==='10000'&&handoff.file.bytes===customer.length&&
    handoff.file.sha256===CUSTOMER_SHA,'BUYER_RECEIVING_ORIGINAL_HANDOFF_CHANGED');
  const sdk={};
  for(const name of SDK_FILES)sdk[name]=await readFile(join(config.sdkDirectory,name));
  need(sha(sdk['client-export.json'])===config.expectedSDKManifestSha256,
    'BUYER_RECEIVING_ORIGINAL_SDK_RECEIPT_CHANGED');
  const manifest=JSON.parse(sdk['client-export.json']);
  need(Array.isArray(manifest.files)&&manifest.files.length===5,'BUYER_RECEIVING_ORIGINAL_SDK_INCOMPLETE');
  for(const item of manifest.files)need(SDK_FILES.includes(item.name)&&
    sdk[item.name].length===item.bytes&&sha(sdk[item.name])===item.sha256,
    'BUYER_RECEIVING_ORIGINAL_SDK_FILE_CHANGED');
  return {handoffBytes,handoff,customer,sdk,identity:{
    handoff:{bytes:handoffBytes.length,sha256:HANDOFF_SHA},
    customer:{bytes:customer.length,sha256:CUSTOMER_SHA},
    sdk:SDK_FILES.map(name=>({name,bytes:sdk[name].length,sha256:sha(sdk[name])})),
  }};
}
function nativeApi(value) {
  const url=new URL(value);
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&
    url.pathname==='/'&&!url.hash&&!url.search&&Number(url.port)>0,
    'BUYER_RECEIVING_PRIVATE_LISTENER_REQUIRED');
  let token;
  const raw=async(path,{body,method=body===undefined?'GET':'POST'}={})=>{
    const response=await fetch(new URL(path,url),{method,redirect:'error',signal:AbortSignal.timeout(30000),
      headers:{Origin:url.origin,Accept:'application/json',
        ...(body===undefined?{}:{'content-type':'application/json','x-runbook-session':token??''})},
      ...(body===undefined?{}:{body:JSON.stringify(body)})});
    const buffer=Buffer.from(await response.arrayBuffer());
    need(buffer.length<=16*1048576,'BUYER_RECEIVING_HTTP_RESPONSE_TOO_LARGE');
    return {response,bytes:buffer};
  };
  const request=async(path,body)=>{
    const {response,bytes}=await raw(path,{body});
    let result;
    try{result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw Object.assign(new Error('BUYER_RECEIVING_INCOMPLETE_ORIGINAL_REPLY'),
      {code:'BUYER_RECEIVING_INCOMPLETE_ORIGINAL_REPLY',path,status:response.status});}
    need(response.ok,'BUYER_RECEIVING_HTTP_'+response.status+'_'+String(result.error??result.code??'FAILED').slice(0,120));
    if(path==='/api/state'){need(typeof result.token==='string','BUYER_RECEIVING_SESSION_REQUIRED');token=result.token;}
    return result;
  };
  return {url,raw,request};
}
async function until(read,accept,{timeoutMs,label,onProgress}) {
  const started=Date.now();let nextProgress=started;
  for(;;) {
    const value=await read();
    if(accept(value))return value;
    if(Date.now()>=nextProgress){onProgress?.({label,waitingMs:Date.now()-started});nextProgress=Date.now()+15000;}
    need(Date.now()-started<=timeoutMs,'BUYER_RECEIVING_'+label+'_PENDING');
    await delay(250);
  }
}

export async function receiveBuyerManagedApplication(config,{onProgress=()=>{},openWorkspaceClient}={}) {
  process.umask(0o077);
  need(plain(config)&&config.schema===INPUT,'BUYER_RECEIVING_CONFIGURATION_REQUIRED');
  for(const name of ['runtimeDirectory','receptionDirectory','sdkDirectory','handoffFile','customerFile'])
    absolute(config[name]);
  for(const name of ['applicationWorkspace','bootstrapSourceRoot','pythonExecutable','opensslExecutable'])
    if(config[name]!==undefined)absolute(config[name]);
  need(/^[a-f0-9]{40}$/.test(config.expectedSourceCommit??'')&&HASH.test(config.expectedManifest??'')&&
    HASH.test(config.expectedSDKManifestSha256??''),'BUYER_RECEIVING_SELECTED_SOURCE_REQUIRED');
  if(config.homeId!==undefined)need(/^[a-f0-9]{24}$/.test(config.homeId),'BUYER_RECEIVING_HOME_REQUIRED');
  const timeoutMs=config.waitTimeoutMs??300000;
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000&&timeoutMs<=3600000,'BUYER_RECEIVING_TIMEOUT_INVALID');
  const bootstrap=config.bootstrapSourceRoot??join(config.runtimeDirectory,'package','source');
  const {inspectMerchantRuntime}=await moduleAt(bootstrap,'sf46-release/runtime-package.mjs');
  const installed=await inspectMerchantRuntime(config.runtimeDirectory,{expectedManifest:config.expectedManifest,load:false});
  need(installed.sourceCommit===config.expectedSourceCommit,'BUYER_RECEIVING_INSTALLED_SOURCE_CHANGED');
  const original=await receiveInputs(config);
  const {createRuntimeWorkspace,openRuntimeWorkspace}=await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/model.mjs');
  const {managedCommandAlive}=await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/managed-workspace.mjs');
  const {buyerRunbookStartup}=await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/application-buyer-runbook.mjs');
  const {readJSON,saveJSON,operationLease}=await moduleAt(installed.sourceRoot,'distribution/runtime-workspace/storage.mjs');
  await privateDir(config.receptionDirectory,true);
  const lease=await operationLease(join(config.receptionDirectory,'receiving.lock'));
  const receiptPath=join(config.receptionDirectory,'buyer-managed-reception.json');
  let journal,model,fixture,workspaceClient,stage='OPEN_RECEIVING',failed=true;
  need(openWorkspaceClient===undefined||typeof openWorkspaceClient==='function','BUYER_RECEIVING_WORKSPACE_CLIENT_REQUIRED');
  try {
    journal=await readJSON(receiptPath,true);
    const continuing=Boolean(journal);
    const selection={
      runtimeDirectory:installed.directory,sourceCommit:installed.sourceCommit,
      sourceManifestSha256:installed.sourceManifestSha256,installationId:installed.installationId,
      applicationWorkspace:config.applicationWorkspace??join(config.receptionDirectory,'applications'),
      buyerDirectory:join(config.receptionDirectory,'buyer-workspace'),
      inputs:original.identity,pythonExecutable:config.pythonExecutable??'/usr/bin/python3',
      homeId:config.homeId??null,
    };
    if(journal)need(journal.schema===SCHEMA&&same(journal.selection,selection),'BUYER_RECEIVING_SELECTION_CHANGED');
    else{
      journal={schema:SCHEMA,operation:OPERATION,createdAt:new Date().toISOString(),selection,
        saveRequestId:randomUUID(),passes:[{name:'first-open',requestId:randomUUID()},
          {name:'reopen',requestId:randomUUID()}]};
      await saveJSON(receiptPath,journal);
    }
    const persist=async()=>{journal.updatedAt=new Date().toISOString();await saveJSON(receiptPath,journal,true);};
    const progress=value=>onProgress({stage,applicationId:journal.applicationId??null,...value});
    if(journal.completedAt){failed=false;return journal;}
    stage='OPEN_ORIGINAL_MERCHANT_TRANSPORT';
    fixture=await openFixture(config,journal,persist,installed,original);
    if(!await exists(join(selection.applicationWorkspace,'workspace.json'))) {
      need(!config.applicationWorkspace,'BUYER_RECEIVING_EXISTING_APPLICATIONS_WORKSPACE_MISSING');
      await createRuntimeWorkspace({directory:selection.applicationWorkspace});
    }
    model=await openRuntimeWorkspace({directory:selection.applicationWorkspace});
    const attached=await model.attach({directory:installed.directory,label:'Buyer receiving original customer workflow'});
    need(attached.status==='READY','BUYER_RECEIVING_RUNTIME_NOT_READY');
    journal.runtimeId=attached.runtimeId;await persist();
    const checkBinding=value=>{
      need(value.command==='buyer-runbook'&&value.terminal===false&&Array.isArray(value.args)&&
        value.args[0]==='workspace','BUYER_RECEIVING_ORIGINAL_COMMAND_CHANGED');
      for(const [flag,expected]of [['--state',selection.buyerDirectory],
        ['--configs',fixture.configsDirectory],['--approval-mode','browser'],['--port','0']]) {
        const positions=value.args.flatMap((arg,index)=>arg===flag?[index]:[]);
        need(positions.length===1&&value.args[positions[0]+1]===expected,
          'BUYER_RECEIVING_ORIGINAL_COMMAND_BINDING_CHANGED');
      }
      const at=value.args.indexOf('--expected-selection-sha256');
      need(at>0&&HASH.test(value.args[at+1]),'BUYER_RECEIVING_SOURCE_DIGEST_REQUIRED');
    };
    const app=async()=>{
      const value=(await model.applicationsState()).applications.find(item=>item.id===journal.applicationId);
      need(value,'BUYER_RECEIVING_APPLICATION_MISSING');return value;
    };
    const awaitState=async(label,accept,recover)=>{
      const recovered=new Set(),started=Date.now();let nextProgress=started;
      for(;;) {
        const value=await app();
        if(value.phase==='INTERRUPTED'&&value.current?.state)
          value.receivingCommandAlive=await managedCommandAlive(value.current.state);
        if(accept(value))return value;
        if((value.phase==='INTERRUPTED'||value.adoption?.phase==='INTERRUPTED')&&recover&&!value.receivingCommandAlive) {
          const current=value.current??value.adoption,key=canonical([current?.id,current?.phase,current?.state]);
          if(!recovered.has(key)){recovered.add(key);await recover(value);continue;}
        }
        need(!['FAILED','UNAVAILABLE','STOPPED'].includes(value.phase)&&value.adoption?.phase!=='FAILED',
          'BUYER_RECEIVING_ORIGINAL_OPERATION_'+value.phase);
        if(Date.now()>=nextProgress){progress({label,phase:value.phase,
          operationId:value.current?.id??value.adoption?.id??null});nextProgress=Date.now()+15000;}
        need(Date.now()-started<=timeoutMs,'BUYER_RECEIVING_ORIGINAL_OPERATION_PENDING');
        await delay(500);
      }
    };
    if(!journal.configurationReviewId) {
      stage='REVIEW_ORIGINAL_APPLICATION';
      const review=await model.applicationsReview({runtimeId:attached.runtimeId,kind:'buyer-runbook',
        label:'Buyer receiving original SDK and customer file',
        ...(config.homeId?{homeId:config.homeId}:{}),
        settings:{stateDirectory:selection.buyerDirectory,configsDirectory:fixture.configsDirectory,
          port:0,environmentFile:fixture.environmentFile}});
      checkBinding(review.command);journal.configurationReviewId=review.id;await persist();
    }
    if(!journal.applicationId) {
      stage='SAVE_AND_ADOPT';
      const saved=await model.applicationsSave({requestId:journal.saveRequestId,reviewId:journal.configurationReviewId});
      journal.applicationId=saved.applicationId;journal.configurationRevision=saved.revision;
      journal.adoptionOperationId=saved.connection?.operationId??saved.connection?.id??null;await persist();
      if(saved.connectionError)throw Object.assign(new Error(saved.connectionError.message),{code:saved.connectionError.code});
    }
    stage='CONNECT_ORIGINAL_RUNTIME';
    await model.applicationsConnect({applicationId:journal.applicationId});
    const recoverAdoption=async value=>{
      const operation=value.adoption;if(!operation||operation.active)return;
      journal.adoptionOperationId=operation.id;
      journal.adoptionRecovery={at:new Date().toISOString(),result:operation.phase==='QUEUED'?
        await model.resumeQueued(operation.id):await model.recoverManagedOperation(operation.id)};
      await persist();
    };
    const connection=await app();
    if(!connection.release&&connection.adoption&&!connection.adoption.active&&
      (connection.adoption.phase==='INTERRUPTED'||continuing&&['QUEUED','FAILED'].includes(connection.adoption.phase)))
      await recoverAdoption(connection);
    await awaitState('Original selected runtime adoption',value=>Boolean(value.release),recoverAdoption);

    for(const pass of journal.passes) {
      if(pass.stoppedAt)continue;
      await model.close();model=await openRuntimeWorkspace({directory:selection.applicationWorkspace});
      let current=await app();
      if(current.current?.id===pass.requestId&&current.phase==='STOPPED'&&pass.observed) {
        pass.stoppedAt=new Date().toISOString();pass.terminalPhase=current.current.phase;await persist();continue;
      }
      if(current.current?.id===pass.requestId&&current.phase==='STOPPED'&&!pass.observed) {
        // Reopen the same application after a confirmed stopped host. Keep every
        // prior managed operation and the original buyer run/intent unchanged.
        pass.priorManagedOperations??=[];
        pass.priorManagedOperations.push({requestId:pass.requestId,reviewId:pass.reviewId,
          phase:current.phase,retainedAt:new Date().toISOString()});
        pass.requestId=randomUUID();delete pass.reviewId;await persist();
      }
      if(!pass.reviewId) {
        stage='REVIEW_'+pass.name.toUpperCase();
        const review=await model.applicationsStartReview({applicationId:journal.applicationId});
        checkBinding(review.command);pass.reviewId=review.id;await persist();
      }
      const recoverPass=async()=>{
        pass.recovery={at:new Date().toISOString(),result:await model.applicationsRecover({
          applicationId:journal.applicationId,operationId:pass.requestId})};await persist();
      };
      const ownedUrl=value=>value.current?.id===pass.requestId?
        value.current.privateUrl??(value.receivingCommandAlive?value.current.url?.url:null):null;
      stage='START_'+pass.name.toUpperCase();
      const savedRun=(await app()).runs.find(value=>value.id===pass.requestId);
      if(savedRun)await recoverPass();
      else await model.applicationsStart({applicationId:journal.applicationId,
        requestId:pass.requestId,reviewId:pass.reviewId});
      const running=await awaitState('Original buyer startup',value=>Boolean(ownedUrl(value)),recoverPass);
      const request=await readJSON(join(selection.applicationWorkspace,'operations',pass.requestId,'request.json'));
      checkBinding(request);
      let api=nativeApi(ownedUrl(running));
      const announcement=await api.request('/api/launch');
      const startup=await buyerRunbookStartup(request,JSON.stringify(announcement));
      need(startup?.url===api.url.href&&startup.original.instanceId===announcement.instanceId&&
        announcement.approvalMode==='BROWSER'&&announcement.approvalAvailable===true&&
        announcement.selection.directory===selection.buyerDirectory,
        'BUYER_RECEIVING_ORIGINAL_LISTENER_BINDING_CHANGED');
      if(journal.launchSelectionSha256)
        need(journal.launchSelectionSha256===announcement.selectionSha256,'BUYER_RECEIVING_REOPEN_SELECTION_CHANGED');
      else{journal.launchSelectionSha256=announcement.selectionSha256;await persist();}
      if(openWorkspaceClient){
        workspaceClient=await openWorkspaceClient({api,announcement,pass,config,installed,original,journal,selection});
        need(workspaceClient&&typeof workspaceClient.request==='function'&&typeof workspaceClient.close==='function',
          'BUYER_RECEIVING_WORKSPACE_CLIENT_INVALID');
        api={...api,request:workspaceClient.request};
      }
      const initial=await api.request('/api/state');
      need(initial.launch.instanceId===announcement.instanceId&&initial.approvalMode==='BROWSER'&&
        initial.approvalAvailable===true,'BUYER_RECEIVING_BROWSER_CHANNEL_NOT_AVAILABLE');
      if(pass.name==='first-open') {
        stage='ORIGINAL_LOCAL_BUYER_SETUP';
        const settings={schema:'stellar-forge.buyer-runbook-operator.v1',
          actor:'d7ca-buyer-receiving',service:'original-paid-file',payer:original.handoff.payment.payTo,
          python:selection.pythonExecutable,maxTotalAtomic:original.handoff.payment.amount,
          maxDailyAtomic:original.handoff.payment.amount,secretEnv:'D7CA_RECEIVING_WALLET',
          httpsProxyEnv:'D7CA_BUYER_PROXY'};
        let operator=await api.request('/api/operator');
        if(!journal.operator) {
          if(!journal.operatorProposal) {
            const proposal={settings,expectedStateSha256:operator.stateSha256,note:'Original managed buyer receiving setup'};
            const review=await api.request('/api/operator/review',proposal);
            journal.operatorProposal={...proposal,expectedReviewSha256:review.reviewSha256};await persist();
          }
          operator=await api.request('/api/operator/save',journal.operatorProposal);
          operator=await api.request('/api/operator');
          need(operator.configured&&operator.mode==='WORKSPACE'&&HASH.test(operator.settingsSha256??'')&&
            operator.settings.actor===settings.actor&&operator.settings.service===settings.service&&
            operator.settings.maxTotalAtomic===settings.maxTotalAtomic,
            'BUYER_RECEIVING_ORIGINAL_SETUP_NOT_SAVED');
          journal.operator={revision:operator.revision,revisionNumber:operator.revisionNumber,
            settingsSha256:operator.settingsSha256,settings:operator.settings};await persist();
        }
        need(operator.revision===journal.operator.revision&&operator.settingsSha256===journal.operator.settingsSha256,
          'BUYER_RECEIVING_ORIGINAL_SETUP_CHANGED');
        stage='RECEIVE_ORIGINAL_SIX_FILE_SDK';
        const clientId='client-'+config.expectedSDKManifestSha256;
        await api.request('/api/clients/upload',{base64:original.sdk['client-export.json'].toString('base64')});
        for(const file of SDK_FILES.filter(name=>name!=='client-export.json'))
          await api.request('/api/clients/file',{id:clientId,file,base64:original.sdk[file].toString('base64')});
        const client=await api.request('/api/clients/'+clientId);
        need(client.state==='COMPLETE'&&client.manifestSha256===config.expectedSDKManifestSha256&&
          client.files.length===5&&client.files.every(file=>file.state==='RETAINED'),
          'BUYER_RECEIVING_ORIGINAL_SDK_NOT_COMPLETE');
        for(const file of SDK_FILES){
          const received=await api.raw('/files/clients/'+clientId+'/'+file);
          need(received.response.ok&&received.bytes.equals(original.sdk[file]),
            'BUYER_RECEIVING_ORIGINAL_SDK_DOWNLOAD_CHANGED');
        }
        journal.sdk={id:clientId,manifestSha256:client.manifestSha256,state:client.state,
          operations:client.operations.map(value=>({id:value.id,method:value.method,path:value.path})),
          files:original.identity.sdk};await persist();
        stage='RECEIVE_ORIGINAL_PAID_FILE_HANDOFF';
        const order=await api.request('/api/paid-files/upload',{
          filename:'merchant.handoff.json',base64:original.handoffBytes.toString('base64')});
        need(order.handoffSha256===HANDOFF_SHA&&same(order.handoff,original.handoff),
          'BUYER_RECEIVING_ORIGINAL_PAID_FILE_PROMISE_CHANGED');
        journal.paidFile={id:order.id,handoffSha256:order.handoffSha256,summary:order.summary};await persist();
        stage='READ_ORIGINAL_BROWSER_ASSETS';
        const assets=[
          ['/','buyer-runbook/workspace-ui/index.html'],
          ['/app.mjs','buyer-runbook/workspace-ui/app.mjs'],
          ['/style.css','buyer-runbook/workspace-ui/style.css'],
          ['/approval-ui/approval-panel.mjs','sf81-buyer-operator-bridge/browser-ui/approval-panel.mjs'],
          ['/approval-ui/approval.css','sf81-buyer-operator-bridge/browser-ui/approval.css'],
        ];
        const served=[];
        for(const [route,file]of assets) {
          const response=await api.raw(route),expected=await readFile(join(installed.sourceRoot,ROOT,file));
          need(response.response.ok&&response.bytes.equals(expected),'BUYER_RECEIVING_SERVED_SOURCE_CHANGED');
          if(route==='/app.mjs'||route==='/approval-ui/approval-panel.mjs'){
            const parsed=await command(process.execPath,['--input-type=module','--check'],{input:response.bytes});
            need(parsed.code===0,'BUYER_RECEIVING_SERVED_MODULE_INVALID');
          }
          served.push({route,bytes:response.bytes.length,sha256:sha(response.bytes)});
        }
        journal.servedAssets=served;await persist();
        stage='REVIEW_ORIGINAL_ACQUISITION';
        if(!journal.buyerRunId) {
          const currentState=await api.request('/api/state');
          const prior=currentState.drafts.filter(value=>value.planId===journal.fixture.planId);
          need(prior.length<=1,'BUYER_RECEIVING_ORIGINAL_DRAFT_AMBIGUOUS');
          let draft;
          if(prior.length)draft=await api.request('/api/drafts/'+prior[0].id);
          else draft=await api.request('/api/drafts/save',{expectedRevision:0,
            manifest:{schema:'stellar-forge.buyer-runbook.v1',id:journal.fixture.planId,
              title:'Original paid-file customer receiving',operations:[{
                id:journal.fixture.operationId,label:'Original customer file',
                config:'original-customer.json',saveAs:'customer-product.bin'}]}});
          need(draft.revision===1&&draft.plan.operations.length===1&&
            draft.plan.operations[0].intentId===journal.fixture.intentId,
            'BUYER_RECEIVING_ORIGINAL_DRAFT_CHANGED');
          journal.buyerRunId=draft.id;journal.buyerReviewSha256=draft.reviewSha256;await persist();
        }
        const runPath='/api/runs/'+journal.buyerRunId;
        await api.request('/api/drafts/initialize',{id:journal.buyerRunId,expectedRevision:1,
          reviewSha256:journal.buyerReviewSha256});
        let originalRun=await api.request(runPath);
        const selectRow=value=>value.state.operations.find(item=>item.id===journal.fixture.operationId);
        let row=selectRow(originalRun);
        need(row?.intentId===journal.fixture.intentId&&row.integrity==='UNCHANGED',
          'BUYER_RECEIVING_FROZEN_NATIVE_INPUT_CHANGED');
        if(!row.result) {
          stage='EXECUTE_ORIGINAL_SF88';
          if(originalRun.active?.runId===journal.buyerRunId&&!originalRun.active.finishedAt) {
            journal.buyerExecutionId=originalRun.active.executionId;await persist();
          }else if(row.state==='UNATTEMPTED') {
            // The original immutable intent and attempt guard remain authoritative
            // if a previous HTTP reply was lost; no new run or intent is created.
            journal.buyerDispatchAt??=new Date().toISOString();await persist();
            const dispatched=await api.request('/api/runs/execute',{id:journal.buyerRunId,only:journal.fixture.operationId});
            journal.buyerExecutionId=dispatched.executionId;await persist();
          }else throw Object.assign(new Error('Read and recover this original native attempt.'),
            {code:'BUYER_RECEIVING_ORIGINAL_ATTEMPT_REQUIRES_RECOVERY'});
          stage='APPROVE_ORIGINAL_NATIVE_TERMS';
          const pending=await until(async()=>({approval:await api.request('/api/approval'),run:await api.request(runPath)}),
            value=>{
              const item=selectRow(value.run);
              if(value.run.active?.finishedAt&&!item.result)
                throw Object.assign(new Error('Read the original native preflight result.'),
                  {code:item.lastError?.code??'BUYER_RECEIVING_ORIGINAL_RESULT_MISSING'});
              return value.approval.approval?.state==='AWAITING_OPERATOR'||Boolean(item.result);
            },{
              timeoutMs,label:'ORIGINAL_APPROVAL',onProgress:progress});
          if(!selectRow(pending.run).result) {
            const state=pending.approval,review=state.approval.review;
            need(state.current?.runId===journal.buyerRunId&&
              state.current.executionId===journal.buyerExecutionId&&
              state.current.operationId===journal.fixture.operationId&&state.current.intentId===journal.fixture.intentId&&
              review.request_id===journal.fixture.intentId&&review.resource===original.handoff.purchaseUrl&&
              review.method===original.handoff.method&&review.actor==='d7ca-buyer-receiving'&&
              review.service==='original-paid-file'&&review.max_atomic_units_to_reserve===original.handoff.payment.amount&&
              same(review.complete_original_accepted_terms,original.handoff.payment)&&
              state.approval.current_native_budget_estimate.approved===true,
              'BUYER_RECEIVING_REVIEW_ORIGINAL_TERMS_CHANGED');
            const decision={runId:state.current.runId,executionId:state.current.executionId,
              operationId:state.current.operationId,intent:state.current.intentId,
              approvalId:state.approval.id,requestSha256:state.approval.review.request_sha256,decision:'approve'};
            journal.approval={decision,review,budget:state.approval.current_native_budget_estimate,
              observedAt:new Date().toISOString()};await persist();
            await api.request('/api/approval',decision);
          }
          originalRun=await until(()=>api.request(runPath),value=>{
            const item=selectRow(value);
            if(value.active?.finishedAt&&!item.result)
              throw Object.assign(new Error('Original run ended before recording an SF88 result.'),
                {code:item.lastError?.code??'BUYER_RECEIVING_ORIGINAL_RESULT_MISSING'});
            return Boolean(item.result)&&Boolean(!value.active||value.active.finishedAt);
          },{timeoutMs,label:'ORIGINAL_RESULT',onProgress:progress});
          row=selectRow(originalRun);
        }
        const summary=row.result.summary;
        need(row.result.nativeProcessStarted===true&&summary?.mode==='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'&&
          summary.intentId===journal.fixture.intentId&&summary.httpStatus===200&&
          summary.retry==='NO_AUTOMATIC_RETRY'&&summary.operatorReservation?.outcome==='FRESH_RESERVATION_APPROVED'&&
          summary.operatorReservation.reserved_atomic_units===original.handoff.payment.amount&&
          summary.responseFile?.status==='SAVED'&&summary.responseFile.bytes===original.customer.length&&
          summary.responseFile.sha256===CUSTOMER_SHA,'BUYER_RECEIVING_ORIGINAL_RESULT_NOT_RECEIVED');
        const download=await api.raw('/files/'+journal.buyerRunId+'/resources/'+journal.fixture.operationId);
        need(download.response.ok&&download.bytes.equals(original.customer),
          'BUYER_RECEIVING_ORIGINAL_CUSTOMER_DOWNLOAD_CHANGED');
        const reportPath=join(config.receptionDirectory,'original-buyer-report.json');
        let report;
        if(await exists(reportPath)) {
          const bytes=await readFile(reportPath),saved=JSON.parse(bytes);
          need(saved.plan.id===journal.fixture.planId&&
            same(saved.operations.find(item=>item.id===journal.fixture.operationId)?.result,row.result),
            'BUYER_RECEIVING_RETAINED_REPORT_CHANGED');
          report={bytes};
        }else {
          report=await api.raw('/files/'+journal.buyerRunId+'/report.json');
          need(report.response.ok,'BUYER_RECEIVING_ORIGINAL_REPORT_UNAVAILABLE');
          await retain(reportPath,report.bytes);
        }
        const signatures=await jsonLines(fixture.signaturesFile),calls=await jsonLines(fixture.callsFile);
        need(signatures.length===1&&signatures[0].intentId===journal.fixture.intentId&&
          calls.filter(call=>call.signed).length===1&&calls.filter(call=>call.signed===false).length===1&&
          calls.every(call=>!call.error),'BUYER_RECEIVING_ORIGINAL_NATIVE_ATTEMPT_COUNT_CHANGED');
        const ledger=await nativeLedger(installed,fixture,selection.pythonExecutable,
          journal.fixture.intentId,original.handoff.payment.amount);
        if(journal.approval)need(ledger.reservations[0].request_sha256===journal.approval.review.request_sha256,
          'BUYER_RECEIVING_ORIGINAL_APPROVAL_LEDGER_CHANGED');
        journal.originalResult={runId:journal.buyerRunId,operationId:journal.fixture.operationId,
          nativeResultSha256:sha(canonical(row.result)),summary,
          reportSha256:sha(report.bytes),ledger,signatures,calls,
          customerSha256:sha(download.bytes),customerBytes:download.bytes.length};
        await persist();
      }else{
        stage='REOPEN_SAVED_BUYER_WORK';
        const operator=await api.request('/api/operator'),client=await api.request('/api/clients/'+journal.sdk.id),
          order=await api.request('/api/paid-files/'+journal.paidFile.id),
          saved=await api.request('/api/runs/'+journal.buyerRunId);
        const row=saved.state.operations.find(item=>item.id===journal.fixture.operationId);
        need(operator.revision===journal.operator.revision&&operator.settingsSha256===journal.operator.settingsSha256&&
          same(operator.settings,journal.operator.settings)&&client.state==='COMPLETE'&&
          client.manifestSha256===journal.sdk.manifestSha256&&order.handoffSha256===HANDOFF_SHA&&
          same(order.handoff,original.handoff)&&sha(canonical(row.result))===journal.originalResult.nativeResultSha256&&
          row.integrity==='UNCHANGED','BUYER_RECEIVING_REOPENED_ORIGINAL_WORK_CHANGED');
        const output=await api.raw('/files/'+journal.buyerRunId+'/resources/'+journal.fixture.operationId);
        need(output.response.ok&&output.bytes.equals(original.customer),'BUYER_RECEIVING_REOPENED_FILE_CHANGED');
        const newApproval=await api.request('/api/approval');
        need(newApproval.current===null&&newApproval.approval===null&&newApproval.approvalAvailable===true,
          'BUYER_RECEIVING_REOPENED_BROKER_REPLAYED');
        const signatures=await jsonLines(fixture.signaturesFile),calls=await jsonLines(fixture.callsFile);
        need(signatures.length===journal.originalResult.signatures.length&&
          calls.length===journal.originalResult.calls.length,'BUYER_RECEIVING_REOPEN_EXECUTED_AGAIN');
      }
      if(workspaceClient){
        await workspaceClient.received?.({journal,pass,announcement});
        await workspaceClient.close();workspaceClient=null;
      }
      pass.observed={at:new Date().toISOString(),instanceId:announcement.instanceId,pid:announcement.pid,
        selectionSha256:announcement.selectionSha256,sourceFiles:announcement.sourceFiles,
        operatorRevision:journal.operator.revision,sdkId:journal.sdk.id,paidFileId:journal.paidFile.id,
        buyerRunId:journal.buyerRunId,nativeResultSha256:journal.originalResult.nativeResultSha256,
        customerSha256:CUSTOMER_SHA};
      await persist();progress({phase:'RUNNING',operationId:pass.requestId,instanceId:announcement.instanceId});
      stage='STOP_'+pass.name.toUpperCase();
      await model.applicationsStop({applicationId:journal.applicationId,operationId:pass.requestId});
      const stopped=await awaitState('Original buyer drain',value=>
        value.phase==='STOPPED'&&value.current?.id===pass.requestId&&!value.current.active,recoverPass);
      pass.stoppedAt=new Date().toISOString();pass.terminalPhase=stopped.current.phase;await persist();
      progress({phase:'STOPPED',operationId:pass.requestId});
    }
    need(journal.passes[0].observed.instanceId!==journal.passes[1].observed.instanceId&&
      journal.passes[0].observed.nativeResultSha256===journal.passes[1].observed.nativeResultSha256,
      'BUYER_RECEIVING_ORIGINAL_REOPEN_NOT_OBSERVED');
    stage='COMPLETED';journal.completedAt=new Date().toISOString();delete journal.issue;await persist();
    failed=false;progress({phase:'COMPLETED',receiptPath});return journal;
  }catch(error){
    if(journal){journal.issue={stage,at:new Date().toISOString(),code:error.code??'BUYER_RECEIVING_FAILED',
      message:String(error.message??error).slice(0,600)};
      await saveJSON(receiptPath,journal,true).catch(()=>{});}
    throw error;
  }finally{
    try{await workspaceClient?.close();}catch(error){if(journal){journal.agentCloseIssue={code:error.code??'BUYER_AGENT_CLOSE_INCOMPLETE',at:new Date().toISOString()};await saveJSON(receiptPath,journal,true).catch(()=>{});}}
    if(failed&&model&&journal?.applicationId) {
      try {
        const current=(await model.applicationsState()).applications.find(item=>item.id===journal.applicationId);
        if(journal.passes.some(pass=>pass.requestId===current?.current?.id)&&
          (current.current.active||current.current.state&&await managedCommandAlive(current.current.state))) {
          const operationId=current.current.id;
          await model.applicationsStop({applicationId:journal.applicationId,operationId});
          await until(async()=>{
            const value=(await model.applicationsState()).applications.find(item=>item.id===journal.applicationId);
            return {value,alive:value?.current?.state?await managedCommandAlive(value.current.state):false};
          },value=>value.value?.current?.id===operationId&&!value.alive&&!value.value.current.active,
          {timeoutMs:30000,label:'ORIGINAL_ERROR_STOP'});
        }
      }catch(error){
        if(journal){journal.cleanupIssue={code:error.code??'BUYER_RECEIVING_STOP_INCOMPLETE',at:new Date().toISOString()};
          await saveJSON(receiptPath,journal,true).catch(()=>{});}
      }
    }
    try{await model?.close();}
    finally{try{await fixture?.close();}finally{await lease.close();}}
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  need(process.argv[2],'BUYER_RECEIVING_CONFIGURATION_REQUIRED');
  const config=JSON.parse(await readFile(absolute(resolve(process.argv[2])),'utf8'));
  const result=await receiveBuyerManagedApplication(config,{
    onProgress:value=>process.stdout.write(JSON.stringify(value)+'\n')});
  process.stdout.write(JSON.stringify({status:'COMPLETED',operation:OPERATION,applicationId:result.applicationId,
    sourceCommit:result.selection.sourceCommit,sourceManifestSha256:result.selection.sourceManifestSha256,
    sdk:result.sdk,paidFile:result.paidFile,
    buyerRunId:result.buyerRunId,nativeIntentId:result.fixture.intentId,
    reservation:result.originalResult.summary.operatorReservation,
    originalBuyerStatus:result.originalResult.summary.status,
    customer:{bytes:result.originalResult.customerBytes,sha256:result.originalResult.customerSha256},
    operations:result.passes.map(pass=>({requestId:pass.requestId,instanceId:pass.observed.instanceId,
      opened:pass.observed.at,stopped:pass.stoppedAt})),
    receiptPath:join(config.receptionDirectory,'buyer-managed-reception.json')})+'\n');
}
