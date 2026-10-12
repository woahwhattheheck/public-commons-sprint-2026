#!/usr/bin/env node
// MIT. Complete operator receiving on the original supplier-order producer/customer delivery.
import assert from 'node:assert/strict';
import { constants, createReadStream } from 'node:fs';
import { open, mkdir, lstat, realpath, readFile, rename, link, unlink } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { finished } from 'node:stream/promises';
import { dirname, join, resolve, relative, isAbsolute, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireStateLease } from '../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import { openSupplierOrderWorkspace } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/workspace.mjs';
import { serveSupplierOrderWorkspace } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/server.mjs';
import { parseOpenTransDocument } from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders/opentrans.mjs';
import { initializeSupplierOrderMerchant } from '../supplier-order-connection.mjs';
import { readMerchantConfig } from '../config.mjs';
import { startMerchantMcp } from '../serve.mjs';
import { openMerchantFileClient } from '../retained-download.mjs';
import { createSupplierOrderClient } from '../supplier-order-client.mjs';
import { main as supplierOrderClientCli } from '../supplier-order-cli.mjs';
import { supplierOrderTools } from '../catalog/supplier-orders.mjs';
import { SUPPLIER_ORDER_EXPORT_MANIFEST } from '../supplier-order-contracts.mjs';

const HERE=dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.supplier-order-operator-native.v1';
const BASELINE_SCHEMA='stellar-forge.supplier-orders-native-receiving.v1';
const TOKEN_ENV='SUPPLIER_ORDER_RECEIVING_TOKEN';
const MAX_CONTROL=64*1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):
  Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
const digest=value=>sha(canonical(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const failure=(code,message)=>Object.assign(new Error(message),{code});
const contained=(parent,child)=>{const value=relative(parent,child);return !value||!isAbsolute(value)&&value!=='..'&&!value.startsWith('..'+sep);};
const statIdentity=value=>['dev','ino','size','mtimeNs','ctimeNs'].map(key=>String(value[key])).join(':');
async function privateDirectory(path){
  await mkdir(path,{recursive:true,mode:0o700});const info=await lstat(path);
  assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===resolve(path),'Use the canonical private receiving directory.');
  if(process.platform!=='win32'){assert.equal(info.mode&0o077,0);if(process.getuid)assert.equal(info.uid,process.getuid());}
}
async function syncDirectory(path){const file=await open(path,constants.O_RDONLY);try{await file.sync();}finally{await file.close();}}
async function bytesAt(path,maximum=MAX_CONTROL){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});assert.ok(before.isFile()&&before.size>=0n&&before.size<=BigInt(maximum),'Use the complete bounded original control file.');
    const bytes=Buffer.allocUnsafe(Number(before.size));let offset=0;
    while(offset<bytes.length){const part=await file.read(bytes,offset,Math.min(65536,bytes.length-offset),offset);assert.ok(part.bytesRead,'The retained control file ended early.');offset+=part.bytesRead;}
    assert.equal((await file.read(Buffer.alloc(1),0,1,offset)).bytesRead,0,'The retained control file grew.');
    const after=await file.stat({bigint:true}),named=await lstat(path,{bigint:true});
    assert.ok(named.isFile()&&!named.isSymbolicLink()&&statIdentity(before)===statIdentity(after)&&statIdentity(after)===statIdentity(named),'The retained control file changed identity.');
    return bytes;
  }finally{await file.close();}
}
async function jsonAt(path,maximum){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytesAt(path,maximum)));}
async function maybeJson(path){try{return await jsonAt(path);}catch(error){if(error.code!=='ENOENT')throw error;return null;}}
async function atomicBytes(path,value){
  const bytes=Buffer.from(value),temporary=path+'.'+randomUUID()+'.next',file=await open(temporary,'wx',0o600);
  try{await file.writeFile(bytes);await file.sync();await file.close();await rename(temporary,path);await syncDirectory(dirname(path));}
  finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function retainBytes(path,value){
  const bytes=Buffer.from(value);
  try{assert.deepEqual(await bytesAt(path,Math.max(bytes.length,1)),bytes,'The original retained receiving input differs.');return path;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=path+'.'+randomUUID()+'.part',file=await open(temporary,'wx',0o600);
  try{
    await file.writeFile(bytes);await file.sync();await file.close();
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    assert.deepEqual(await bytesAt(path,Math.max(bytes.length,1)),bytes);await syncDirectory(dirname(path));return path;
  }finally{await file.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
async function fileIdentity(path,expected){
  path=resolve(path);const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});assert.ok(before.isFile()&&before.size<=8n*1024n*1024n*1024n,'Use the original complete regular artifact.');
    if(expected)assert.equal(before.size,BigInt(expected.bytes),'The original artifact length changed.');
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(128*1024);let bytes=0;
    while(BigInt(bytes)<before.size){const part=await file.read(buffer,0,Math.min(buffer.length,Number(before.size)-bytes),bytes);assert.ok(part.bytesRead,'The original artifact ended early.');hash.update(buffer.subarray(0,part.bytesRead));bytes+=part.bytesRead;}
    assert.equal((await file.read(buffer,0,1,bytes)).bytesRead,0,'The original artifact grew.');
    const after=await file.stat({bigint:true}),named=await lstat(path,{bigint:true});
    assert.ok(named.isFile()&&!named.isSymbolicLink()&&statIdentity(before)===statIdentity(after)&&statIdentity(after)===statIdentity(named),'The original artifact changed during its complete read.');
    const result={path,bytes,sha256:hash.digest('hex')};if(expected)assert.equal(result.sha256,expected.sha256,'The original artifact SHA-256 changed.');return result;
  }finally{await file.close();}
}
async function sourceIdentities(){
  const selected=['supplier-order-client.mjs','supplier-order-client.d.mts','supplier-order-cli.mjs','supplier-orders.mjs',
    'supplier-order-connection.mjs','supplier-order-contracts.mjs','catalog/supplier-orders.mjs','providers/supplier-orders.mjs',
    'receiving/supplier-orders-operator-native.mjs'];
  const result={};
  for(const path of selected){const bytes=await bytesAt(join(HERE,'..',path),4*1024*1024);result[path]={bytes:bytes.length,sha256:sha(bytes),gitBlob:createHash('sha1').update('blob '+bytes.length+'\0').update(bytes).digest('hex')};}
  return result;
}
function complete(operation){
  assert.equal(operation.state,'COMPLETE',operation.error?.message??'The original operation is not complete.');
  assert.ok(operation.result&&!operation.resultSummary,'Use the complete native result for this original receiving input.');return operation.result;
}
function saveRequest(draft,{requestId,reason,title,document=draft.document}={}){
  return{requestId,...(draft.id?{draftId:draft.id,expectedRevision:draft.revision}:{}),kind:draft.kind,orderIds:clone(draft.orderIds),
    expectedOrderRevisions:clone(draft.orderRevisions),expectedOrderStateSha256:clone(draft.orderStateSha256),
    sourceOrderDocuments:clone(draft.sourceOrderDocuments),document:clone(document),roundingPolicy:clone(draft.roundingPolicy??null),reason,
    ...(title?{title}:{})};
}
async function allPages(client,method,args={}){
  const pages=[];for await(const page of client.pages(method,args))pages.push(page);
  const items=pages.flatMap(page=>page.items);assert.ok(pages.length);assert.equal(items.length,pages[0].total-(args.offset??0));return{pages,items};
}
async function downloadIdentity(client,fileId,directory,options={}){
  const selected=await client.inspectExport(fileId),received=await client.downloadExport({exportId:fileId,directory,
    expectedManifestSha256:selected.manifestSha256,...options});
  assert.equal(received.state,'COMPLETE');assert.equal(selected.manifest.files.length,1);
  const file=selected.manifest.files[0],identity=await fileIdentity(join(directory,file.name),file);
  await fileIdentity(join(directory,SUPPLIER_ORDER_EXPORT_MANIFEST),{bytes:Buffer.byteLength(json(selected.manifest)),sha256:selected.manifestSha256});
  return{...received,file:identity,manifest:selected.manifest,manifestSha256:selected.manifestSha256};
}
async function responseBytes(response,{maximum=4*1024*1024}={}){
  const chunks=[];let bytes=0;
  try{for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=maximum,'The complete HTTP reply exceeds its selected receiving bound.');chunks.push(chunk);}return Buffer.concat(chunks,bytes);}
  finally{if(!response.bodyUsed)await response.body?.cancel();}
}
async function httpJsonNative(origin,token,path,{body,headers={}}={},signal){
  const response=await fetch(origin+'/api/supplier-orders'+path,{method:body===undefined?'GET':'POST',redirect:'error',
    signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),headers:{authorization:'Bearer '+token,origin,...(body===undefined?{}:{'content-type':'application/json'}),...headers},
    ...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await responseBytes(response)));
  assert.ok(response.ok,value.error?.message??'The original HTTP request failed.');return value;
}
async function httpUploadNative(origin,token,path,file,metadata,signal){
  const input=createReadStream(file.path,{flags:constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK,highWaterMark:65536});
  const drained=finished(input,{cleanup:true}).catch(()=>{});
  try{
    const response=await fetch(origin+'/api/supplier-orders'+path,{method:'POST',redirect:'error',duplex:'half',
      signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),
      headers:{authorization:'Bearer '+token,origin,'content-type':path==='/sources'?'application/xml':'application/zip',
        'content-length':String(file.bytes),'x-supplier-order-metadata':encodeURIComponent(JSON.stringify(metadata))},body:input});
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await responseBytes(response)));
    assert.ok(response.ok,value.error?.message??'The original complete HTTP intake failed.');return value;
  }finally{input.destroy();await drained;}
}
async function httpDownloadNative(origin,token,file,directory,signal){
  const path=join(directory,file.name);
  try{return await fileIdentity(path,file);}catch(error){if(error.code!=='ENOENT')throw error;}
  const response=await fetch(origin+'/api/supplier-orders/files/'+encodeURIComponent(file.id),{
    redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(120000)]):AbortSignal.timeout(120000),headers:{authorization:'Bearer '+token,origin}});
  assert.equal(response.status,200);assert.equal(response.headers.get('x-content-sha256'),file.sha256);
  assert.equal(response.headers.get('content-length'),String(file.bytes));assert.equal(response.headers.get('x-supplier-order-file-id'),file.id);
  const temporary=path+'.'+randomUUID()+'.part',out=await open(temporary,'wx',0o600),hash=createHash('sha256');let bytes=0;
  try{
    for await(const chunk of response.body){bytes+=chunk.length;assert.ok(bytes<=file.bytes);hash.update(chunk);await out.writeFile(chunk);}
    assert.equal(bytes,file.bytes);assert.equal(hash.digest('hex'),file.sha256);await out.sync();await out.close();
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    await syncDirectory(directory);return await fileIdentity(path,file);
  }finally{await response.body?.cancel().catch(()=>{});await out.close().catch(()=>{});await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}

