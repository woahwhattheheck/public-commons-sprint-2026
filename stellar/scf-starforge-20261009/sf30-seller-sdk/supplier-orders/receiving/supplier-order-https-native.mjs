#!/usr/bin/env node
// MIT. One complete local HTTPS supplier receiving operation over original publisher XML.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open,readFile,mkdir,lstat,chmod,link,unlink,rename,readdir } from 'node:fs/promises';
import { createServer,request as httpsRequest } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve,join,dirname,basename } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash,randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { openSupplierOrderWorkspace } from '../workspace.mjs';
import { serveSupplierOrderWorkspace } from '../server.mjs';
import { serveSupplierOrderHttpsIntake } from '../https-intake.mjs';
import { parseOpenTransDocument } from '../opentrans.mjs';
import { canonical,digest } from '../core.mjs';
import { MerchantSupplierOrders } from '../../../../../stellar-forge/mcp-merchant-operator/supplier-orders.mjs';
import { createSupplierOrderClient } from '../../../../../stellar-forge/mcp-merchant-operator/supplier-order-client.mjs';

export const SUPPLIER_ORDER_HTTPS_RECEIVING_SCHEMA='stellar-forge.supplier-order-https-native.v1';
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const copy=value=>JSON.parse(JSON.stringify(value));
async function directory(path){await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);assert.ok(s.isDirectory()&&!s.isSymbolicLink());await chmod(path,0o700);}
async function syncDirectory(path){const h=await open(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await h.sync();}finally{await h.close();}}
async function bytes(path,maximum=64*1024*1024){
  const h=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const a=await h.stat();assert.ok(a.isFile()&&a.size<=maximum);const b=await h.readFile(),z=await h.stat();assert.equal(b.length,a.size);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(a[key],z[key]);return b;}finally{await h.close();}
}
async function maybe(path){try{return JSON.parse((await bytes(path)).toString('utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function original(path,body){
  await directory(dirname(path));const expected={path,bytes:body.length,sha256:sha(body)};
  try{const present=await bytes(path);assert.equal(sha(present),expected.sha256);assert.equal(present.length,body.length);return expected;}catch(e){if(e.code!=='ENOENT')throw e;}
  const temporary=path+'.'+randomUUID()+'.part',h=await open(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await h.writeFile(body);await h.sync();}finally{await h.close();}
  try{try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;const present=await bytes(path);assert.equal(sha(present),expected.sha256);}await syncDirectory(dirname(path));return expected;}
  finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
async function native(command,args){
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe']});const output=[],errors=[];let length=0,fault,kill;
  const stop=e=>{fault??=e;child.kill('SIGTERM');kill??=setTimeout(()=>child.kill('SIGKILL'),1000);};
  const timer=setTimeout(()=>stop(new Error('Native helper timeout.')),60000);
  child.on('error',e=>{fault??=e;});child.stdout.on('data',x=>{length+=x.length;if(length>1048576)stop(new Error('Native helper output bound.'));else output.push(x);});child.stderr.on('data',x=>{if(errors.reduce((n,b)=>n+b.length,0)<1048576)errors.push(x);});
  const code=await new Promise(r=>child.once('close',r));clearTimeout(timer);if(kill)clearTimeout(kill);
  if(fault)throw fault;assert.equal(code,0,Buffer.concat(errors).toString('utf8'));return Buffer.concat(output);
}
async function port(){const s=createTcpServer();await new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',r);});const p=s.address().port;await new Promise((r,j)=>s.close(e=>e?j(e):r()));return p;}
async function post(url,ca,body,headers={}){
  return new Promise((resolveResult,reject)=>{
    const response=[],r=httpsRequest(url,{method:'POST',ca,agent:false,headers:{'Content-Type':'application/xml','Content-Length':body.length,'Connection':'close',...headers}},res=>{
      res.on('data',b=>response.push(b));res.once('error',reject);res.once('end',()=>resolveResult({statusCode:res.statusCode,headers:res.headers,body:Buffer.concat(response)}));
    });r.setTimeout(150000,()=>r.destroy(new Error('Original intake timeout.')));r.once('error',reject);r.end(body);
  });
}
async function localPeer({path,cert,key,port:listenPort,token}){
  await directory(path);const sockets=new Set(),active=new Set();let stopping=false;
  const server=createServer({cert,key},(req,res)=>{
    if(stopping){req.destroy();res.destroy();return;}
    req.setTimeout(30000,()=>req.destroy(new Error('The original local peer body stalled.')));
    const task=(async()=>{
      assert.equal(req.headers.authorization,'Bearer '+token);assert.equal(req.method,'POST');
      const parts=[];let count=0;for await(const part of req){count+=part.length;assert.ok(count<=64*1024*1024);parts.push(part);}assert.ok(req.complete);
      const body=Buffer.concat(parts),kind=({'/confirmation':'ORDERRESPONSE','/dispatch':'DISPATCHNOTIFICATION','/invoice':'INVOICE'})[req.url];assert.ok(kind);
      const previous=(await readdir(path)).filter(name=>name.startsWith(kind+'-')&&name.endsWith('.json')).length,attempt=previous+1;
      const file=await original(join(path,sha(body)+'.xml'),body);
      const accepted=kind!=='DISPATCHNOTIFICATION'||attempt>1,reference='local-provider-'+kind+'-'+attempt;
      await original(join(path,kind+'-'+attempt+'.json'),json({kind,attempt,accepted,reference,file,receivedAt:new Date().toISOString()}));
      // Actual complete bytes were accepted by this local provider; the reply is lost.
      if(kind==='ORDERRESPONSE'){req.socket.destroy();return;}
      const answer=json({accepted,reference,sourceSha256:file.sha256});
      res.writeHead(accepted?200:422,{'Content-Type':'application/json','Content-Length':answer.length,'X-Provider-Receipt':reference,'Connection':'close'});res.end(answer);
    })();active.add(task);void task.catch(e=>res.destroy(e)).finally(()=>active.delete(task));
  });server.on('connection',s=>{sockets.add(s);s.once('close',()=>sockets.delete(s));});
  await new Promise((r,j)=>{server.once('error',j);server.listen(listenPort,'127.0.0.1',r);});
  return{server,async close(){stopping=true;const stopped=new Promise((r,j)=>server.close(e=>e&&e.code!=='ERR_SERVER_NOT_RUNNING'?j(e):r()));for(const s of sockets)s.destroy();while(active.size)await Promise.allSettled([...active]);await stopped;}};
}
export async function runSupplierOrderHttpsReceiving({
  directory:runDirectory,producerDirectory,customerDirectory,
  operationId='supplier-order-https-native-2769-20261012',
  sourceIndexPath=fileURLToPath(new URL('../source/opentrans-source.json',import.meta.url)),
  browserModule,browserExecutable,baselineReportPath,operatorReportPath,onProgress=()=>{}
}={}){
  for(const value of [runDirectory,producerDirectory,customerDirectory,operationId])assert.ok(typeof value==='string'&&value);
  const root=resolve(runDirectory),producerPath=resolve(producerDirectory),customerPath=resolve(customerDirectory);
  assert.equal(new Set([root,producerPath,customerPath]).size,3);await directory(root);
  const lease=await acquireStateLease(root);
  let producer,customer,intake,desk,peer,merchant,browser,browserServer,context,closed=false;
  const previousEnv={in:process.env.SUPPLIER_NATIVE_HTTPS_IN,out:process.env.SUPPLIER_NATIVE_HTTPS_OUT};
  const invocations=[],artifacts=[],phases=[];
  const id=name=>'https-'+digest([operationId,name]).slice(0,48);
  const remember=file=>{if(!artifacts.some(a=>a.path===file.path))artifacts.push(file);return file;};
  async function valueFile(name,make){
    const path=join(root,name+'.json'),saved=await maybe(path);
    if(saved){const retained=await bytes(path);remember({path,bytes:retained.length,sha256:sha(retained)});return saved;}const value=await make();remember(await original(path,json(value)));return value;
  }
  async function phase(name,run){
    const path=join(root,'phases',name+'.json'),saved=await maybe(path);
    if(saved){
      for(const file of saved.artifacts??[]){const body=await bytes(file.path,256*1024*1024);assert.equal(body.length,file.bytes);assert.equal(sha(body),file.sha256);remember(file);}
      for(const row of saved.invocations??[]){const op=producer?producer.operation({requestId:row.requestId}):await client.operation({requestId:row.requestId});assert.equal(op.state,row.state);assert.equal(digest(op.result),row.resultSha256);invocations.push(row);}
      const retained=await bytes(path);remember({path,bytes:retained.length,sha256:sha(retained)});
      phases.push(saved);onProgress({phase:name,state:'REOPENED'});return saved.value;
    }
    const firstInvocation=invocations.length,firstArtifact=artifacts.length;
    onProgress({phase:name,state:'RUNNING'});const value=await run(),result={name,value,invocations:invocations.slice(firstInvocation),artifacts:artifacts.slice(firstArtifact)};
    remember(await original(path,json(result)));phases.push(result);onProgress({phase:name,state:'COMPLETE'});return value;
  }
  let client;
  async function call(name,method,build){
    const request=await valueFile('requests/'+name,async()=>({...await build(),requestId:id(name)}));
    const result=await client[method](copy(request));assert.equal(result.id,request.requestId);assert.equal(result.state,'COMPLETE',JSON.stringify(result.error));
    invocations.push({name,method,requestId:result.id,state:result.state,resultSha256:digest(result.result)});return result;
  }
  async function nativeDraft(name,kind,documentId){
    const saved=await call(name+'-save','saveDraft',async()=>{
      const seed=await client.newDraft({kind,orderIds:[source.orderId]});
      if(documentId)seed.document.documentId=documentId;
      if(prerequisites&&kind!=='ORDERRESPONSE'&&!seed.document.items.length){
        const current=await client.order({orderId:source.orderId}),selected=current.selectedDocuments.filter(item=>item.kind===kind).at(-1);
        assert.ok(selected,'The completed original snapshots must retain their selected '+kind+'.');
        const native=await client.document({id:selected.id}),date=seed.document.header.date;
        seed.document=copy(native.document);seed.document.header.date=date;
        // This is a reviewed new revision of the same business document. Its original
        // quantity replaces that document's selected contribution, not another shipment.
      }
      seed.document.header.remarks??=[];seed.document.header.remarks.push({type:null,text:'Local HTTPS receiving '+operationId+' '+name,sourcePath:null});
      return{kind,orderIds:seed.orderIds,document:seed.document,sourceOrderDocuments:seed.sourceOrderDocuments,title:'HTTPS receiving '+name,reason:'Retain the actual original publisher order through '+kind+'.',expectedOrderRevisions:seed.orderRevisions,expectedOrderStateSha256:seed.orderStateSha256,roundingPolicy:{scale:2,mode:'half-up',taxBasis:'line'}};
    });
    assert.equal(saved.result.draft.review.errors,0);
    const prepared=await call(name+'-xml','prepare',()=>({draftId:saved.result.draftId,expectedRevision:saved.result.revision}));
    await call(name+'-select','select',()=>({id:prepared.result.documentId,orderId:source.orderId,expectedOrderRevision:saved.result.draft.orderRevisions[source.orderId],reason:'Select this actual prepared native '+kind+' before transport.'}));
    return prepared.result.document;
  }
  async function intent(name,document){
    const result=await call(name+'-intent','prepareTransmission',async()=>({documentId:document.id,expectedDocumentSha256:document.sha256,channelId:'native-local',expectedChannelSha256:(await client.transportChannels()).channels[0].sha256,reason:'Deliver this exact reviewed original XML to the owned local TLS receiving peer.'}));
    return result.result.transmissionId;
  }
  async function change(name,method,transmissionId,fields={}){
    return call(name,method,async()=>({transmissionId,expectedRevision:(await client.transmission({transmissionId})).revision,...fields}));
  }
  let source,config,started,prerequisites=null;
  try{
    for(const name of ['requests','phases','peer','downloads','certificates'])await directory(join(root,name));
    const indexBytes=await bytes(sourceIndexPath),index=JSON.parse(indexBytes),entry=index.files.find(f=>f.role==='example'&&f.path.endsWith('/openTRANS_ORDER_1_0_example.xml'));
    assert.ok(entry);const originalXml=await bytes(join(dirname(sourceIndexPath),entry.path));assert.equal(originalXml.length,entry.bytes);assert.equal(sha(originalXml),entry.sha256);
    const document=await parseOpenTransDocument(originalXml,{name:basename(entry.path),provenance:{url:index.source.url,archiveSha256:index.source.sha256,member:entry.path}});
    source={orderId:document.orderId,supplierId:document.header.supplierId,bytes:originalXml.length,sha256:sha(originalXml),archiveSha256:index.source.sha256};
    if(baselineReportPath||operatorReportPath){
      assert.ok(baselineReportPath&&operatorReportPath,'Select both completed original installed baseline and operator reports.');
      const baselineBytes=await bytes(resolve(baselineReportPath)),operatorBytes=await bytes(resolve(operatorReportPath)),baseline=JSON.parse(baselineBytes),operator=JSON.parse(operatorBytes);
      for(const report of [baseline,operator]){assert.equal(report.status,'PASS');assert.equal(report.lifetimes,'CLOSED');}
      assert.equal(baseline.operationId,'SCF-SUPPLIER-ORDERS-2769-20261012');
      assert.equal(operator.operationId,'supplier-orders-operator-2769-20261012');assert.equal(operator.calledTools.length,27);
      for(const file of [...baseline.artifactFiles,...operator.artifacts]){const body=await bytes(file.path,256*1024*1024);assert.equal(body.length,file.bytes);assert.equal(sha(body),file.sha256);}
      prerequisites={baseline:{path:resolve(baselineReportPath),bytes:baselineBytes.length,sha256:sha(baselineBytes),operationId:baseline.operationId},
        operator:{path:resolve(operatorReportPath),bytes:operatorBytes.length,sha256:sha(operatorBytes),operationId:operator.operationId},
        producerPackage:copy(operator.deliveries.producer),customerPackage:copy(operator.deliveries.handover)};
      for(const file of [prerequisites.producerPackage,prerequisites.customerPackage]){const body=await bytes(file.path,256*1024*1024);assert.equal(body.length,file.bytes);assert.equal(sha(body),file.sha256);}
      for(const record of Object.values(baseline.workspaces).concat(Object.values(operator.workspaces)))
        assert.ok(![producerPath,customerPath].includes(resolve(record.directory)),'Keep completed original workspaces separate from their following received copies.');
    }
    started=await valueFile('operation',()=>({schema:SUPPLIER_ORDER_HTTPS_RECEIVING_SCHEMA,operationId,producerDirectory:producerPath,customerDirectory:customerPath,source,prerequisites,startedAt:new Date().toISOString()}));
    assert.equal(started.operationId,operationId);assert.deepEqual(started.source,source);assert.deepEqual(started.prerequisites??null,prerequisites);assert.equal(started.producerDirectory,producerPath);assert.equal(started.customerDirectory,customerPath);
    const certPath=join(root,'certificates','localhost.pem'),keyPath=join(root,'certificates','localhost-key.pem');
    const priorConfig=await maybe(join(root,'channels.json'));
    if(!priorConfig){
      try{await bytes(certPath);await bytes(keyPath);}catch(e){
        if(e.code!=='ENOENT')throw e;
        await native('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','365','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath]);await chmod(keyPath,0o600);
      }
    }
    const cert=await bytes(certPath),key=await bytes(keyPath),ports=await valueFile('ports',async()=>{const intake=await port();let peer=await port();while(peer===intake)peer=await port();return{intake,peer};});
    const inToken='local-intake-'+digest(operationId),outToken='local-peer-'+digest(operationId);
    process.env.SUPPLIER_NATIVE_HTTPS_IN=inToken;process.env.SUPPLIER_NATIVE_HTTPS_OUT=outToken;
    config=await valueFile('channels',()=>({schema:'stellar-forge.supplier-order-https-config.v1',channels:[{id:'native-local',title:'Owned local HTTPS native receiving',mode:'test',supplierId:source.supplierId,agreement:{reference:'Local source-native receiving '+operationId},
      incoming:{url:'https://127.0.0.1:'+ports.intake+'/order',auth:{type:'bearer',tokenEnv:'SUPPLIER_NATIVE_HTTPS_IN'},messageIdHeader:'x-original-message',acknowledgment:{statusCode:200,contentType:'text/plain',body:'LOCAL-RETAINED'}},
      outgoing:{endpoints:{ORDERRESPONSE:'https://127.0.0.1:'+ports.peer+'/confirmation',DISPATCHNOTIFICATION:'https://127.0.0.1:'+ports.peer+'/dispatch',INVOICE:'https://127.0.0.1:'+ports.peer+'/invoice'},auth:{type:'bearer',tokenEnv:'SUPPLIER_NATIVE_HTTPS_OUT'},acknowledgment:{acceptedStatusCodes:[200],rejectedStatusCodes:[422],receiptHeader:'x-provider-receipt'},timeoutMs:10000,maxResponseBytes:1048576,tls:{caFile:certPath}}
      }],intake:{host:'127.0.0.1',port:ports.intake,certFile:certPath,keyFile:keyPath}}));
    const configPath=join(root,'channels.json');
    producer=await openSupplierOrderWorkspace({directory:producerPath,transportConfigPath:configPath});
    customer=await openSupplierOrderWorkspace({directory:customerPath});
    const previous=await maybe(join(root,'report.json'));
    if(previous){
      assert.equal(previous.status,'PASS');assert.equal(previous.lifetimes,'CLOSED');assert.deepEqual(previous.source,source);
      for(const file of previous.artifacts){const body=await bytes(file.path,256*1024*1024);assert.equal(body.length,file.bytes);assert.equal(sha(body),file.sha256);}
      for(const row of previous.transmissions){assert.equal(producer.transport.get({transmissionId:row.id}).sha256,row.sha256);assert.equal(customer.transport.get({transmissionId:row.id}).sha256,row.sha256);}
      const retainedLocal=customer.operation({requestId:id('customer-local-review')});assert.equal(retainedLocal.state,'COMPLETE');assert.equal(retainedLocal.result.draftId,previous.exported.localDraftId);assert.equal(customer.draft({draftId:previous.exported.localDraftId}).sha256,previous.exported.localDraftSha256);
      await customer.close();customer=null;await producer.close();producer=null;closed=true;return{...previous,reused:true};
    }
    if(prerequisites)await phase('00-complete-installed-snapshot-receiving',async()=>{
      for(const [role,workspace,file] of [['producer',producer,prerequisites.producerPackage],['customer',customer,prerequisites.customerPackage]]){
        const received=await workspace.importWorkspace({requestId:id('installed-'+role+'-snapshot'),path:file.path,expectedBytes:file.bytes,expectedSha256:file.sha256});
        assert.equal(received.state,'COMPLETE',JSON.stringify(received.error));assert.ok(workspace.order({orderId:source.orderId}).items.length);
      }
      return prerequisites;
    });
    await customer.close();customer=null;
    intake=await serveSupplierOrderHttpsIntake({workspace:producer});
    await phase('01-authenticated-original-order',async()=>{
      const endpoint=config.channels[0].incoming.url,headers={Authorization:'Bearer '+inToken,'X-Original-Message':id('publisher-order')};
      const refused=await post(endpoint,cert,originalXml,{'X-Original-Message':id('unauthenticated')});assert.equal(refused.statusCode,401);
      const countBefore=producer.documents({kind:'ORDER'}).total;
      const accepted=await post(endpoint,cert,originalXml,headers);assert.equal(accepted.statusCode,200);assert.equal(accepted.body.toString(),'LOCAL-RETAINED');
      const repeated=await post(endpoint,cert,originalXml,headers);assert.equal(repeated.headers['x-supplier-order-transmission-id'],accepted.headers['x-supplier-order-transmission-id']);
      const selected=producer.transport.get({transmissionId:accepted.headers['x-supplier-order-transmission-id']});assert.equal(selected.state,'RECEIVED');assert.equal(selected.source.sha256,source.sha256);
      assert.equal(producer.documents({kind:'ORDER'}).total,prerequisites?countBefore:1);return{transmissionId:selected.id,source:selected.source,recipientProcessing:selected.recipientProcessing};
    });
    await intake.close();intake=null;await producer.close();producer=null;
    peer=await localPeer({path:join(root,'peer'),cert,key,port:ports.peer,token:outToken});
    merchant=new MerchantSupplierOrders({supplierOrderWorkspaces:{workspaces:{transport:{label:'Original HTTPS supplier receiving',directory:producerPath,inputs:{},transportConfigPath:configPath}}}});
    client=await createSupplierOrderClient({workspace:'transport',client:{endpoint:'native-supplier-https:'+operationId,call:(name,args)=>merchant.call(name,args)}});
    await client.open();
    const confirmation=await phase('02-confirmation-lost-reply',async()=>{
      const doc=await nativeDraft('confirmation','ORDERRESPONSE'),transmissionId=await intent('confirmation',doc);
      const sent=await change('confirmation-send','sendTransmission',transmissionId);assert.equal(sent.result.transmission.state,'UNKNOWN');
      const actual=await maybe(join(root,'peer','ORDERRESPONSE-1.json'));assert.equal(actual.accepted,true);assert.equal(actual.file.sha256,doc.source.sha256);
      await change('confirmation-resolve','resolveTransmission',transmissionId,{outcome:'ACKNOWLEDGED',providerReference:actual.reference,reason:'Read the actual complete original file receipt from the owned local TLS peer after its reply was lost.'});
      const originalRequest=await maybe(join(root,'requests','confirmation-send.json'));await client.sendTransmission(originalRequest);
      assert.equal((await readdir(join(root,'peer'))).filter(x=>/^ORDERRESPONSE-\d+\.json$/.test(x)).length,1);
      return{documentId:doc.id,transmissionId,provider:actual};
    });
    const dispatch=await phase('03-dispatch-rejection-and-deliberate-retry',async()=>{
      const doc=await nativeDraft('dispatch','DISPATCHNOTIFICATION','HTTPS-DISPATCH-2769'),transmissionId=await intent('dispatch',doc);
      const first=await change('dispatch-send-first','sendTransmission',transmissionId);assert.equal(first.result.transmission.state,'REJECTED');
      await change('dispatch-retry','retryTransmission',transmissionId,{reason:'The actual local provider returned the configured definite non-acceptance; deliberately resend the same original bytes.'});
      const second=await change('dispatch-send-second','sendTransmission',transmissionId);assert.equal(second.result.transmission.state,'ACKNOWLEDGED');
      assert.equal(second.result.transmission.attemptCount,2);
      return{documentId:doc.id,transmissionId,response:second.result.transmission.http.response};
    });
    const invoice=await phase('04-invoice-cancel-reopen-and-send',async()=>{
      const doc=await nativeDraft('invoice','INVOICE','HTTPS-INVOICE-2769'),transmissionId=await intent('invoice',doc);
      await change('invoice-cancel','cancelTransmission',transmissionId,{reason:'Pause the original unsent invoice intent while reading its complete source.'});
      await change('invoice-retry','retryTransmission',transmissionId,{reason:'Complete the deliberate operator review and reopen the same cancelled original intent.'});
      const sent=await change('invoice-send','sendTransmission',transmissionId);assert.equal(sent.result.transmission.state,'ACKNOWLEDGED');assert.equal(sent.result.transmission.recipientProcessing,'NOT_REPORTED');
      const download=await client.downloadExport({exportId:sent.result.transmission.http.response.fileId,directory:join(root,'downloads','invoice-response'),chunkSize:512});
      return{documentId:doc.id,transmissionId,response:sent.result.transmission.http.response,download};
    });
    await phase('05-typed-pages-and-complete-history',async()=>{
      const rows=[];for await(const page of client.pages('transmissions',{limit:1}))rows.push(...page.items);
      assert.equal(rows.length,4);
      const history=[];for await(const page of client.pages('transmissionHistory',{transmissionId:dispatch.transmissionId,limit:1}))history.push(...page.items);
      assert.ok(history.some(x=>x.action==='retry-prepared'));return{transmissionIds:rows.map(x=>x.id),dispatchRevisions:history.map(x=>x.revision)};
    });
    await client.close();await merchant.close();merchant=null;
    producer=await openSupplierOrderWorkspace({directory:producerPath,transportConfigPath:configPath});
    desk=await serveSupplierOrderWorkspace({workspace:producer});
    await phase('06-private-browser-and-complete-response',async()=>{
      assert.ok(browserModule,'Supply the already installed Playwright module for the actual browser continuation.');
      const module=browserModule.endsWith('.mjs')?await import(pathToFileURL(resolve(browserModule)).href):createRequire(import.meta.url)(browserModule),chromium=module.chromium??module.default?.chromium;assert.ok(chromium);
      browserServer=await chromium.launchServer({headless:true,...(browserExecutable?{executablePath:browserExecutable}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
      browser=await chromium.connect(browserServer.wsEndpoint());
      context=await browser.newContext({acceptDownloads:true});await context.addInitScript(()=>{Object.defineProperty(window,'showSaveFilePicker',{value:undefined,configurable:true});});const page=await context.newPage(),faults=[];
      page.on('pageerror',error=>faults.push(error.message));await page.goto(desk.url,{waitUntil:'networkidle'});
      await page.locator('#open-transport').click();await page.locator('#transport-dialog').waitFor();
      await page.waitForFunction(()=>document.querySelector('#transport-table tbody')?.textContent.includes('Invoice'));
      const row=page.locator('#transport-table tbody tr').filter({hasText:'Invoice'});await row.getByRole('button',{name:'Open',exact:true}).click();
      await page.waitForFunction(id=>document.querySelector('#transport-detail')?.textContent.includes(id),invoice.transmissionId);
      assert.equal(faults.length,0,faults.join('\n'));
      const content=await page.locator('#transport-detail').innerText();assert.ok(content.includes('HTTPS acknowledged'));assert.ok(content.includes('Awaiting recipient report'));
      const [download]=await Promise.all([page.waitForEvent('download'),Promise.resolve().then(()=>page.getByRole('button',{name:'Download HTTPS response',exact:true}).click())]);
      const downloaded=await bytes(await download.path());assert.equal(downloaded.length,invoice.response.bytes);assert.equal(sha(downloaded),invoice.response.sha256);remember(await original(join(root,'downloads','browser-https-response.bin'),downloaded));
      const screenshot=join(root,'supplier-https-desk.png');let image;
      try{image=await bytes(screenshot);}catch(error){if(error.code!=='ENOENT')throw error;image=await page.screenshot({fullPage:true});}
      remember(await original(screenshot,image));
      await context.close();context=null;await browser.close();browser=null;await browserServer.close();browserServer=null;
      return{url:desk.origin,documentId:invoice.documentId,transmissionId:invoice.transmissionId,pageErrors:faults,screenshot};
    });
    await desk.close();desk=null;
    const exported=await phase('07-complete-portable-customer-receiving',async()=>{
      const exportId=id('full-handover'),saved=await producer.exportWorkspace({requestId:exportId,path:join(root,'supplier-https-workspace.zip')});assert.equal(saved.state,'COMPLETE',JSON.stringify(saved.error));
      const file=await producer.file({id:saved.result.file.id});remember({path:file.path,bytes:file.bytes,sha256:file.sha256});remember({path:join(root,'supplier-https-workspace.zip'),bytes:file.bytes,sha256:file.sha256});
      customer=await openSupplierOrderWorkspace({directory:customerPath});
      const received=await customer.importWorkspace({requestId:id('customer-receive'),path:file.path,expectedBytes:file.bytes,expectedSha256:file.sha256});assert.equal(received.state,'COMPLETE',JSON.stringify(received.error));
      for(const sourceRow of producer.transport.list({}).items){const retained=customer.transport.get({transmissionId:sourceRow.id});assert.equal(retained.sha256,sourceRow.sha256);assert.equal(retained.foreign,true);}
      await assert.rejects(customer.transport.send({requestId:id('foreign-send-denied'),transmissionId:invoice.transmissionId,expectedRevision:customer.transport.get({transmissionId:invoice.transmissionId}).revision}),{code:'ORDER_TRANSMISSION_FOREIGN'});
      const localRequest=await valueFile('requests/customer-local-review',()=>{const seed=customer.newDraft({kind:'ORDERRESPONSE',orderIds:[source.orderId]});return{requestId:id('customer-local-review'),kind:seed.kind,orderIds:seed.orderIds,document:seed.document,expectedOrderRevisions:seed.orderRevisions,expectedOrderStateSha256:seed.orderStateSha256,reason:'The customer retains a local review after receiving complete original transport history.'};});
      const local=customer.saveDraft(copy(localRequest));assert.equal(local.state,'COMPLETE',JSON.stringify(local.error));assert.equal(local.id,localRequest.requestId);
      const before=customer.draft({draftId:local.result.draftId}).sha256;
      await customer.importWorkspace({requestId:id('customer-receive-older-again'),path:file.path,expectedBytes:file.bytes,expectedSha256:file.sha256});
      assert.equal(customer.draft({draftId:local.result.draftId}).sha256,before);
      return{exportRequestId:exportId,file:{id:file.id,bytes:file.bytes,sha256:file.sha256},customerWorkspaceId:customer.store.id,localDraftId:local.result.draftId,localDraftSha256:before};
    });
    if(!customer)customer=await openSupplierOrderWorkspace({directory:customerPath});
    const retainedLocal=customer.operation({requestId:id('customer-local-review')});assert.equal(retainedLocal.state,'COMPLETE');assert.equal(retainedLocal.result.draftId,exported.localDraftId);assert.equal(customer.draft({draftId:exported.localDraftId}).sha256,exported.localDraftSha256);
    const transmissions=producer.transport.list({}).items.map(({id,sha256,state,direction})=>({id,sha256,state,direction}));
    for(const row of transmissions)assert.equal(customer.transport.get({transmissionId:row.id}).sha256,row.sha256);
    const report={schema:SUPPLIER_ORDER_HTTPS_RECEIVING_SCHEMA,operationId,status:'PASS',lifetimes:'CLOSED',source,
      startedAt:started.startedAt,completedAt:new Date().toISOString(),producerWorkspaceId:producer.store.id,customerWorkspaceId:customer.store.id,
      phases,invocations,transmissions,artifacts,exported,prerequisites,livePartnerTransmission:false};
    await customer.close();customer=null;await producer.close();producer=null;await peer.close();peer=null;closed=true;
    await original(join(root,'report.json'),json(report));return report;
  }finally{
    const errors=[];
    for(const close of [()=>context?.close(),()=>browser?.close(),()=>browserServer?.close(),()=>desk?.close(),()=>intake?.close(),()=>merchant?.close(),()=>customer?.close(),()=>producer?.close(),()=>peer?.close()])try{await close();}catch(e){errors.push(e);}
    if(previousEnv.in===undefined)delete process.env.SUPPLIER_NATIVE_HTTPS_IN;else process.env.SUPPLIER_NATIVE_HTTPS_IN=previousEnv.in;
    if(previousEnv.out===undefined)delete process.env.SUPPLIER_NATIVE_HTTPS_OUT;else process.env.SUPPLIER_NATIVE_HTTPS_OUT=previousEnv.out;
    if(!errors.length)await lease.close();
    if(errors.length)throw new AggregateError(errors,'The original HTTPS receiving lifetime remains owned until its close succeeds.');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),selected={};
  for(let i=0;i<args.length;i+=2){assert.ok(args[i].startsWith('--')&&args[i+1]);selected[args[i].slice(2)]=args[i+1];}
  runSupplierOrderHttpsReceiving({directory:selected.directory,producerDirectory:selected.producer,customerDirectory:selected.customer,operationId:selected.operation,browserModule:selected['browser-module'],browserExecutable:selected['browser-executable'],sourceIndexPath:selected.source,baselineReportPath:selected['baseline-report'],operatorReportPath:selected['operator-report'],onProgress:value=>process.stderr.write(JSON.stringify(value)+'\n')}).then(value=>process.stdout.write(JSON.stringify(value)+'\n'),error=>{process.stderr.write(JSON.stringify({error:{code:error.code,message:error.message,stack:error.stack}})+'\n');process.exitCode=1;});
}
