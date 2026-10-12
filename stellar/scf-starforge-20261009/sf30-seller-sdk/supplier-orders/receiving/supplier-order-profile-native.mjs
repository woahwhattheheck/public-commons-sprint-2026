#!/usr/bin/env node
// MIT. Complete declared-profile receiving on the retained openTRANS 1.0 XML and DTDs.
import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import { open,mkdir,lstat,chmod,link,unlink,readdir } from 'node:fs/promises';
import { createServer,request as httpsRequest } from 'node:https';
import { createServer as createTcpServer } from 'node:net';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolve,join,dirname,basename,relative,isAbsolute,sep } from 'node:path';
import { fileURLToPath,pathToFileURL } from 'node:url';
import { createHash,randomUUID } from 'node:crypto';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { openSupplierOrderWorkspace } from '../workspace.mjs';
import { serveSupplierOrderWorkspace } from '../server.mjs';
import { serveSupplierOrderHttpsIntake } from '../https-intake.mjs';
import { parseOpenTransDocument } from '../opentrans.mjs';
import { canonical,digest } from '../core.mjs';
import { normalizeSupplierOrderProfile,supplierOrderProfileSha256,defaultSupplierOrderProfile } from '../profiles.mjs';
import { MerchantSupplierOrders } from '../../../../../stellar-forge/mcp-merchant-operator/supplier-orders.mjs';
import { createSupplierOrderClient } from '../../../../../stellar-forge/mcp-merchant-operator/supplier-order-client.mjs';
import { supplierOrderTools } from '../../../../../stellar-forge/mcp-merchant-operator/catalog/supplier-orders.mjs';