export async function runSupplierOrderOperatorReceiving({
  directory,baselineReportPath,operationId='supplier-orders-operator-2769-20261012',signal
}={}){
  signal?.throwIfAborted();
  const httpJson=(origin,token,path,options)=>httpJsonNative(origin,token,path,options,signal);
  const httpUpload=(origin,token,path,file,metadata)=>httpUploadNative(origin,token,path,file,metadata,signal);
  const httpDownload=(origin,token,file,directory)=>httpDownloadNative(origin,token,file,directory,signal);
  assert.ok(typeof directory==='string'&&directory&&typeof baselineReportPath==='string'&&baselineReportPath);
  assert.ok(/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(operationId),'Keep the original receiving operation ID.');
  const root=resolve(directory),control=join(root,'control'),requests=join(control,'requests'),downloads=join(root,'downloads');
  const baselineBytes=await bytesAt(resolve(baselineReportPath)),baseline=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(baselineBytes));
  assert.equal(baseline.schema,BASELINE_SCHEMA);assert.equal(baseline.status,'PASS');assert.equal(baseline.lifetimes,'CLOSED');
  for(const name of ['producer','customer']){
    const original=resolve(baseline.workspaces[name].directory);
    assert.ok(!contained(root,original)&&!contained(original,root),'Keep this continuation separate from both original closed workspaces.');
  }
  await privateDirectory(root);await privateDirectory(control);const lease=await acquireStateLease(control);
  const recordPath=join(root,'operator-report.json'),prefix='so-'+sha(operationId).slice(0,16);
  const id=name=>prefix+'-'+name;
  let report,host=null,http=null,clients={},transport=null,activeConfig;
  const called=new Set(),callReceipts=[];
  let retainedPort;
  const persist=async()=>{lease.assertHeld();await atomicBytes(recordPath,json(report));};
  const phase=async(name,work)=>{
    signal?.throwIfAborted();
    const existing=report.phases.find(value=>value.name===name);
    if(existing?.state==='COMPLETE')return clone(existing.result);
    const selected=existing??{name,state:'PENDING',attempts:0};
    if(!existing)report.phases.push(selected);
    selected.state='RUNNING';selected.attempts++;selected.startedAt=new Date().toISOString();delete selected.error;
    report.status='RUNNING';report.activePhase=name;await persist();
    try{
      const result=await work();lease.assertHeld();selected.result=clone(result);selected.state='COMPLETE';selected.completedAt=new Date().toISOString();
      report.calledTools=[...new Set([...(report.calledTools??[]),...called])].sort();
      report.callReceipts.push(...callReceipts.splice(0));delete report.activePhase;await persist();return result;
    }catch(error){
      selected.state='INTERRUPTED';selected.error={code:error.code??'SUPPLIER_ORDER_RECEIVING_FAILED',message:error.message};
      report.status='INTERRUPTED';report.callReceipts.push(...callReceipts.splice(0));await persist();throw error;
    }
  };
  const retainedRequest=async(name,value)=>{
    const path=join(requests,name+'.json'),old=await maybeJson(path);
    if(old)return old;
    const selected=typeof value==='function'?await value():value;await retainBytes(path,json(selected));return clone(selected);
  };
  const callMutation=async(client,method,name,value)=>{
    const args=await retainedRequest(name,value),operation=await client[method](args),result=complete(operation);
    const key=client.workspace+':'+args.requestId,old=report.operations.find(row=>row.key===key);
    const selected={key,workspace:client.workspace,method,requestId:args.requestId,argsSha256:digest(args),
      id:operation.id,kind:operation.kind,requestSha256:operation.requestSha256,resultSha256:digest(result)};
    if(old)assert.deepEqual(selected,old,'The same original request returned another outcome.');else report.operations.push(selected);
    return operation;
  };
  const stopHost=async()=>{
    if(!host)return;const current=host;await current.close();host=null;clients={};transport=null;
  };
  const startHost=async(config)=>{
    assert.equal(host,null);activeConfig=config;
    const token=(await bytesAt(join(control,'access.token'),1024)).toString('ascii');
    host=await startMerchantMcp({configPath:config.configuration,port:retainedPort??0,tokenEnv:TOKEN_ENV,environment:{...process.env,[TOKEN_ENV]:token}});
    const origin=host.url,port=Number(new URL(origin).port);
    if(retainedPort!==undefined)assert.equal(port,retainedPort,'Reopen the original endpoint used by retained downloads.');
    retainedPort=port;report.endpoint=origin+'/mcp';report.port=port;report.lifetimes='OPEN';await persist();
    const base=await openMerchantFileClient({url:report.endpoint,tokenEnv:TOKEN_ENV,environment:{[TOKEN_ENV]:token},signal,errorPrefix:'SUPPLIER_ORDER',clientName:'supplier-order-native-receiving'});
    transport={endpoint:base.endpoint,call:async(name,args,options)=>{
      const result=await base.call(name,args,options);called.add(name);
      callReceipts.push({name,workspace:args.workspace??null,requestId:args.requestId??null,
        ...(result.id?{operationId:result.id}:{}),...(result.state?{state:result.state}:{}),replySha256:digest(result)});
      return result;
    }};
    for(const alias of ['supplier','customer','received','handover'])
      clients[alias]=await createSupplierOrderClient({workspace:alias,client:transport,callOptions:{timeoutMs:120000,requestSignal:signal}});
    const required=supplierOrderTools((name)=>name);
    for(const name of required)assert.ok(host.operator.tools.some(tool=>tool.name===name),'The installed original provider omitted '+name+'.');
    for(const client of Object.values(clients))await client.open();
    return{endpoint:report.endpoint,port,workspaceIds:Object.fromEntries(await Promise.all(Object.entries(clients).map(async([name,client])=>[name,(await client.state()).workspaceId])))};
  };
  const installHost=async(name,inputs)=>{
    assert.ok(/^[a-z][a-z0-9_-]{0,63}$/.test(name));
    const selected=await retainedRequest('host-'+name,()=>({schema:'stellar-forge.supplier-order-workspace-connection.v1',
      workspaces:Object.fromEntries(['supplier','customer','received','handover'].map(alias=>[alias,{
        label:'Original supplier-order receiving / '+alias,directory:join(root,'workspaces',alias),inputs
      }]))}));
    const connection=join(control,'connection-'+name+'.json');await retainBytes(connection,json(selected));
    const setupPath=join(control,'host-'+name+'-setup.json'),selectionSha256=digest(selected);
    let setup=await maybeJson(setupPath);
    if(setup){
      assert.equal(setup.schema,'stellar-forge.supplier-order-host-setup.v1');assert.equal(setup.connection,connection);
      assert.equal(setup.selectionSha256,selectionSha256);assert.ok(Array.isArray(setup.attempts));
    }else setup={schema:'stellar-forge.supplier-order-host-setup.v1',connection,selectionSha256,attempts:[]};
    const save=()=>atomicBytes(setupPath,json(setup));
    const inspect=async directory=>{
      const info=await lstat(directory);assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(directory)===directory);
      if(process.platform!=='win32'){assert.equal(info.mode&0o077,0);if(process.getuid)assert.equal(info.uid,process.getuid());}
      const configuration=join(directory,'merchant-mcp.json'),old=await bytesAt(configuration,1048576);
      let declared;try{declared=JSON.parse(old);}catch{throw failure('SUPPLIER_ORDER_HOST_INCOMPLETE_JSON','The owned initializer left an incomplete original configuration.');}
      assert.equal(declared.supplierOrderWorkspaceConnection,connection);
      const read=await readMerchantConfig(configuration);assert.ok(read.supplierOrderWorkspaces);return{configuration,connection};
    };
    // Each setup attempt owns only its original merchant directory. An interrupted
    // initializer remains intact; another setup attempt reuses the same four native
    // business stores and frozen connection instead of replacing partial files.
    while(true){
      signal?.throwIfAborted();
      let attempt=setup.attempts.at(-1);
      if(!attempt||attempt.state==='PRESERVED_INCOMPLETE'){
        const index=setup.attempts.length,directory=join(root,'merchant-'+name+(index?'-'+String(index).padStart(4,'0'):''));
        attempt={directory,state:'STARTING',createdAt:new Date().toISOString()};setup.attempts.push(attempt);await save();
      }
      const index=setup.attempts.length-1,expected=join(root,'merchant-'+name+(index?'-'+String(index).padStart(4,'0'):''));
      assert.equal(attempt.directory,expected,'Keep the original private initializer attempt directory.');
      try{
        const result=await inspect(attempt.directory);
        attempt.state='COMPLETE';attempt.configuration=result.configuration;await save();return result;
      }catch(error){
        if(error.code==='SUPPLIER_ORDER_HOST_INCOMPLETE_JSON'&&attempt.state==='STARTING'){
          attempt.state='PRESERVED_INCOMPLETE';attempt.preservedAt=new Date().toISOString();attempt.error={code:error.code,message:error.message};await save();continue;
        }
        if(error.code!=='ENOENT')throw error;
      }
      let exists=false;
      try{
        const info=await lstat(attempt.directory);exists=true;
        assert.ok(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(attempt.directory)===attempt.directory);
        if(process.platform!=='win32'){assert.equal(info.mode&0o077,0);if(process.getuid)assert.equal(info.uid,process.getuid());}
      }catch(error){if(error.code!=='ENOENT')throw error;}
      if(exists){
        attempt.state='PRESERVED_INCOMPLETE';attempt.preservedAt=new Date().toISOString();await save();continue;
      }
      const result=await initializeSupplierOrderMerchant({directory:attempt.directory,connection,name:'Original supplier-order operator receiving'});
      const verified=await inspect(attempt.directory);assert.equal(result.configuration,verified.configuration);
      attempt.state='COMPLETE';attempt.configuration=verified.configuration;await save();return verified;
    }
  };
  try{
    for(const path of [requests,downloads,join(root,'workspaces'),join(root,'exports')])await privateDirectory(path);
    for(const alias of ['supplier','customer','received','handover'])await privateDirectory(join(root,'workspaces',alias));
    await retainBytes(join(control,'baseline-report.json'),baselineBytes);
    const currentSource=await sourceIdentities(),saved=await maybeJson(recordPath);
    if(saved){
      assert.equal(saved.schema,SCHEMA);assert.equal(saved.operationId,operationId);assert.equal(saved.directory,root);
      assert.equal(saved.baseline.sha256,sha(baselineBytes));report=saved;retainedPort=report.port;
      if(digest(report.source)!==digest(currentSource)){report.sourceHistory??=[];report.sourceHistory.push(report.source);report.source=currentSource;}
    }else report={schema:SCHEMA,operationId,directory:root,status:'RUNNING',lifetimes:'OPEN',startedAt:new Date().toISOString(),
      baseline:{path:resolve(baselineReportPath),bytes:baselineBytes.length,sha256:sha(baselineBytes)},
      source:currentSource,phases:[],operations:[],callReceipts:[],calledTools:[],artifacts:[]};
    for(const name of report.calledTools??[])called.add(name);
    await persist();
    const selectedInputs=await phase('original-complete-inputs',async()=>{
      const originals=[];
      for(const source of baseline.sourceInputs??[])originals.push({...source,...await fileIdentity(source.path,source)});
      const producerPackage=await fileIdentity(baseline.artifacts.producerPackage.path,baseline.artifacts.producerPackage);
      const customerPackage=await fileIdentity(baseline.artifacts.customerPackage.path,baseline.artifacts.customerPackage);
      let producer,customer;
      const supplier=await openSupplierOrderWorkspace({directory:baseline.workspaces.producer.directory});
      try{
        const state=supplier.state(),order=supplier.order({orderId:baseline.workspaces.producer.orderId});
        assert.equal(state.workspaceId,baseline.workspaces.producer.workspaceId);assert.equal(order.revision,baseline.current.producerOrderRevision);
        const file=await supplier.file({id:order.document.source.fileId});await fileIdentity(file.path,file);
        const working=supplier.newDraft({kind:'ORDERRESPONSE',orderIds:[order.orderId]});
        working.document.header.date=order.document.document.header.date;
        // Retain this original current confirmation/cancellation, including omitted-line history.
        for(const item of working.document.items){
          const original=order.items.find(line=>line.lineId===item.lineId);assert.ok(original);
          item.quantity=original.reportedConfirmation??original.ordered;
        }
        producer={workspaceId:state.workspaceId,order,sourceFile:file,working};
      }finally{await supplier.close();}
      const received=await openSupplierOrderWorkspace({directory:baseline.workspaces.customer.directory});
      try{
        const state=received.state(),order=received.order({orderId:baseline.workspaces.customer.orderId});
        const draft=received.draft({draftId:baseline.current.customerDraftId});
        assert.equal(state.workspaceId,baseline.workspaces.customer.workspaceId);assert.equal(order.revision,baseline.current.customerOrderRevision);
        assert.equal(draft.revision,baseline.current.customerDraftRevision);
        customer={workspaceId:state.workspaceId,order,draft};
      }finally{await received.close();}
      const request=saveRequest(producer.working,{requestId:id('draft-input'),reason:'Operator receiving: retain the actual current original confirmation and cancellation quantities',
        title:'Original supplier confirmation / received operator working document'});
      const draftFile=join(control,'original-draft-request.json');await retainBytes(draftFile,json(request));
      return{originals,producerPackage,customerPackage,producer,customer,draftInput:await fileIdentity(draftFile)};
    });
    for(const input of [selectedInputs.producerPackage,selectedInputs.customerPackage,selectedInputs.producer.sourceFile,selectedInputs.draftInput,...selectedInputs.originals])
      await fileIdentity(input.path,input);
    const inputMap={
      original_xml:{path:selectedInputs.producer.sourceFile.path,name:selectedInputs.producer.sourceFile.name,bytes:selectedInputs.producer.sourceFile.bytes,
        sha256:selectedInputs.producer.sourceFile.sha256,kind:'xml',provenance:clone(selectedInputs.producer.order.document.source.provenance??{})},
      producer_package:{...selectedInputs.producerPackage,name:basename(selectedInputs.producerPackage.path),kind:'workspace'},
      customer_package:{...selectedInputs.customerPackage,name:basename(selectedInputs.customerPackage.path),kind:'workspace'},
      original_draft:{...selectedInputs.draftInput,name:basename(selectedInputs.draftInput.path),kind:'draft'}
    };
    await phase('private-merchant-configuration',async()=>{
      try{const token=await bytesAt(join(control,'access.token'),1024);assert.ok(token.length>=32);}
      catch(error){if(error.code!=='ENOENT')throw error;await retainBytes(join(control,'access.token'),randomBytes(32).toString('base64url'));}
      return installHost('original',inputMap);
    });
    const configuration=report.phases.find(value=>value.name==='private-merchant-configuration').result;
    await startHost(configuration);
    await phase('complete-original-customer-intake',async()=>{
      const status=await clients.supplier.status(),inputs=await clients.supplier.inputs();assert.equal(status.state,'OPEN');
      assert.deepEqual(inputs.inputs.map(input=>input.inputId).sort(),Object.keys(inputMap).sort());
      await callMutation(clients.supplier,'receiveWorkspace','inspect-producer',{requestId:id('inspect-producer'),inputId:'producer_package',mode:'inspect'});
      const producer=complete(await callMutation(clients.supplier,'receiveWorkspace','receive-producer',{requestId:id('receive-producer'),inputId:'producer_package',mode:'merge'}));
      const customer=complete(await callMutation(clients.customer,'receiveWorkspace','receive-customer',{requestId:id('receive-customer'),inputId:'customer_package',mode:'merge'}));
      const original=await clients.supplier.order({orderId:selectedInputs.producer.order.orderId});
      const current=await clients.customer.order({orderId:selectedInputs.customer.order.orderId});
      assert.deepEqual(original,selectedInputs.producer.order);assert.deepEqual(current,selectedInputs.customer.order);
      assert.deepEqual(await clients.customer.draft({draftId:selectedInputs.customer.draft.id}),selectedInputs.customer.draft);
      return{producer,customer,producerOrderSha256:digest(original),customerOrderSha256:digest(current)};
    });
    await phase('original-xml-and-complete-views',async()=>{
      const source=complete(await callMutation(clients.supplier,'receive','receive-original-xml',{requestId:id('receive-original-xml'),inputId:'original_xml',selection:'history'}));
      assert.equal(source.file.sha256,selectedInputs.producer.sourceFile.sha256);
      const order=await clients.supplier.order({orderId:selectedInputs.producer.order.orderId});
      const orders=await allPages(clients.supplier,'orders',{limit:1}),items=await allPages(clients.supplier,'orderItems',{orderId:order.orderId,limit:1});
      const history=await allPages(clients.supplier,'orderHistory',{orderId:order.orderId,limit:1});
      const documents=await allPages(clients.supplier,'documents',{orderId:order.orderId,limit:1});
      assert.deepEqual(items.items,order.items);assert.deepEqual(history.items,order.history);assert.ok(orders.items.some(row=>row.orderId===order.orderId));
      const document=await clients.supplier.document({id:order.document.id});
      const lines=await allPages(clients.supplier,'documentLines',{id:document.id,limit:1});assert.deepEqual(lines.items,document.document.items);
      const working=await clients.supplier.newDraft({kind:'ORDERRESPONSE',orderIds:[order.orderId]});
      assert.deepEqual(working.orderStateSha256,selectedInputs.producer.working.orderStateSha256);
      const original=await downloadIdentity(clients.supplier,document.source.fileId,join(downloads,'original-xml'));
      assert.equal(original.file.sha256,selectedInputs.producer.sourceFile.sha256);report.artifacts.push(original.file);
      return{source,order:{id:order.orderId,revision:order.revision,stateSha256:order.stateSha256},orders:orders.items.length,
        orderLines:items.items.length,history:history.items.length,documents:documents.items.length,original};
    });
    const draftStage=await phase('complete-host-draft-and-original-save-recovery',async()=>{
      const input=complete(await callMutation(clients.supplier,'saveDraftInput','save-host-input',{requestId:id('draft-input'),inputId:'original_draft'}));
      const first=input.draft;assert.equal(first.id,input.draftId);
      assert.equal((await clients.supplier.draft({draftId:input.draftId})).id,first.id);
      const source=await jsonAt(selectedInputs.draftInput.path);assert.deepEqual(first.document,source.document);
      const request=await retainedRequest('save-operator-draft',()=>saveRequest(first,{requestId:id('save-operator-draft'),
        reason:'Operator receiving: accept this complete current supplier confirmation with preserved original lines and source hashes',
        title:'Reviewed supplier confirmation / operator handover'}));
      // Drop one actual complete response, then reopen and resend its same native request.
      let lost=report.saveResponseLoss;
      if(!lost){
        const actual=await clients.supplier.saveDraft(request);complete(actual);
        report.saveResponseLoss={requestId:request.requestId,resultSha256:digest(actual.result)};await persist();lost=report.saveResponseLoss;
      }
      const reopened=await clients.supplier.operation({requestId:request.requestId,includeRequest:true});
      assert.equal(digest(complete(reopened)),lost.resultSha256);
      const saved=complete(await callMutation(clients.supplier,'saveDraft','save-operator-draft',request));
      assert.equal(digest(saved),lost.resultSha256);assert.equal(saved.revision,first.revision+1);
      const current=await clients.supplier.draft({draftId:saved.draftId});
      const drafts=await allPages(clients.supplier,'drafts',{orderId:current.orderIds[0],limit:1});
      const lines=await allPages(clients.supplier,'draftLines',{draftId:current.id,limit:1});
      assert.ok(drafts.items.some(row=>row.id===current.id));assert.deepEqual(lines.items,current.document.items);
      return{draft:current,inputDraft:first,requestId:request.requestId,requestSha256:reopened.requestSha256};
    });
    const preparedStage=await phase('prepared-native-xml-and-current-selection',async()=>{
      const prepared=complete(await callMutation(clients.supplier,'prepare','prepare-confirmation',{
        requestId:id('prepare-confirmation'),draftId:draftStage.draft.id,expectedRevision:draftStage.draft.revision}));
      const document=await clients.supplier.document({id:prepared.documentId});
      assert.equal(document.draftRevision,draftStage.draft.revision);assert.equal(document.review.errors,0);
      const selection=await retainedRequest('select-confirmation',async()=>{
        const current=await clients.supplier.order({orderId:document.orderIds[0]});
        return{requestId:id('select-confirmation'),id:document.id,orderId:current.orderId,expectedOrderRevision:current.revision,
          reason:'Use this reviewed supplier confirmation for the current operator order'};
      });
      const selected=complete(await callMutation(clients.supplier,'select','select-confirmation',selection));
      const after=await clients.supplier.order({orderId:selection.orderId});
      assert.equal(after.revision,selection.expectedOrderRevision+1);assert.ok(after.selectedDocuments.some(row=>row.id===document.id));
      for(const item of after.items){const before=selectedInputs.producer.order.items.find(row=>row.lineId===item.lineId);
        assert.equal(item.ordered,before.ordered);assert.equal(item.reportedConfirmation,before.reportedConfirmation??before.ordered);
        assert.equal(item.cancelled,before.cancelled);assert.equal(item.dispatched,before.dispatched);assert.equal(item.invoiced,before.invoiced);}
      const output=await downloadIdentity(clients.supplier,prepared.file.id,join(downloads,'prepared-confirmation'));report.artifacts.push(output.file);
      const parsed=await parseOpenTransDocument(await bytesAt(output.file.path),{name:prepared.file.name});
      assert.deepEqual(parsed.items.map(row=>({lineId:row.lineId,quantity:row.quantity,unit:row.unit,article:row.article})),
        document.document.items.map(row=>({lineId:row.lineId,quantity:row.quantity,unit:row.unit,article:row.article})));
      return{prepared,selected,order:after,output};
    });

    const customerStage=await phase('preserved-customer-working-revision',async()=>{
      const prior=await clients.customer.draft({draftId:selectedInputs.customer.draft.id});
      const request=await retainedRequest('customer-current-draft',async()=>{
        const currentOrders=await Promise.all(prior.orderIds.map(orderId=>clients.customer.order({orderId})));
        const working={...prior,orderRevisions:Object.fromEntries(currentOrders.map(order=>[order.orderId,order.revision])),
          orderStateSha256:Object.fromEntries(currentOrders.map(order=>[order.orderId,order.stateSha256])),
          sourceOrderDocuments:currentOrders.map(order=>({orderId:order.orderId,id:order.document.id,sha256:order.document.sha256}))};
        return saveRequest(working,{requestId:id('customer-current-draft'),
          reason:'Customer operator receiving: retain the existing customer correction and accept its complete current source selection',
          title:prior.title+' / customer operator receiving'});
      });
      const saved=complete(await callMutation(clients.customer,'saveDraft','customer-current-draft',request));
      const current=await clients.customer.draft({draftId:saved.draftId});
      assert.equal(current.id,selectedInputs.customer.draft.id);assert.equal(current.revision,selectedInputs.customer.draft.revision+1);
      assert.deepEqual(current.document,selectedInputs.customer.draft.document,'Preserve the actual original customer correction.');
      return{draft:current,order:await clients.customer.order({orderId:selectedInputs.customer.order.orderId})};
    });
    const producerExport=await phase('complete-producer-package',async()=>{
      const operation=await callMutation(clients.supplier,'exportWorkspace','export-producer',{requestId:id('export-producer')});
      const result=complete(operation),manifest=await clients.supplier.inspectExport(result.file.id);
      assert.equal(manifest.manifest.files[0].sha256,result.file.sha256);
      const descriptor=manifest.manifest.files[0];assert.ok(descriptor.bytes>1);
      const chunk=await clients.supplier.exportFile({exportId:result.file.id,file:descriptor.name,
        expectedManifestSha256:manifest.manifestSha256,expectedSha256:descriptor.sha256,offset:0,limit:Math.min(1024,descriptor.bytes-1)});
      assert.equal(chunk.bytesRead,Math.min(1024,descriptor.bytes-1));assert.equal(chunk.offset,0);assert.ok(chunk.nextOffset);
      const released=await clients.supplier.exportFileRelease({exportId:result.file.id,readId:chunk.readId});assert.equal(released.released,true);
      return{operationId:operation.id,result,manifest,preview:{bytes:chunk.bytesRead,sha256:sha(Buffer.from(chunk.data,'base64'))}};
    });
    const interrupted=await phase('actual-interrupted-package-download',async()=>{
      const destination=join(downloads,'producer-package'),descriptor=producerExport.manifest.manifest.files[0];
      let observed=null;
      try{
        await clients.supplier.downloadExport({exportId:producerExport.result.file.id,directory:destination,
          expectedManifestSha256:producerExport.manifest.manifestSha256,chunkSize:Math.min(4096,descriptor.bytes-1),signal,
          onProgress:async progress=>{
            if(progress.bytes>0&&progress.bytes<progress.total){
              observed=clone(progress);report.downloadInterruption=observed;await persist();
              throw failure('SUPPLIER_ORDER_ORIGINAL_RECEIVING_INTERRUPTION','Continue this actual original checkpoint after host close.');
            }
          }});
      }catch(error){if(error.code!=='SUPPLIER_ORDER_ORIGINAL_RECEIVING_INTERRUPTION')throw error;}
      const checkpoint=await jsonAt(join(destination,'download-state','checkpoint.json'));
      const saved=checkpoint.files[descriptor.name];assert.ok(saved.bytes>0&&saved.bytes<descriptor.bytes&&!saved.complete);
      assert.equal(checkpoint.manifestSha256,producerExport.manifest.manifestSha256);assert.ok(observed??report.downloadInterruption);
      return{directory:destination,manifestSha256:checkpoint.manifestSha256,file:descriptor.name,bytes:saved.bytes,sha256:saved.sha256,
        progress:observed??report.downloadInterruption};
    });
    await stopHost();
    const deliveryPath=join(interrupted.directory,producerExport.manifest.manifest.files[0].name);
    const receivingInput={path:deliveryPath,name:producerExport.manifest.manifest.files[0].name,
      bytes:producerExport.result.file.bytes,sha256:producerExport.result.file.sha256,kind:'workspace'};
    const receivingConfig=await phase('following-complete-input-configuration',()=>installHost('received',{...inputMap,operator_package:receivingInput}));
    await startHost(receivingConfig);
    const resumed=await phase('same-endpoint-checkpoint-and-current-reopen',async()=>{
      const output=await downloadIdentity(clients.supplier,producerExport.result.file.id,interrupted.directory);
      assert.equal(output.manifestSha256,interrupted.manifestSha256);assert.ok(output.resumed);
      assert.ok(output.resumedBytes>=interrupted.bytes);assert.equal(output.file.sha256,producerExport.result.file.sha256);
      const current=await clients.supplier.order({orderId:preparedStage.order.orderId});assert.deepEqual(current,preparedStage.order);
      assert.deepEqual(await clients.customer.draft({draftId:customerStage.draft.id}),customerStage.draft);
      const operation=await clients.supplier.operation({requestId:producerExport.operationId,includeRequest:true});
      assert.equal(complete(operation).file.id,producerExport.result.file.id);report.artifacts.push(output.file);
      return{output,order:current,operationId:operation.id};
    });
    const receivedStage=await phase('complete-portable-customer-and-older-replay',async()=>{
      await callMutation(clients.received,'receiveWorkspace','inspect-operator-package',{requestId:id('inspect-operator-package'),inputId:'operator_package',mode:'inspect'});
      const received=complete(await callMutation(clients.received,'receiveWorkspace','receive-operator-package',{requestId:id('receive-operator-package'),inputId:'operator_package',mode:'merge'}));
      assert.deepEqual(await clients.received.order({orderId:preparedStage.order.orderId}),preparedStage.order);
      const customerBefore=await clients.customer.order({orderId:customerStage.order.orderId});
      const current=complete(await callMutation(clients.customer,'receiveWorkspace','customer-current-package',{requestId:id('customer-current-package'),inputId:'operator_package',mode:'merge'}));
      assert.deepEqual(await clients.customer.order({orderId:customerBefore.orderId}),customerBefore);
      assert.deepEqual(await clients.customer.draft({draftId:customerStage.draft.id}),customerStage.draft);
      const older=complete(await callMutation(clients.customer,'receiveWorkspace','customer-older-package',{requestId:id('customer-older-package'),inputId:'producer_package',mode:'merge'}));
      const replay=complete(await callMutation(clients.customer,'receiveWorkspace','customer-older-package',null));
      assert.deepEqual(replay,older);assert.deepEqual(await clients.customer.draft({draftId:customerStage.draft.id}),customerStage.draft);
      assert.deepEqual(await clients.customer.order({orderId:customerBefore.orderId}),customerBefore);
      const exported=complete(await callMutation(clients.customer,'exportWorkspace','export-customer',{requestId:id('export-customer')}));
      const output=await downloadIdentity(clients.customer,exported.file.id,join(downloads,'customer-package'));report.artifacts.push(output.file);
      return{received,current,older,customerOrder:customerBefore,customerDraft:customerStage.draft,exported,output};
    });

    await phase('installed-client-complete-command-path',async()=>{
      const token=(await bytesAt(join(control,'access.token'),1024)).toString('ascii');
      const environment={...process.env,[TOKEN_ENV]:token},connection=['--url',report.endpoint,'--workspace','supplier','--token-env',TOKEN_ENV];
      const captures=[];
      const run=async(name,args)=>{
        let stdout='',stderr='';
        const result=await supplierOrderClientCli(args,{environment,stdout:{write(value){stdout+=value;return true;}},stderr:{write(value){stderr+=value;return true;}}});
        const file=join(root,'exports','cli-'+name+'.jsonl');await retainBytes(file,stdout);
        const artifact=await fileIdentity(file);report.artifacts.push(artifact);captures.push({name,args,result,artifact,stderrSha256:sha(stderr)});return result;
      };
      await run('tools',['tools']);
      const state=await run('state',['call','state',...connection]);assert.equal(state.workspaceId,resumed.output.manifest.workspaceId);
      const pageInput=join(control,'cli-order-lines.json');await retainBytes(pageInput,json({orderId:preparedStage.order.orderId,limit:1}));
      const pages=await run('pages',['pages','orderItems',...connection,'--args',pageInput]);assert.equal(pages.items,preparedStage.order.items.length);
      const inspected=await run('manifest',['inspect',...connection,'--export-id',preparedStage.prepared.file.id]);
      const output=await run('download',['download',...connection,'--export-id',preparedStage.prepared.file.id,'--out',join(downloads,'cli-confirmation'),
        '--manifest-sha256',inspected.manifestSha256,'--chunk-bytes','1024']);
      assert.equal(output.state,'COMPLETE');
      const descriptor=inspected.manifest.files[0],file=await fileIdentity(join(output.directory,descriptor.name),descriptor);report.artifacts.push(file);
      return{captures,file};
    });
    // The original HTTP desk borrows no live MCP SQLite handle.
    for(const client of Object.values(clients))await client.close();
    await stopHost();
    await phase('browser-and-full-http-operating-workflow',async()=>{
      const customerDirectory=join(root,'workspaces','customer');
      http=await serveSupplierOrderWorkspace({directory:customerDirectory,port:0});
      const origin=http.origin,token=http.token,assets=[];
      try{
        const productRoot=resolve(HERE,'../../../stellar/scf-starforge-20261009/sf30-seller-sdk/supplier-orders');
        for(const [route,path] of [
          ['/public/index.html',join(productRoot,'public/index.html')],
          ['/public/style.css',join(productRoot,'public/style.css')],
          ['/public/app.mjs',join(productRoot,'public/app.mjs')],
          ['/numbers.mjs',join(productRoot,'numbers.mjs')],
          ['/file-sha256.mjs',join(productRoot,'../opensearch/workspace/public/file-sha256.mjs')]
        ]){
          const response=await fetch(origin+route,{redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
          assert.equal(response.status,200);const original=await bytesAt(path,4*1024*1024),actual=await responseBytes(response);
          assert.deepEqual(actual,original,'Serve the exact selected original operator asset.');assets.push({route,bytes:actual.length,sha256:sha(actual)});
        }
        const before=await retainedRequest('http-original-selection',async()=>({
          state:await httpJson(origin,token,'/state'),
          order:await httpJson(origin,token,'/orders/'+encodeURIComponent(customerStage.order.orderId)),
          draft:await httpJson(origin,token,'/drafts/'+encodeURIComponent(customerStage.draft.id))
        }));
        assert.deepEqual(before.draft,customerStage.draft);
        const lists=await httpJson(origin,token,'/drafts?orderId='+encodeURIComponent(before.order.orderId)+'&limit=1&offset=0');
        assert.ok(lists.total>=1&&lists.items.length===1);
        const working=await retainedRequest('http-working-draft',async()=>{
          const value=await httpJson(origin,token,'/drafts/new',{body:{kind:'ORDERRESPONSE',orderIds:[before.order.orderId]}});
          for(const line of value.document.items){const original=before.order.items.find(item=>item.lineId===line.lineId);assert.ok(original);line.quantity=original.reportedConfirmation??original.ordered;}
          return value;
        });
        const save=await retainedRequest('http-save-draft',()=>saveRequest(working,{requestId:id('http-save-draft'),
          title:'Customer browser supplier confirmation',reason:'Customer browser receiving: preserve current original quantities and accept the full selected document'}));
        const savedOperation=await httpJson(origin,token,'/drafts',{body:save}),saved=complete(savedOperation);
        const preparedRequest=await retainedRequest('http-prepare',{requestId:id('http-prepare'),expectedRevision:saved.revision});
        const preparedOperation=await httpJson(origin,token,'/drafts/'+encodeURIComponent(saved.draftId)+'/prepare',{body:preparedRequest}),prepared=complete(preparedOperation);
        const selection=await retainedRequest('http-select',{requestId:id('http-select'),orderId:before.order.orderId,
          expectedOrderRevision:before.order.revision,reason:'Customer browser: select the reviewed complete supplier confirmation'});
        const selectedOperation=await httpJson(origin,token,'/documents/'+encodeURIComponent(prepared.documentId)+'/select',{body:selection});
        complete(selectedOperation);
        const after=await httpJson(origin,token,'/orders/'+encodeURIComponent(before.order.orderId));
        assert.equal(after.revision,selection.expectedOrderRevision+1);assert.ok(after.selectedDocuments.some(item=>item.id===prepared.documentId));
        assert.deepEqual(await httpJson(origin,token,'/drafts/'+encodeURIComponent(customerStage.draft.id)),customerStage.draft);
        const originalCopy=join(control,'Commande_é_original.xml');
        await retainBytes(originalCopy,await bytesAt(selectedInputs.producer.sourceFile.path));
        const original=await fileIdentity(originalCopy,selectedInputs.producer.sourceFile);
        const upload=await retainedRequest('http-source',{requestId:id('http-source'),name:basename(originalCopy),selection:'history',
          provenance:{kind:'original-operator-receiving-copy',sourceSha256:original.sha256,note:'Complete original XML retained under the actual Unicode receiving filename'},
          expectedBytes:original.bytes,expectedSha256:original.sha256});
        const importedOperation=await httpUpload(origin,token,'/sources',original,upload),imported=complete(importedOperation);
        assert.equal(imported.source.name,basename(originalCopy));assert.equal(imported.file.sha256,original.sha256);
        const preparedFile=await httpDownload(origin,token,prepared.file,join(root,'exports'));report.artifacts.push(preparedFile);
        const range=await fetch(origin+'/api/supplier-orders/files/'+encodeURIComponent(prepared.file.id),{redirect:'error',
          signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000),headers:{authorization:'Bearer '+token,origin,range:'bytes=0-'+Math.min(127,prepared.file.bytes-1),'if-range':'"'+prepared.file.sha256+'"'}});
        assert.equal(range.status,206);const rangeBytes=await responseBytes(range);
        assert.deepEqual(rangeBytes,(await bytesAt(preparedFile.path)).subarray(0,Math.min(128,prepared.file.bytes)));
        const exportRequest=await retainedRequest('http-export',{requestId:id('http-export')});
        const exportedOperation=await httpJson(origin,token,'/packages/export',{body:exportRequest}),exported=complete(exportedOperation);
        const archive=await httpDownload(origin,token,exported.file,join(root,'exports'));report.artifacts.push(archive);
        const inspection=await retainedRequest('http-inspect-package',{requestId:id('http-inspect-package'),name:basename(archive.path),mode:'inspect',expectedBytes:archive.bytes,expectedSha256:archive.sha256});
        complete(await httpUpload(origin,token,'/packages/import',archive,inspection));
        const old=await retainedRequest('http-older-package',{requestId:id('http-older-package'),name:basename(selectedInputs.producerPackage.path),mode:'merge',
          expectedBytes:selectedInputs.producerPackage.bytes,expectedSha256:selectedInputs.producerPackage.sha256});
        const oldOperation=await httpUpload(origin,token,'/packages/import',selectedInputs.producerPackage,old);complete(oldOperation);
        assert.deepEqual(await httpJson(origin,token,'/orders/'+encodeURIComponent(after.orderId)),after);
        assert.deepEqual(await httpJson(origin,token,'/drafts/'+encodeURIComponent(customerStage.draft.id)),customerStage.draft);
        const operations=[savedOperation,preparedOperation,selectedOperation,importedOperation,exportedOperation,oldOperation];
        for(const operation of operations){
          const reopened=await httpJson(origin,token,'/operations/'+encodeURIComponent(operation.id));
          assert.equal(reopened.requestSha256,operation.requestSha256);assert.equal(digest(complete(reopened)),digest(complete(operation)));
          const row={key:'customer:'+operation.id,workspace:'customer',method:'HTTP',requestId:operation.id,
            id:operation.id,kind:operation.kind,requestSha256:operation.requestSha256,resultSha256:digest(operation.result)};
          const prior=report.operations.find(value=>value.key===row.key);if(prior)assert.deepEqual(prior,row);else report.operations.push(row);
        }
        const result={origin,assets,order:after,customerDraft:customerStage.draft,browserDraft:await httpJson(origin,token,'/drafts/'+encodeURIComponent(saved.draftId)),
          prepared,preparedFile,exported,archive,originalUpload:{name:imported.source.name,sha256:imported.source.sha256},operations:operations.map(value=>({id:value.id,kind:value.kind,requestSha256:value.requestSha256}))};
        return result;
      }finally{const active=http;await active.close();assert.equal(active.activeRequests,0);http=null;}
    });
    const httpStage=report.phases.find(value=>value.name==='browser-and-full-http-operating-workflow').result;
    const finalConfiguration=await phase('complete-customer-handover-configuration',()=>installHost('handover',{...inputMap,operator_package:receivingInput,
      browser_customer:{path:httpStage.archive.path,name:basename(httpStage.archive.path),bytes:httpStage.archive.bytes,sha256:httpStage.archive.sha256,kind:'workspace'}}));
    await startHost(finalConfiguration);
    const finalStage=await phase('original-client-customer-handover-and-reopen',async()=>{
      const inspection=complete(await callMutation(clients.handover,'receiveWorkspace','inspect-final-customer',{requestId:id('inspect-final-customer'),inputId:'browser_customer',mode:'inspect'}));
      const received=complete(await callMutation(clients.handover,'receiveWorkspace','receive-final-customer',{requestId:id('receive-final-customer'),inputId:'browser_customer',mode:'merge'}));
      const customer=await clients.handover.order({orderId:httpStage.order.orderId});
      assert.deepEqual(customer,httpStage.order);assert.deepEqual(await clients.handover.draft({draftId:customerStage.draft.id}),customerStage.draft);
      assert.deepEqual(await clients.handover.draft({draftId:httpStage.browserDraft.id}),httpStage.browserDraft);
      const preserved=complete(await callMutation(clients.handover,'receiveWorkspace','handover-original-package',{requestId:id('handover-original-package'),inputId:'producer_package',mode:'merge'}));
      assert.deepEqual(await clients.handover.order({orderId:customer.orderId}),customer);
      assert.deepEqual(await clients.handover.draft({draftId:customerStage.draft.id}),customerStage.draft);
      const exportOperation=await callMutation(clients.handover,'exportWorkspace','export-final-handover',{requestId:id('export-final-handover')});
      const exported=complete(exportOperation),output=await downloadIdentity(clients.handover,exported.file.id,join(downloads,'final-customer-handover'));
      report.artifacts.push(output.file);
      await clients.handover.close();assert.equal((await clients.handover.status()).state,'CLOSED');await clients.handover.open();
      assert.deepEqual(await clients.handover.order({orderId:customer.orderId}),customer);
      const repeated=complete(await callMutation(clients.handover,'receiveWorkspace','receive-final-customer',null));
      assert.deepEqual(repeated,received);assert.deepEqual(await clients.handover.draft({draftId:customerStage.draft.id}),customerStage.draft);
      return{inspection,received,preserved,order:customer,exported,output,customerDraft:customerStage.draft,browserDraft:httpStage.browserDraft};
    });
    // These checks run even when every previous phase is already complete.
    for(const operation of report.operations){
      const client=clients[operation.workspace],actual=await client.operation({requestId:operation.requestId,includeRequest:true});
      assert.equal(actual.id,operation.id);assert.equal(actual.kind,operation.kind);assert.equal(actual.requestSha256,operation.requestSha256);
      assert.equal(digest(complete(actual)),operation.resultSha256,'The original retained native operation changed.');
    }
    for(const [client,order] of [[clients.supplier,preparedStage.order],[clients.customer,httpStage.order],[clients.received,preparedStage.order],[clients.handover,finalStage.order]])
      assert.deepEqual(await client.order({orderId:order.orderId}),order);
    for(const client of [clients.customer,clients.handover]){
      assert.deepEqual(await client.draft({draftId:customerStage.draft.id}),customerStage.draft);
      assert.deepEqual(await client.draft({draftId:httpStage.browserDraft.id}),httpStage.browserDraft);
    }
    for(const [client,output] of [[clients.supplier,preparedStage.output],[clients.supplier,resumed.output],
      [clients.customer,receivedStage.output],[clients.handover,finalStage.output]]){
      const actual=await client.inspectExport(output.exportId);assert.equal(actual.manifestSha256,output.manifestSha256);assert.deepEqual(actual.manifest,output.manifest);
      await fileIdentity(output.file.path,output.file);
      await fileIdentity(join(output.directory,SUPPLIER_ORDER_EXPORT_MANIFEST),{bytes:Buffer.byteLength(json(output.manifest)),sha256:output.manifestSha256});
    }
    const artifacts=new Map();
    for(const artifact of report.artifacts){await fileIdentity(artifact.path,artifact);artifacts.set(artifact.path,artifact);}
    report.artifacts=[...artifacts.values()];
    for(const input of [selectedInputs.producerPackage,selectedInputs.customerPackage,selectedInputs.producer.sourceFile,selectedInputs.draftInput,...selectedInputs.originals])
      await fileIdentity(input.path,input);
    for(const [role,original] of [['producer',selectedInputs.producer],['customer',selectedInputs.customer]]){
      const current=await openSupplierOrderWorkspace({directory:baseline.workspaces[role].directory});
      try{
        assert.equal(current.store.id,original.workspaceId);
        assert.deepEqual(current.order({orderId:original.order.orderId}),original.order,'The completed original baseline workspace must remain unchanged.');
        if(original.draft)assert.deepEqual(current.draft({draftId:original.draft.id}),original.draft);
      }finally{await current.close();}
    }
    const workspaceIds=Object.fromEntries(await Promise.all(Object.entries(clients).map(async([name,client])=>[name,(await client.state()).workspaceId])));
    for(const client of Object.values(clients))await client.close();
    await stopHost();
    const required=supplierOrderTools(name=>name);
    for(const name of required)assert.ok(called.has(name),'The complete original operator receiving omitted '+name+'.');
    report.calledTools=[...called].sort();report.callReceipts.push(...callReceipts.splice(0));
    report.workspaces=Object.fromEntries(Object.entries(workspaceIds).map(([role,workspaceId])=>[role,{directory:join(root,'workspaces',role),workspaceId}]));
    report.status='PASS';report.lifetimes='CLOSED';report.completedAt=new Date().toISOString();delete report.activePhase;
    report.current={supplierOrderId:preparedStage.order.orderId,supplierOrderRevision:preparedStage.order.revision,
      customerOrderId:httpStage.order.orderId,customerOrderRevision:httpStage.order.revision,
      customerDraftId:customerStage.draft.id,customerDraftRevision:customerStage.draft.revision,
      browserDraftId:httpStage.browserDraft.id,browserDraftRevision:httpStage.browserDraft.revision};
    report.deliveries={producer:resumed.output.file,customer:httpStage.archive,handover:finalStage.output.file};
    await persist();await syncDirectory(root);return clone(report);
  }catch(error){
    const failures=[];
    if(http){try{await http.close();http=null;}catch(closeError){failures.push(closeError);}}
    if(host){try{await stopHost();}catch(closeError){failures.push(closeError);}}
    if(report){
      report.status='INTERRUPTED';report.lifetimes=failures.length?'CLOSE_INCOMPLETE':'CLOSED';
      report.error={code:error.code??'SUPPLIER_ORDER_RECEIVING_FAILED',message:error.message};
      if(failures.length)report.closeErrors=failures.map(value=>({code:value.code??'CLOSE_FAILED',message:value.message}));
      report.callReceipts.push(...callReceipts.splice(0));await persist();
    }
    throw error;
  }finally{await lease.close();}
}
export async function main(args=process.argv.slice(2)){
  const values={};
  if(!args.length||args.includes('--help')){
    process.stdout.write('Complete supplier-order operator receiving\n\n  node supplier-orders-operator-native.mjs --directory PRIVATE_DIRECTORY --baseline-report ORIGINAL_REPORT.json [--operation ORIGINAL_OPERATION_ID]\n\nConsumes the original PASS/CLOSED document and customer-package report; preserves its complete workspaces and carries the same source through the installed operator, all27 MCP tools, exact file recovery and complete customer handover.\n');
    return;
  }
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!['--directory','--baseline-report','--operation'].includes(key)||!value||Object.hasOwn(values,key))throw failure('SUPPLIER_ORDER_RECEIVING_ARGUMENTS','Supply each original receiving option once.');
    values[key]=value;
  }
  const controller=new AbortController(),stop=()=>controller.abort(failure('SUPPLIER_ORDER_RECEIVING_INTERRUPTED','Resume this original receiving operation and its retained requests.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const result=await runSupplierOrderOperatorReceiving({directory:values['--directory'],baselineReportPath:values['--baseline-report'],operationId:values['--operation'],signal:controller.signal});
    process.stdout.write(JSON.stringify({schema:result.schema,operationId:result.operationId,status:result.status,lifetimes:result.lifetimes,
      report:join(result.directory,'operator-report.json'),tools:result.calledTools.length,workspaces:result.workspaces,deliveries:result.deliveries})+'\n');return result;
  }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'SUPPLIER_ORDER_RECEIVING_FAILED',message:error.message}})+'\n');process.exitCode=1;});