export const SUPPLIER_ORDER_PROFILE_RECEIVING_SCHEMA='stellar-forge.supplier-order-profile-native.v1';
export const SUPPLIER_ORDER_PROFILE_RECEIVING_OPERATION='supplier-order-profile-native-2769-20261012';
const DEMONSTRATION_SHA='425a558c0e16ffa1e04979287abf92db9f710c5eb2d4e801a56d5108356bf09c';
const KINDS=['ORDER','ORDERRESPONSE','DISPATCHNOTIFICATION','INVOICE'];
const NEW_TOOLS=['profile','profile_template','profile_history','select_profile'].map(x=>'merchant_supplier_order_'+x);
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const copy=value=>JSON.parse(JSON.stringify(value));
const sha=value=>createHash('sha256').update(value).digest('hex');
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const stat=await lstat(path);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'Use an owned directory, not a symlink.');await chmod(path,0o700);
}
async function exactBytes(path,maximum=256*1024*1024){
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{const before=await handle.stat();assert.ok(before.isFile()&&before.size<=maximum);
    const body=await handle.readFile(),after=await handle.stat();assert.equal(body.length,before.size);
    for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(before[key],after[key]);return body;
  }finally{await handle.close();}
}
async function readJson(path){try{return JSON.parse((await exactBytes(path)).toString('utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function originalFile(path,body){
  await privateDirectory(dirname(path));const identity={path:resolve(path),bytes:body.length,sha256:sha(body)};
  try{const prior=await exactBytes(path);assert.equal(prior.length,identity.bytes);assert.equal(sha(prior),identity.sha256);return identity;}catch(error){if(error.code!=='ENOENT')throw error;}
  const part=path+'.'+randomUUID()+'.part',handle=await open(part,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{await handle.writeFile(body);await handle.sync();}finally{await handle.close();}
  try{try{await link(part,path);}catch(error){if(error.code!=='EEXIST')throw error;const prior=await exactBytes(path);assert.equal(prior.length,identity.bytes);assert.equal(sha(prior),identity.sha256);}
    const parent=await open(dirname(path),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);try{await parent.sync();}finally{await parent.close();}return identity;
  }finally{await unlink(part).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function verifyFile(file){
  assert.ok(file&&typeof file.path==='string'&&Number.isSafeInteger(file.bytes)&&/^[a-f0-9]{64}$/.test(file.sha256));
  const body=await exactBytes(file.path);assert.equal(body.length,file.bytes);assert.equal(sha(body),file.sha256);return body;
}
function childPath(root,member){
  assert.ok(typeof member==='string'&&member&&!isAbsolute(member));const path=resolve(root,member),within=relative(root,path);
  assert.ok(within&&within!=='..'&&!within.startsWith('..'+sep)&&!isAbsolute(within));return path;
}
function containsPath(parent,child){const part=relative(parent,child);return part===''||part!=='..'&&!part.startsWith('..'+sep)&&!isAbsolute(part);}
function disjoint(left,right){return !containsPath(left,right)&&!containsPath(right,left);}
async function nativeJson(command,args){
  const child=spawn(command,args,{stdio:['ignore','pipe','pipe'],shell:false}),stdout=[],stderr=[];
  let size=0,errorSize=0,fault=null,killTimer=null;
  const stop=error=>{fault??=error;if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');killTimer??=setTimeout(()=>child.kill('SIGKILL'),1000);}};
  const timer=setTimeout(()=>stop(new Error('The selected native helper did not complete in 120 seconds.')),120000);
  child.on('error',error=>{fault??=error;});child.stdout.on('data',part=>{size+=part.length;if(size>16*1024*1024)stop(new Error('Native JSON exceeds its complete receiving limit.'));else stdout.push(part);});
  child.stderr.on('data',part=>{if(errorSize<65536){const piece=part.subarray(0,65536-errorSize);stderr.push(piece);errorSize+=piece.length;}});
  const code=await new Promise(done=>child.once('close',done));clearTimeout(timer);if(killTimer)clearTimeout(killTimer);
  if(fault)throw fault;assert.equal(code,0,Buffer.concat(stderr).toString('utf8'));
  const body=Buffer.concat(stdout);return body.length?JSON.parse(body.toString('utf8')):null;
}
async function availablePort(){const server=createTcpServer();await new Promise((done,fail)=>{server.once('error',fail);server.listen(0,'127.0.0.1',done);});
  const port=server.address().port;await new Promise((done,fail)=>server.close(error=>error?fail(error):done()));return port;}
async function postOrder(url,ca,body,token,messageId){
  return new Promise((done,fail)=>{const received=[],request=httpsRequest(url,{method:'POST',ca,agent:false,
    headers:{'Content-Type':'application/xml','Content-Length':body.length,'Authorization':'Bearer '+token,'X-Original-Message':messageId,'Connection':'close'}},response=>{
      response.on('data',part=>received.push(part));response.once('error',fail);response.once('end',()=>done({statusCode:response.statusCode,headers:response.headers,body:Buffer.concat(received)}));
    });request.setTimeout(150000,()=>request.destroy(new Error('Original HTTPS intake did not complete.')));request.once('error',fail);request.end(body);});
}
async function receivingPeer({directory,cert,key,port,token,profile}){
  await privateDirectory(directory);const sockets=new Set(),pending=new Set();let closing=false;
  const server=createServer({cert,key},(request,response)=>{
    if(closing){request.destroy();response.destroy();return;}
    const task=(async()=>{
      assert.equal(request.method,'POST');assert.equal(request.headers.authorization,'Bearer '+token);
      const kind=({'/confirmation':'ORDERRESPONSE','/dispatch':'DISPATCHNOTIFICATION','/invoice':'INVOICE'})[request.url];assert.ok(kind);
      const parts=[];let length=0;for await(const part of request){length+=part.length;assert.ok(length<=64*1024*1024);parts.push(part);}assert.ok(request.complete);
      const body=Buffer.concat(parts),document=await parseOpenTransDocument(body,{name:kind+'.xml',profile});
      assert.equal(document.kind,kind);assert.equal(document.profileSha256,supplierOrderProfileSha256(profile));
      const file=await originalFile(join(directory,sha(body)+'.xml'),body);
      const names=(await readdir(directory)).filter(name=>name.startsWith(kind+'-')&&name.endsWith('.json'));
      const receipt={kind,attempt:names.length+1,reference:'local-profile-'+kind+'-'+sha(body).slice(0,24),file,profileSha256:supplierOrderProfileSha256(profile),receivedAt:new Date().toISOString()};
      await originalFile(join(directory,kind+'-'+receipt.attempt+'.json'),json(receipt));
      const answer=json({accepted:true,reference:receipt.reference,sha256:file.sha256,profileSha256:receipt.profileSha256});
      response.writeHead(200,{'Content-Type':'application/json','Content-Length':answer.length,'X-Provider-Receipt':receipt.reference,'Connection':'close'});response.end(answer);
    })();pending.add(task);void task.catch(error=>response.destroy(error)).finally(()=>pending.delete(task));
  });
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  await new Promise((done,fail)=>{server.once('error',fail);server.listen(port,'127.0.0.1',done);});
  return{async close(){closing=true;const stopped=new Promise((done,fail)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?fail(error):done()));
    for(const socket of sockets)socket.destroy();while(pending.size)await Promise.allSettled([...pending]);await stopped;}};
}
async function priorReports({baselineReportPath,operatorReportPath,httpsReportPath},destinations){
  const entries=[['baseline',baselineReportPath],['operator',operatorReportPath],['https',httpsReportPath]],result={},verified=new Map();
  for(const [kind,path]of entries){
    assert.ok(typeof path==='string'&&path,'Select all three completed original reports before the profile continuation.');
    const body=await exactBytes(resolve(path)),report=JSON.parse(body.toString('utf8'));
    assert.equal(report.status,'PASS');assert.equal(report.lifetimes,'CLOSED');
    if(kind==='baseline')assert.equal(report.operationId,'SCF-SUPPLIER-ORDERS-2769-20261012');
    if(kind==='operator'){assert.equal(report.operationId,'supplier-orders-operator-2769-20261012');assert.equal(report.calledTools.length,27);}
    if(kind==='https')assert.equal(report.schema,'stellar-forge.supplier-order-https-native.v1');
    const identity={path:resolve(path),bytes:body.length,sha256:sha(body),operationId:report.operationId};result[kind]=identity;verified.set(identity.path,identity);
    for(const file of report.artifactFiles??report.artifacts??[]){await verifyFile(file);verified.set(resolve(file.path),copy(file));}
    for(const item of Object.values(report.workspaces??{})){if(item?.directory)for(const destination of destinations)assert.ok(disjoint(resolve(item.directory),destination),'Keep completed original workspaces separate.');}
    if(kind==='https'){
      const operationPath=join(dirname(resolve(path)),'operation.json');assert.ok(verified.has(operationPath),'Retain the original HTTPS operation descriptor with its report.');
      const original=await readJson(operationPath);assert.equal(original.operationId,report.operationId);
      for(const directory of [original.producerDirectory,original.customerDirectory]){assert.ok(typeof directory==='string');for(const destination of destinations)assert.ok(disjoint(resolve(directory),destination),'Keep the completed HTTPS workspaces separate from the following declared profile.');}
    }
  }
  result.files=[...verified.values()];return result;
}

export async function runSupplierOrderProfileReceiving({
  directory,producerDirectory,customerDirectory,operationId=SUPPLIER_ORDER_PROFILE_RECEIVING_OPERATION,
  sourceIndexPath=fileURLToPath(new URL('../source/opentrans-source.json',import.meta.url)),
  profilePath=fileURLToPath(new URL('../examples/customer-profile.json',import.meta.url)),
  baselineReportPath,operatorReportPath,httpsReportPath,browserModule,browserExecutable,onProgress=()=>{}
}={}){
  for(const value of [directory,producerDirectory,customerDirectory,operationId])assert.ok(typeof value==='string'&&value);
  const root=resolve(directory),paths={producer:resolve(producerDirectory),customer:resolve(customerDirectory)};
  const destinations=[root,...Object.values(paths)];assert.equal(new Set(destinations).size,3);
  for(let i=0;i<destinations.length;i++)for(let j=i+1;j<destinations.length;j++)assert.ok(disjoint(destinations[i],destinations[j]),'Select separate run, producer and customer directories.');
  await privateDirectory(root);const lease=await acquireStateLease(root);let leaseClosed=false;
  const artifacts=[],invocations=[],phases=[],usedTools=new Set(),operationNames=new Map();
  const handles={producer:null,customer:null};let merchant=null,client=null,desk=null,intake=null,peer=null,context=null,browser=null,browserServer=null;
  const priorEnvironment={in:process.env.SUPPLIER_PROFILE_NATIVE_IN,out:process.env.SUPPLIER_PROFILE_NATIVE_OUT};
  const id=name=>'profile-'+digest([operationId,name]).slice(0,48);
  const remember=file=>{const previous=artifacts.find(x=>x.path===file.path);if(previous)assert.deepEqual(previous,file);else artifacts.push(file);return file;};
  const retain=async(path,body)=>remember(await originalFile(path,body));
  async function savedValue(name,make){
    const path=childPath(root,name+'.json'),prior=await readJson(path);
    if(prior!==null){const body=await exactBytes(path);remember({path,bytes:body.length,sha256:sha(body)});return prior;}
    const value=await make();await retain(path,json(value));return value;
  }
  function rememberOperation(role,name,result){
    assert.equal(result.id,id(name));assert.equal(result.state,'COMPLETE',JSON.stringify(result.error));
    assert.ok(result.resultSummary!==true,'Read the complete native operation result before retaining this receiving phase.');
    const row={role,name,requestId:result.id,state:result.state,resultSha256:digest(result.result)};
    const key=role+':'+result.id,prior=operationNames.get(key);
    if(prior)assert.deepEqual(prior,row);else{operationNames.set(key,row);invocations.push(row);}return result;
  }
  async function operation(role,name,invoke,make){
    const request=await savedValue('requests/'+name,async()=>({...await make(),requestId:id(name)}));
    return rememberOperation(role,name,await invoke(copy(request)));
  }
  async function stage(name,run){
    const path=join(root,'phases',name+'.json'),saved=await readJson(path);
    if(saved){
      for(const file of saved.artifacts){await verifyFile(file);remember(file);}
      for(const row of saved.invocations){const key=row.role+':'+row.requestId,prior=operationNames.get(key);if(prior)assert.deepEqual(prior,row);else{operationNames.set(key,row);invocations.push(row);}}
      for(const name of saved.calledTools)usedTools.add(name);const body=await exactBytes(path);remember({path,bytes:body.length,sha256:sha(body)});
      phases.push(saved);onProgress({operationId,phase:name,state:'REOPENED'});return saved.value;
    }
    const firstArtifact=artifacts.length,firstInvocation=invocations.length;onProgress({operationId,phase:name,state:'RUNNING'});
    const value=await run(),record={name,value,artifacts:artifacts.slice(firstArtifact),invocations:invocations.slice(firstInvocation),calledTools:[...usedTools].sort()};
    await retain(path,json(record));phases.push(record);onProgress({operationId,phase:name,state:'COMPLETE'});return value;
  }
  async function closeWorkspace(role){if(handles[role]){await handles[role].close();handles[role]=null;}}
  async function openWorkspace(role,configuration){
    assert.equal(handles[role],null);handles[role]=await openSupplierOrderWorkspace({directory:paths[role],...(configuration?{transportConfigPath:configuration}:{})});return handles[role];
  }
  async function startClient(inputs,configuration){
    assert.equal(handles.producer,null);assert.equal(merchant,null);
    merchant=new MerchantSupplierOrders({supplierOrderWorkspaces:{workspaces:{profile:{label:'Complete original-source declared supplier profile',directory:paths.producer,inputs,transportConfigPath:configuration}}}});
    client=await createSupplierOrderClient({workspace:'profile',client:{endpoint:'native-supplier-profile:'+operationId,
      call:(name,args)=>{usedTools.add(name);return merchant.call(name,args);}}});await client.open();
  }
  async function stopClient(){if(client){await client.close();client=null;}if(merchant){await merchant.close();merchant=null;}}
  async function http(path,{body,metadata,method=body===undefined?'GET':'POST'}={}){
    assert.ok(desk);const headers={Authorization:'Bearer '+desk.token};
    if(metadata){headers['Content-Type']='application/zip';headers['X-Supplier-Order-Metadata']=encodeURIComponent(JSON.stringify(metadata));}
    else if(body!==undefined)headers['Content-Type']='application/json';
    const response=await fetch(desk.origin+'/api/supplier-orders'+path,{method,headers,...(body===undefined?{}:{body:metadata?body:JSON.stringify(body)}),signal:AbortSignal.timeout(150000)});
    const text=await response.text();let value;try{value=JSON.parse(text);}catch{throw new Error('The complete HTTP receiving response is not JSON: '+response.status);}
    assert.ok(response.ok,JSON.stringify(value));return value;
  }
  async function cli(args){return nativeJson(process.execPath,[fileURLToPath(new URL('../cli.mjs',import.meta.url)),...args]);}
  async function cliOperation(role,name,command,make){
    const request=await savedValue('requests/'+name,async()=>({...await make(),requestId:id(name)}));
    return rememberOperation(role,name,await cli([command,'--workspace',paths[role],'--request',join(root,'requests',name+'.json')]));
  }
  function workspaceSnapshot(role,workspace,orderId,draftId){
    return{directory:paths[role],workspaceId:workspace.store.id,profileSha256:workspace.profile().profileSha256,
      orderId,headStateSha256:workspace.order({orderId}).stateSha256,draftId,draftSha256:workspace.draft({draftId}).sha256,
      documents:workspace.documents({limit:100}).items.map(x=>({id:x.id,sha256:workspace.document({id:x.id}).sha256})),
      transmissions:workspace.transport.list({limit:100}).items.map(x=>({id:x.id,sha256:x.sha256}))};
  }
  async function verifySnapshot(role,snapshot){
    const workspace=handles[role]??await openWorkspace(role);
    assert.equal(workspace.store.id,snapshot.workspaceId);assert.equal(workspace.profile().profileSha256,snapshot.profileSha256);
    assert.equal(workspace.order({orderId:snapshot.orderId}).stateSha256,snapshot.headStateSha256);
    assert.equal(workspace.draft({draftId:snapshot.draftId}).sha256,snapshot.draftSha256);
    for(const row of snapshot.documents)assert.equal(workspace.document({id:row.id}).sha256,row.sha256);
    for(const row of snapshot.transmissions)assert.equal(workspace.transport.get({transmissionId:row.id}).sha256,row.sha256);
  }
  async function verifyOperations(rows){
    for(const row of rows){const workspace=handles[row.role]??await openWorkspace(row.role),retained=workspace.operation({requestId:row.requestId});
      assert.equal(retained.state,row.state);assert.equal(digest(retained.result),row.resultSha256);}
  }
  try{
    for(const name of ['phases','requests','certificates','peer','downloads','packages'])await privateDirectory(join(root,name));
    const prerequisites=await priorReports({baselineReportPath,operatorReportPath,httpsReportPath},destinations);
    const declarationBytes=await exactBytes(resolve(profilePath));assert.equal(sha(declarationBytes),DEMONSTRATION_SHA,'Use the full installed authored demonstration declaration.');
    const profile=normalizeSupplierOrderProfile(JSON.parse(declarationBytes.toString('utf8'))),profileSha256=supplierOrderProfileSha256(profile);
    const indexBytes=await exactBytes(resolve(sourceIndexPath)),installedIndex=await exactBytes(fileURLToPath(new URL('../source/opentrans-source.json',import.meta.url)));
    assert.equal(sha(indexBytes),sha(installedIndex),'Select the same complete source manifest used by the installed native DTD adapter.');
    const index=JSON.parse(indexBytes.toString('utf8'));assert.equal(index.source.sha256,profile.declaration.sourceSha256);
    assert.equal(index.source.url,profile.declaration.url);
    const examples=index.files.filter(item=>item.role==='example'&&item.path.endsWith('.xml'));assert.equal(examples.length,4);
    const sourceFiles=[];
    for(const item of index.files){
      const path=childPath(dirname(resolve(sourceIndexPath)),item.path),body=await exactBytes(path);assert.equal(body.length,item.bytes);assert.equal(sha(body),item.sha256);
      sourceFiles.push({path,bytes:body.length,sha256:item.sha256,member:item.path,role:item.role??null});
    }
    assert.ok(sourceFiles.some(item=>item.member.toLowerCase().endsWith('.dtd')));
    const inputs={},sourceDocuments={};for(const item of examples){
      const path=childPath(dirname(resolve(sourceIndexPath)),item.path),body=await exactBytes(path);
      const provenance={url:index.source.url,archiveSha256:index.source.sha256,member:item.path};
      const original=await parseOpenTransDocument(body,{name:basename(item.path),provenance}),document=await parseOpenTransDocument(body,{name:basename(item.path),provenance,profile});
      assert.ok(KINDS.includes(document.kind)&&!sourceDocuments[document.kind]);assert.equal(document.kind,original.kind);
      assert.equal(canonical(document.raw),canonical(original.raw),'Declaring a profile must preserve the complete original XML tree.');
      assert.deepEqual(document.profile,profile);assert.equal(document.profileSha256,profileSha256);
      const inputId=document.kind.toLowerCase();inputs[inputId]={kind:'xml',path,name:basename(item.path),bytes:body.length,sha256:sha(body),provenance};
      sourceDocuments[document.kind]={inputId,file:{path,bytes:body.length,sha256:sha(body)},document,uniteDocument:original};
    }
    assert.deepEqual(Object.keys(sourceDocuments).sort(),[...KINDS].sort());
    const orderId=sourceDocuments.ORDER.document.orderId,supplierId=sourceDocuments.ORDER.document.header.supplierId;
    const source={manifest:{path:resolve(sourceIndexPath),bytes:indexBytes.length,sha256:sha(indexBytes)},archiveSha256:index.source.sha256,url:index.source.url,files:sourceFiles,orderId,supplierId};
    const started=await savedValue('operation',()=>({schema:SUPPLIER_ORDER_PROFILE_RECEIVING_SCHEMA,operationId,producerDirectory:paths.producer,customerDirectory:paths.customer,profileSha256,source,prerequisites,startedAt:new Date().toISOString()}));
    for(const [key,value]of Object.entries({operationId,producerDirectory:paths.producer,customerDirectory:paths.customer,profileSha256,source,prerequisites}))assert.deepEqual(started[key],value);
    const completed=await readJson(join(root,'report.json'));
    if(completed){
      assert.equal(completed.schema,SUPPLIER_ORDER_PROFILE_RECEIVING_SCHEMA);assert.equal(completed.operationId,operationId);assert.equal(completed.status,'PASS');assert.equal(completed.lifetimes,'CLOSED');
      assert.equal(completed.profileSha256,profileSha256);assert.deepEqual(completed.source,source);assert.deepEqual(completed.prerequisites,prerequisites);
      for(const file of completed.artifacts)await verifyFile(file);for(const role of ['producer','customer'])await verifySnapshot(role,completed.workspaces[role]);await verifyOperations(completed.invocations);
      await closeWorkspace('customer');await closeWorkspace('producer');return{...completed,reused:true};
    }
    await retain(join(root,'selected-customer-profile.json'),declarationBytes);
    const certPath=join(root,'certificates','localhost.pem'),keyPath=join(root,'certificates','localhost-key.pem');
    try{await exactBytes(certPath);await exactBytes(keyPath);}catch(error){if(error.code!=='ENOENT')throw error;
      await nativeJson('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','365','-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-keyout',keyPath,'-out',certPath]);await chmod(keyPath,0o600);}
    const cert=await exactBytes(certPath),key=await exactBytes(keyPath);
    const ports=await savedValue('ports',async()=>{const incoming=await availablePort();let outgoing=await availablePort();while(incoming===outgoing)outgoing=await availablePort();return{incoming,outgoing};});
    const incomingToken='declared-profile-in-'+digest(operationId),outgoingToken='declared-profile-out-'+digest(operationId);
    process.env.SUPPLIER_PROFILE_NATIVE_IN=incomingToken;process.env.SUPPLIER_PROFILE_NATIVE_OUT=outgoingToken;
    const configuration=await savedValue('channels',()=>({schema:'stellar-forge.supplier-order-https-config.v1',channels:[{
      id:'declared-local',title:'Original-source profile receiving on owned loopback HTTPS',mode:'test',supplierId,profileSha256,
      agreement:{reference:profile.declaration.reference},
      incoming:{url:'https://127.0.0.1:'+ports.incoming+'/order',auth:{type:'bearer',tokenEnv:'SUPPLIER_PROFILE_NATIVE_IN'},messageIdHeader:'x-original-message',acknowledgment:{statusCode:200,contentType:'text/plain',body:'PROFILE-RETAINED'}},
      outgoing:{endpoints:{ORDERRESPONSE:'https://127.0.0.1:'+ports.outgoing+'/confirmation',DISPATCHNOTIFICATION:'https://127.0.0.1:'+ports.outgoing+'/dispatch',INVOICE:'https://127.0.0.1:'+ports.outgoing+'/invoice'},
        auth:{type:'bearer',tokenEnv:'SUPPLIER_PROFILE_NATIVE_OUT'},acknowledgment:{acceptedStatusCodes:[200],rejectedStatusCodes:[422],receiptHeader:'x-provider-receipt'},timeoutMs:120000,maxResponseBytes:1048576,tls:{caFile:certPath}}
    }],intake:{host:'127.0.0.1',port:ports.incoming,certFile:certPath,keyFile:keyPath}}));
    const configPath=join(root,'channels.json');

    await startClient(inputs,configPath);
    const selected=await stage('01-declare-customer-profile',async()=>{
      const template=await client.profileTemplate({base:'standard'});assert.equal(template.orderIdMaximum,250);assert.equal(template.declaration.reference,'');
      const before=await savedValue('selection-before-intake',()=>client.profile());assert.equal(before.profile.id,defaultSupplierOrderProfile().id);assert.equal(before.revision,0);
      const operationResult=await operation('producer','select-profile',request=>client.selectProfile(request),()=>({
        profile,reason:'Select the complete authored original-source receiving declaration before first business intake.',
        expectedProfileSha256:before.profileSha256,expectedSelectionRevision:before.revision
      }));
      assert.equal(operationResult.result.profileSelection.profileSha256,profileSha256);
      const history=[];for await(const page of client.pages('profileHistory',{limit:1}))history.push(...page.items);
      assert.equal(history.length,1);assert.equal(history[0].id,id('select-profile'));
      const current=await client.profile();assert.deepEqual(current.profile,profile);assert.equal(current.canSelect,true);
      return{requestId:operationResult.id,selection:operationResult.result.profileSelection,template,historyIds:history.map(x=>x.id)};
    });
    assert.equal((await client.profile()).profileSha256,profileSha256);await stopClient();
    await openWorkspace('producer',configPath);
    intake=await serveSupplierOrderHttpsIntake({workspace:handles.producer});
    const incoming=await stage('02-original-order-over-declared-https',async()=>{
      const body=await verifyFile(sourceDocuments.ORDER.file),messageId=id('original-order-message');
      const accepted=await postOrder(configuration.channels[0].incoming.url,cert,body,incomingToken,messageId);
      assert.equal(accepted.statusCode,200);assert.equal(accepted.body.toString('utf8'),'PROFILE-RETAINED');
      const transmission=handles.producer.transport.get({transmissionId:accepted.headers['x-supplier-order-transmission-id']});
      assert.equal(transmission.state,'RECEIVED');assert.equal(transmission.profileSha256,profileSha256);assert.equal(transmission.source.sha256,sourceDocuments.ORDER.file.sha256);
      const record=handles.producer.document({id:transmission.documentId});assert.deepEqual(record.document.profile,profile);
      assert.equal(handles.producer.profile().canSelect,false);
      return{transmissionId:transmission.id,documentId:record.id,source:transmission.source,profileSha256};
    });
    await intake.close();intake=null;await closeWorkspace('producer');await startClient(inputs,configPath);
    const originals=await stage('03-complete-publisher-document-history',async()=>{
      const documents=[{kind:'ORDER',documentId:incoming.documentId,sourceSha256:sourceDocuments.ORDER.file.sha256}];
      for(const kind of KINDS.slice(1)){
        const received=await operation('producer','source-'+kind.toLowerCase(),request=>client.receive(request),()=>({
          inputId:sourceDocuments[kind].inputId,selection:'history',expectedProfileSha256:profileSha256
        }));
        const record=received.result.document;assert.equal(record.document.kind,kind);assert.equal(record.document.profileSha256,profileSha256);
        assert.equal(record.source.sha256,sourceDocuments[kind].file.sha256);assert.equal(canonical(record.document.raw),canonical(sourceDocuments[kind].document.raw));
        documents.push({kind,documentId:record.id,sourceSha256:record.source.sha256,findings:copy(record.review.findings)});
      }
      const current=await client.order({orderId});assert.equal(current.document.source.sha256,sourceDocuments.ORDER.file.sha256);
      const reference=await client.document({id:current.document.id});assert.deepEqual(reference.document.profile,profile);
      return{documents,orderId,sourceItemCount:current.items.length,profileSha256};
    });
    const prepared={};
    async function prepareKind(kind){
      const name=kind.toLowerCase(),reference='PROFILE-'+digest([operationId,kind]).slice(0,18);
      let saved=await operation('producer',name+'-draft',request=>client.saveDraft(request),async()=>{
        const seed=await client.newDraft({kind,orderIds:[orderId]});
        if(kind==='ORDERRESPONSE')seed.document.header.supplierOrderId=null;
        else seed.document.documentId=reference;
        seed.document.header.remarks??=[];seed.document.header.remarks.push({type:null,text:'Original-source declared profile receiving '+operationId,sourcePath:null});
        return{kind,orderIds:seed.orderIds,document:seed.document,sourceOrderDocuments:seed.sourceOrderDocuments,
          expectedOrderRevisions:seed.orderRevisions,expectedOrderStateSha256:seed.orderStateSha256,
          roundingPolicy:{scale:2,mode:'half-up',taxBasis:'line'},title:'Declared-profile '+kind,
          reason:'Retain the complete source-derived '+kind+' for explicit review under the selected declaration.'};
      });
      if(kind==='ORDERRESPONSE'){
        assert.ok(saved.result.draft.review.findings.some(f=>f.code==='PROFILE_FIELD_REQUIRED'&&f.path==='/header/supplierOrderId'));
        const first=saved.result.draft;
        saved=await operation('producer',name+'-reviewed-reference',request=>client.saveDraft(request),()=>{
          const document=copy(first.document);document.header.supplierOrderId=reference;
          return{kind,orderIds:first.orderIds,draftId:first.id,expectedRevision:first.revision,document,
            sourceOrderDocuments:first.sourceOrderDocuments,expectedOrderRevisions:first.orderRevisions,expectedOrderStateSha256:first.orderStateSha256,
            roundingPolicy:first.roundingPolicy,title:first.title,reason:'Add the reviewed supplier reference required by the complete authored customer declaration.'};
        });
      }
      assert.equal(saved.result.draft.review.errors,0,JSON.stringify(saved.result.draft.review.findings));
      const output=await operation('producer',name+'-prepare-xml',request=>client.prepare(request),()=>({draftId:saved.result.draftId,expectedRevision:saved.result.revision}));
      const record=output.result.document;assert.deepEqual(record.document.profile,profile);assert.equal(record.document.profileSha256,profileSha256);
      await operation('producer',name+'-select-document',request=>client.select(request),()=>({
        id:record.id,orderId,expectedOrderRevision:saved.result.draft.orderRevisions[orderId],
        reason:'Select this reviewed complete '+kind+' as the supplier contribution before delivery.'
      }));
      return{kind,draftId:saved.result.draftId,draftRevision:saved.result.revision,draftSha256:saved.result.draft.sha256,
        documentId:record.id,documentSha256:record.sha256,source:copy(record.source)};
    }
    for(const [position,kind]of KINDS.slice(1).entries())prepared[kind]=await stage(String(position+4).padStart(2,'0')+'-review-and-prepare-'+kind.toLowerCase(),()=>prepareKind(kind));
    peer=await receivingPeer({directory:join(root,'peer'),cert,key,port:ports.outgoing,token:outgoingToken,profile});
    const delivered=await stage('07-complete-declared-https-delivery',async()=>{
      const receipts=[];
      for(const kind of KINDS.slice(1)){
        const output=prepared[kind],name=kind.toLowerCase();
        const intent=await operation('producer',name+'-delivery-intent',request=>client.prepareTransmission(request),async()=>({
          documentId:output.documentId,expectedDocumentSha256:output.documentSha256,channelId:'declared-local',
          expectedChannelSha256:(await client.transportChannels()).channels.find(x=>x.id==='declared-local').sha256,
          reason:'Deliver the exact selected original-source XML through its declared profile-pinned local HTTPS channel.'
        }));
        const transmissionId=intent.result.transmissionId;
        await operation('producer',name+'-delivery-send',request=>client.sendTransmission(request),async()=>({
          transmissionId,expectedRevision:(await client.transmission({transmissionId})).revision
        }));
        const receiptPath=join(root,'peer',kind+'-1.json'),receipt=await readJson(receiptPath);
        assert.ok(receipt,'Keep the original transmission request until the receiving peer has retained its complete bytes.');
        assert.equal(receipt.file.sha256,output.source.sha256);assert.equal(receipt.profileSha256,profileSha256);
        await verifyFile(receipt.file);remember(receipt.file);const receiptBytes=await exactBytes(receiptPath);remember({path:receiptPath,bytes:receiptBytes.length,sha256:sha(receiptBytes)});
        let current=await client.transmission({transmissionId});
        if(current.state==='UNKNOWN'){
          await operation('producer',name+'-delivery-reconcile',request=>client.resolveTransmission(request),()=>({
            transmissionId,expectedRevision:current.revision,outcome:'ACKNOWLEDGED',providerReference:receipt.reference,
            reason:'Reopen the exact complete XML retained by the owned receiving peer after the original reply was interrupted.'
          }));current=await client.transmission({transmissionId});
        }
        assert.equal(current.state,'ACKNOWLEDGED');assert.equal(current.profileSha256,profileSha256);
        assert.equal(current.attemptCount,1);assert.equal((await readdir(join(root,'peer'))).filter(x=>x.startsWith(kind+'-')&&x.endsWith('.json')).length,1);
        const filtered=[];for await(const page of client.pages('transmissions',{orderId,limit:1}))filtered.push(...page.items);
        assert.ok(filtered.some(row=>row.id===transmissionId));receipts.push({kind,transmissionId,transmissionSha256:current.sha256,receipt});
      }
      return{receipts,incomingTransmissionId:incoming.transmissionId};
    });
    await stopClient();await peer.close();peer=null;await openWorkspace('producer',configPath);
    const delivery=await stage('08-full-profile-workspace-handover',async()=>{
      const result=await operation('producer','producer-package',request=>handles.producer.exportWorkspace(request),()=>({path:join(root,'packages','supplier-profile-workspace.zip')}));
      const file=await handles.producer.file({id:result.result.file.id});await verifyFile(file);
      const target={path:join(root,'packages','supplier-profile-workspace.zip'),bytes:file.bytes,sha256:file.sha256};await verifyFile(target);remember(target);
      return{...target,fileId:file.id,workspaceId:handles.producer.store.id,profileSha256,confirmationDraftId:prepared.ORDERRESPONSE.draftId};
    });

    await openWorkspace('customer');desk=await serveSupplierOrderWorkspace({workspace:handles.customer});
    const adoption=await stage('09-customer-inspection-and-explicit-profile-adoption',async()=>{
      const packageBytes=await verifyFile(delivery);
      const inspected=await operation('customer','customer-inspect-package',metadata=>http('/packages/import',{body:packageBytes,metadata}),()=>({
        mode:'inspect',name:'Supplier_Profile_Workspace.zip',expectedBytes:delivery.bytes,expectedSha256:delivery.sha256
      }));
      assert.equal(inspected.result.profile.adoptionRequired,true);assert.equal(inspected.result.profile.canAdopt,true);
      assert.deepEqual(inspected.result.profile.incoming,profile);assert.equal(inspected.result.profile.incomingSha256,profileSha256);
      const received=await operation('customer','customer-adopt-package',metadata=>http('/packages/import',{body:packageBytes,metadata}),()=>({
        mode:'merge',name:'Supplier_Profile_Workspace.zip',expectedBytes:delivery.bytes,expectedSha256:delivery.sha256,adoptProfile:true,
        expectedProfileSha256:inspected.result.profile.currentSha256,expectedSelectionRevision:inspected.result.profile.currentSelectionRevision
      }));
      assert.equal(received.result.profile.adoptionRequired,true);
      const current=await http('/profile'),history=await http('/profile/history?offset=0&limit=100');
      assert.equal(current.profileSha256,profileSha256);assert.deepEqual(current.profile,profile);assert.equal(current.requestId,received.id);assert.equal(current.canSelect,false);
      assert.deepEqual(history.items.map(x=>x.id),[received.id]);
      for(const entry of originals.documents){const retained=handles.customer.document({id:entry.documentId});assert.equal(retained.source.sha256,entry.sourceSha256);assert.equal(retained.document.profileSha256,profileSha256);}
      for(const row of handles.producer.transport.list({limit:100}).items){const retained=handles.customer.transport.get({transmissionId:row.id});assert.equal(retained.sha256,row.sha256);assert.equal(retained.foreign,true);}
      return{requestId:received.id,inspectRequestId:inspected.id,profileSha256,selectionRevision:current.revision,workspaceId:handles.customer.store.id};
    });
    await desk.close();desk=null;await closeWorkspace('customer');
    const customerReturn=await stage('10-customer-cli-review-and-complete-return',async()=>{
      const requestPath=join(root,'requests','customer-reviewed-confirmation.json');
      if(!(await readJson(requestPath))){
        const workspace=await openWorkspace('customer');
        try{
          const retained=workspace.draft({draftId:delivery.confirmationDraftId}),seed=workspace.newDraft({kind:'ORDERRESPONSE',orderIds:[orderId]}),document=copy(retained.document);
          document.header.supplierOrderId='CUSTOMER-'+digest(operationId).slice(0,18);
          document.header.remarks??=[];document.header.remarks.push({type:null,text:'Customer review and complete returned revision for '+operationId,sourcePath:null});
          await savedValue('requests/customer-reviewed-confirmation',()=>({
            requestId:id('customer-reviewed-confirmation'),kind:retained.kind,orderIds:retained.orderIds,draftId:retained.id,expectedRevision:retained.revision,document,
            sourceOrderDocuments:seed.sourceOrderDocuments,expectedOrderRevisions:seed.orderRevisions,expectedOrderStateSha256:seed.orderStateSha256,
            roundingPolicy:retained.roundingPolicy,title:retained.title,reason:'Customer reviews the retained supplier confirmation and returns a complete sourced revision.'
          }));
        }finally{await closeWorkspace('customer');}
      }
      const saved=await cliOperation('customer','customer-reviewed-confirmation','save-draft',()=>{throw new Error('Keep the complete retained customer request.');});
      assert.equal(saved.result.draft.review.errors,0,JSON.stringify(saved.result.draft.review.findings));
      const output=await cliOperation('customer','customer-prepare-confirmation','prepare',()=>({draftId:saved.result.draftId,expectedRevision:saved.result.revision}));
      await cliOperation('customer','customer-select-confirmation','select',()=>({
        id:output.result.documentId,orderId,expectedOrderRevision:saved.result.draft.orderRevisions[orderId],
        reason:'Select the customer’s reviewed returned confirmation while preserving all earlier supplier revisions.'
      }));
      const requestId=id('customer-return-package'),result=await cli(['export','--workspace',paths.customer,'--request-id',requestId,'--out',join(root,'packages','customer-profile-return.zip')]);
      rememberOperation('customer','customer-return-package',result);
      const file={path:join(root,'packages','customer-profile-return.zip'),bytes:result.result.file.bytes,sha256:result.result.file.sha256};await verifyFile(file);remember(file);
      const current=await cli(['profile','--workspace',paths.customer]),history=await cli(['profile-history','--workspace',paths.customer,'--limit','100']);
      assert.equal(current.profileSha256,profileSha256);assert.equal(current.requestId,adoption.requestId);assert.deepEqual(history.items.map(x=>x.id),[adoption.requestId]);
      return{file,draftId:saved.result.draftId,draftRevision:saved.result.revision,draftSha256:saved.result.draft.sha256,
        documentId:output.result.documentId,documentSha256:output.result.document.sha256,profileSha256,exportRequestId:requestId};
    });
    await openWorkspace('customer');
    const customerBranch=await stage('11-reopen-customer-and-receive-earlier-package',async()=>{
      const customer=handles.customer;assert.equal(customer.profile().profileSha256,profileSha256);
      const before=await savedValue('customer-before-original-package-replay',()=>workspaceSnapshot('customer',customer,orderId,customerReturn.draftId));
      assert.equal(customer.draft({draftId:customerReturn.draftId}).sha256,customerReturn.draftSha256);
      const replay=await operation('customer','customer-receive-earlier-package',request=>customer.importWorkspace(request),()=>({
        path:delivery.path,mode:'merge',expectedBytes:delivery.bytes,expectedSha256:delivery.sha256
      }));
      assert.equal(replay.result.profile.matches,true);assert.equal(replay.result.profile.adoptionRequired,false);
      assert.equal(customer.profile().requestId,adoption.requestId);assert.equal(customer.profileHistory({limit:100}).total,1);
      await verifySnapshot('customer',before);return before;
    });
    const returned=await stage('12-supplier-receives-complete-customer-return',async()=>{
      const producer=handles.producer;
      const before=await savedValue('supplier-before-customer-return',()=>workspaceSnapshot('producer',producer,orderId,prepared.ORDERRESPONSE.draftId));
      const inspected=await operation('producer','supplier-inspect-customer-return',request=>producer.importWorkspace(request),()=>({
        path:customerReturn.file.path,mode:'inspect',expectedBytes:customerReturn.file.bytes,expectedSha256:customerReturn.file.sha256
      }));
      assert.equal(inspected.result.profile.matches,true);assert.equal(inspected.result.profile.adoptionRequired,false);
      const received=await operation('producer','supplier-receive-customer-return',request=>producer.importWorkspace(request),()=>({
        path:customerReturn.file.path,mode:'merge',expectedBytes:customerReturn.file.bytes,expectedSha256:customerReturn.file.sha256
      }));
      await verifySnapshot('producer',before);assert.equal(producer.profile().requestId,selected.requestId);
      const foreign=producer.db.prepare('SELECT record_json FROM supplier_order_foreign_records WHERE source_workspace=? AND source_table=?')
        .all(handles.customer.store.id,'supplier_order_drafts').map(row=>JSON.parse(row.record_json));
      const retained=foreign.find(row=>row.originalRow.id===customerReturn.draftId&&JSON.parse(row.originalRow.record_json).sha256===customerReturn.draftSha256);
      assert.ok(retained,'The complete customer revision must remain readable in the retained returned branch.');
      assert.equal(producer.document({id:customerReturn.documentId}).sha256,customerReturn.documentSha256);
      const replay=await operation('producer','supplier-reopen-same-customer-return',request=>producer.importWorkspace(request),()=>({
        path:customerReturn.file.path,mode:'merge',expectedBytes:customerReturn.file.bytes,expectedSha256:customerReturn.file.sha256
      }));
      assert.equal(replay.result.profile.matches,true);await verifySnapshot('producer',before);
      return{requestId:received.id,customerWorkspaceId:handles.customer.store.id,retainedCustomerDraftId:customerReturn.draftId,
        retainedCustomerDraftSha256:customerReturn.draftSha256,foreignRecordId:retained.id,originalSupplierDraftSha256:before.draftSha256};
    });
    const finalPackage=await stage('13-complete-supplier-and-customer-history-package',async()=>{
      const exported=await operation('producer','complete-return-handover',request=>handles.producer.exportWorkspace(request),()=>({
        path:join(root,'packages','supplier-profile-complete-return.zip')
      }));
      const file={path:join(root,'packages','supplier-profile-complete-return.zip'),bytes:exported.result.file.bytes,sha256:exported.result.file.sha256};await verifyFile(file);remember(file);
      return{...file,fileId:exported.result.file.id,profileSha256,customerReturn:copy(customerReturn.file)};
    });
    desk=await serveSupplierOrderWorkspace({workspace:handles.customer});
    const browserResult=await stage('14-browser-declaration-history-and-complete-download',async()=>{
      assert.ok(typeof browserModule==='string'&&browserModule,'Select the installed Playwright module for this complete receiving program.');
      const imported=browserModule.endsWith('.mjs')?await import(pathToFileURL(resolve(browserModule)).href):createRequire(import.meta.url)(browserModule);
      const chromium=imported.chromium??imported.default?.chromium;assert.ok(chromium);
      browserServer=await chromium.launchServer({headless:true,...(browserExecutable?{executablePath:browserExecutable}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
      browser=await chromium.connect(browserServer.wsEndpoint());context=await browser.newContext({acceptDownloads:true,viewport:{width:1440,height:1080}});
      const page=await context.newPage(),faults=[];page.on('pageerror',error=>faults.push(error.message));
      await page.goto(desk.url,{waitUntil:'networkidle'});await page.locator('#open-profile').click();await page.locator('#profile-dialog').waitFor({state:'visible'});
      await page.waitForFunction(expected=>document.querySelector('#profile-current')?.textContent.includes(expected),profileSha256);
      assert.equal(await page.locator('#profile-fields').isDisabled(),true);assert.equal(await page.locator('#profile-save').isDisabled(),true);
      const displayed=JSON.parse(await page.locator('#profile-complete').innerText());assert.deepEqual(displayed,profile);
      await page.waitForFunction(expected=>document.querySelector('#profile-history')?.textContent.includes(expected),adoption.requestId);
      const history=await page.locator('#profile-history').innerText();assert.ok(history.includes(adoption.requestId));assert.ok(!history.includes(adoption.inspectRequestId));
      const [download]=await Promise.all([page.waitForEvent('download'),Promise.resolve().then(()=>page.locator('#profile-download').click())]);
      const complete=await exactBytes(await download.path());assert.equal(sha(complete),sha(declarationBytes));assert.equal(complete.length,declarationBytes.length);
      const profileDownload=await retain(join(root,'downloads','customer-profile.json'),complete);
      const screenshotPath=join(root,'supplier-customer-profile.png');let picture;
      try{picture=await exactBytes(screenshotPath);}catch(error){if(error.code!=='ENOENT')throw error;picture=await page.screenshot({fullPage:true});}
      const screenshot=await retain(screenshotPath,picture);assert.deepEqual(faults,[]);
      await context.close();context=null;await browser.close();browser=null;await browserServer.close();browserServer=null;
      return{profileDownload,screenshot,selectionRequestId:adoption.requestId,pageErrors:faults};
    });
    await desk.close();desk=null;
    await verifyOperations(invocations);await verifySnapshot('customer',customerBranch);
    const workspaces={producer:workspaceSnapshot('producer',handles.producer,orderId,prepared.ORDERRESPONSE.draftId),
      customer:workspaceSnapshot('customer',handles.customer,orderId,customerReturn.draftId)};
    for(const role of ['producer','customer']){
      assert.equal(handles[role].profile().profileSha256,profileSha256);
      for(const item of originals.documents)assert.equal(handles[role].document({id:item.documentId}).source.sha256,item.sourceSha256);
    }
    for(const file of prerequisites.files)await verifyFile(file);
    for(const file of source.files)await verifyFile(file);
    const availableTools=supplierOrderTools(name=>name);assert.equal(availableTools.length,40);
    for(const tool of NEW_TOOLS)assert.ok(usedTools.has(tool),'The native receiving must invoke '+tool+'.');
    const completedAt=await savedValue('completion',()=>({completedAt:new Date().toISOString()}));
    const report={schema:SUPPLIER_ORDER_PROFILE_RECEIVING_SCHEMA,operationId,status:'PASS',lifetimes:'CLOSED',startedAt:started.startedAt,completedAt:completedAt.completedAt,
      profile,profileSha256,source,prerequisites,availableToolCount:availableTools.length,calledTools:[...usedTools].sort(),workspaces,
      phases,invocations,artifacts,selected,originals,prepared,delivered,adoption,customerReturn,returned,finalPackage,browser:browserResult};
    await closeWorkspace('customer');await closeWorkspace('producer');
    await lease.close();leaseClosed=true;
    await originalFile(join(root,'report.json'),json(report));return report;
  }finally{
    const errors=[];
    for(const close of [()=>context?.close(),()=>browser?.close(),()=>browserServer?.close(),()=>desk?.close(),()=>intake?.close(),()=>client?.close(),()=>merchant?.close(),
      ()=>handles.customer?.close(),()=>handles.producer?.close(),()=>peer?.close()])try{await close();}catch(error){errors.push(error);}
    if(priorEnvironment.in===undefined)delete process.env.SUPPLIER_PROFILE_NATIVE_IN;else process.env.SUPPLIER_PROFILE_NATIVE_IN=priorEnvironment.in;
    if(priorEnvironment.out===undefined)delete process.env.SUPPLIER_PROFILE_NATIVE_OUT;else process.env.SUPPLIER_PROFILE_NATIVE_OUT=priorEnvironment.out;
    if(!errors.length&&!leaseClosed)await lease.close();
    if(errors.length)throw new AggregateError(errors,'Keep this original receiving owner until its native resources have closed.');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),options={},allowed=new Set(['directory','producer','customer','operation','source','profile','baseline-report','operator-report','https-report','browser-module','browser-executable']);
  for(let index=0;index<args.length;index+=2){assert.ok(args[index].startsWith('--')&&args[index+1]!==undefined);const name=args[index].slice(2);assert.ok(allowed.has(name)&&!Object.hasOwn(options,name));options[name]=args[index+1];}
  runSupplierOrderProfileReceiving({
    directory:options.directory,producerDirectory:options.producer,customerDirectory:options.customer,operationId:options.operation,
    sourceIndexPath:options.source,profilePath:options.profile,baselineReportPath:options['baseline-report'],operatorReportPath:options['operator-report'],httpsReportPath:options['https-report'],
    browserModule:options['browser-module'],browserExecutable:options['browser-executable'],onProgress:event=>process.stderr.write(JSON.stringify(event)+'\n')
  }).then(result=>process.stdout.write(JSON.stringify(result)+'\n'),error=>{process.stderr.write(JSON.stringify({error:{code:error.code,message:error.message,stack:error.stack}})+'\n');process.exitCode=1;});
}
