#!/usr/bin/env node
// MIT. One receiving operation attaches to existing SQL Server and merchant owners.
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { openMerchantFileClient } from '../../../../../stellar-forge/mcp-merchant-operator/retained-download.mjs';
import { downloadMssqlTransfer } from '../agent/download.mjs';
import { readMssqlWorkspaceConfiguration, MssqlWorkspaceClient } from '../agent/client.mjs';
import { verifyPreparedMssqlSeller } from '../prepare.mjs';
import { buildUnpaidRequest, readLimitedResponse, decodePaymentRequired } from '../../developer/request.mjs';
import { UUID, ALIAS, exact, checked, need, digest, canonical, readBytes, readJSON, publish, replace,
  exists, privateDirectory, operatorLease, absolute } from './operator-store.mjs';

const SCHEMA='stellar-forge.mssql-managed-receiving.v1';
const same=(left,right,code)=>need(canonical(left)===canonical(right),code);
const wireInput=(method,input)=>['POST','PUT','PATCH'].includes(method)?{body:JSON.stringify(input)}:
  {query:Object.fromEntries(Object.entries(input).map(([name,value])=>{
    need(['string','number','boolean'].includes(typeof value),'MSSQL_RECEIVING_QUERY_INPUT_INVALID');
    return [name,String(value)];
  }))};
async function originalCall(client,workspace,workspaceId,name,args={}) {
  const value=await client.call('merchant_mssql_'+name,{workspace,workspaceId,...args});
  need(value?.workspace===workspace&&value.workspaceId===workspaceId&&value.result&&typeof value.result==='object',
    'MSSQL_RECEIVING_OWNER_CHANGED');
  return value.result;
}
// The proxy drops one actual committed response. SQL execution remains in the
// existing browser owner and the same request UUID is then reopened directly.
async function losePreviewReply(options,input,onLost) {
  const upstream=new URL(options.url);
  let dropped=false,proxyError;
  const server=createServer((req,res)=>{
    Promise.resolve().then(async()=>{
      let count=0;const chunks=[];
      for await(const chunk of req){count+=chunk.length;need(count<=524288,'MSSQL_RECEIVING_PROXY_INPUT');chunks.push(chunk);}
      const bytes=Buffer.concat(chunks),message=JSON.parse(bytes);
      const response=await fetch(upstream,{method:'POST',redirect:'error',signal:AbortSignal.timeout(120000),
        headers:{authorization:req.headers.authorization,'content-type':'application/json',
          accept:'application/json','mcp-protocol-version':req.headers['mcp-protocol-version']},
        body:bytes});
      const output=[];let size=0;
      for await(const chunk of response.body??[]){size+=chunk.length;need(size<=2097152,'MSSQL_RECEIVING_PROXY_OUTPUT');output.push(chunk);}
      const body=Buffer.concat(output,size);
      if(!dropped&&message.method==='tools/call'&&message.params?.name==='merchant_mssql_preview'&&
        message.params.arguments?.operationId===input.operationId) {
        const rpc=JSON.parse(body);
        need(response.status===200&&!rpc.error&&rpc.result?.isError!==true&&rpc.result?.structuredContent?.result?.operationId===input.operationId,
          'MSSQL_RECEIVING_PREVIEW_NOT_COMMITTED');
        await onLost({operationId:input.operationId,status:response.status,bytes:body.length,sha256:digest(body)});
        dropped=true;res.destroy();return;
      }
      res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json',
        'content-length':body.length});res.end(body);
    }).catch(error=>{proxyError=error;res.destroy();});
  });
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done);});
  try {
    const client=await openMerchantFileClient({...options,url:'http://127.0.0.1:'+server.address().port,
      errorPrefix:'MSSQL',clientName:'starforge-mssql-receiving-loss'});
    let interrupted=false;
    try{await client.call('merchant_mssql_preview',input);}catch{interrupted=true;}
    if(proxyError)throw proxyError;
    need(interrupted&&dropped,'MSSQL_RECEIVING_REPLY_NOT_LOST');
  }finally{await new Promise(done=>{server.close(done);server.closeAllConnections();});}
}

/**
 * Attach to two host-configured original workspaces through their existing MCP
 * host. The receiving alias selects its existing private merchant download path.
 * The unchanged options file and output directory resume the same operation.
 */
export async function receiveManagedMssql(options,{environment=process.env}={}) {
  exact(options,['schema','directory','connection','workspace','receiver','choices','mcpUrl','tokenEnv','storeReleaseId'],
    ['schema','directory','connection','workspace','receiver','choices','mcpUrl','storeReleaseId']);
  need(options.schema===SCHEMA,'MSSQL_RECEIVING_CONFIGURATION');
  checked(options.workspace,ALIAS,'author workspace alias');checked(options.storeReleaseId,ALIAS,'seller store release ID');
  exact(options.receiver,['workspace','delivery'],['workspace','delivery']);
  checked(options.receiver.workspace,ALIAS,'receiving workspace alias');checked(options.receiver.delivery,ALIAS,'receiving delivery alias');
  const root=await privateDirectory(absolute(options.directory),true),lease=await operatorLease(root);
  let stage='selection',report={schema:SCHEMA,status:'RUNNING',stages:[]},client,selected,receiver,ownedRuntime;
  try {
    const connectionPath=absolute(options.connection),choicesPath=absolute(options.choices);
    const [connectionBytes,choicesBytes]=await Promise.all([readBytes(connectionPath,1048576),readBytes(choicesPath,524288)]);
    const config=await readMssqlWorkspaceConfiguration(connectionPath);
    selected=config.workspaces[options.workspace];receiver=config.workspaces[options.receiver.workspace];
    need(selected&&receiver&&selected.workspaceId!==receiver.workspaceId,'MSSQL_RECEIVING_DISTINCT_WORKSPACES_REQUIRED');
    const delivery=receiver.deliveries[options.receiver.delivery];
    need(delivery&&delivery.directory===join(root,'merchant'),'MSSQL_RECEIVING_DELIVERY_SELECTION',
      'Configure the receiving delivery alias to this operation directory’s merchant/ child.');
    const intentPath=join(root,'receiving-intent.json'),selection={options,connectionSha256:digest(connectionBytes),choicesSha256:digest(choicesBytes),
      workspaceId:selected.workspaceId,receivingWorkspaceId:receiver.workspaceId};
    let intent;
    if(await exists(intentPath)) {
      intent=await readJSON(intentPath,1048576);same(intent.selection,selection,'MSSQL_RECEIVING_INPUT_CHANGED');
    } else {
      intent={schema:SCHEMA,operationId:randomUUID(),createdAt:new Date().toISOString(),selection,
        operations:Object.fromEntries(['review','preview','prepare','merchant','customer','receive'].map(name=>[name,randomUUID()]))};
      await publish(intentPath,intent);
    }
    report={...report,operationId:intent.operationId,createdAt:intent.createdAt,workspaceId:selected.workspaceId,
      receivingWorkspaceId:receiver.workspaceId};
    const choices=JSON.parse(choicesBytes),transport={url:options.mcpUrl,tokenEnv:options.tokenEnv??'MCP_ACCESS_TOKEN',environment};
    client=await openMerchantFileClient({...transport,errorPrefix:'MSSQL',clientName:'starforge-mssql-managed-receiving'});
    const call=(name,args)=>originalCall(client,options.workspace,selected.workspaceId,name,args);
    const receiveCall=(name,args)=>originalCall(client,options.receiver.workspace,receiver.workspaceId,name,args);
    async function retainedFile(name,action) {
      const path=join(root,name+'.json');
      if(await exists(path))return readJSON(path,4*1024*1024);
      const result=await action();lease.assertHeld();await publish(path,result);return result;
    }
    async function complete(name,action) {
      stage=name;const value=await action();report.stages.push({stage:name,completedAt:new Date().toISOString()});return value;
    }
    await complete('original-listeners',async()=>{
      const [author,recipient]=await Promise.all([new MssqlWorkspaceClient(selected).selected(),new MssqlWorkspaceClient(receiver).selected()]);
      const authorInfo=await author.json('/api/info'),receivingInfo=await recipient.json('/api/info');
      const viaMcp=await call('status',{});
      need(viaMcp.workspaceId===authorInfo.workspaceId&&viaMcp.instanceId===authorInfo.instanceId&&authorInfo.stageAvailable,
        'MSSQL_RECEIVING_ORIGINAL_OWNER_REQUIRED');
      await retainedFile('original-listeners',async()=>({author:authorInfo,receiver:receivingInfo}));
    });
    const catalog=await complete('native-catalog',()=>retainedFile('catalog',()=>call('catalog',{})));
    report.serverVersion=catalog.serverVersion;
    const review=await complete('native-review',async()=>{
      const result=await call('review',{choices,operationId:intent.operations.review});
      const reopened=await call('review_load',{reviewId:result.reviewId});
      same(reopened.choices,choices,'MSSQL_RECEIVING_CHOICES_CHANGED');same(reopened.review,result,'MSSQL_RECEIVING_REVIEW_CHANGED');
      await retainedFile('review',async()=>result);return result;
    });
    const previewInput={workspace:options.workspace,workspaceId:selected.workspaceId,reviewId:review.reviewId,
      planId:review.planId,endpointId:review.endpoints[0].route.id,operationId:intent.operations.preview};
    const preview=await complete('native-query-and-response-recovery',async()=>{
      if(!await exists(join(root,'preview-transport-loss.json')))
        await losePreviewReply(transport,previewInput,record=>publish(join(root,'preview-transport-loss.json'),record));
      const {workspace,workspaceId,...input}=previewInput;
      const result=await call('preview',input),again=await call('preview',input);
      same(result,again,'MSSQL_RECEIVING_PREVIEW_REPLAY_CHANGED');
      const saved=await call('operation',{operationId:input.operationId});
      same(saved.result,result,'MSSQL_RECEIVING_NATIVE_RESULT_CHANGED');
      await retainedFile('preview',async()=>result);return result;
    });
    report.query={endpointId:preview.endpointId,capturedAt:preview.capturedAt,
      rows:preview.result.rowCount,truncated:preview.result.truncated,sha256:digest(canonical(preview.result))};
    const prepared=await complete('prepared-original-release',async()=>{
      const result=await call('prepare',{reviewId:review.reviewId,planId:review.planId,operationId:intent.operations.prepare});
      const current=await call('release',{releaseId:result.releaseId});
      need(current.manifestSha256===result.manifestSha256&&current.planId===review.planId,'MSSQL_RECEIVING_PACKAGE_CHANGED');
      await retainedFile('prepared',async()=>current);return current;
    });
    await complete('original-seller-store',()=>retainedFile('seller-store-stage',()=>call('stage',{
      releaseId:prepared.releaseId,manifestSha256:prepared.manifestSha256,id:options.storeReleaseId})));
    const transfers={};
    for(const kind of ['merchant','customer'])transfers[kind]=await complete(kind+'-complete-transfer',async()=>{
      const exported=await call('export',{releaseId:prepared.releaseId,manifestSha256:prepared.manifestSha256,
        kind,operationId:intent.operations[kind]});
      const received=await downloadMssqlTransfer({client,workspace:options.workspace,workspaceId:selected.workspaceId,
        exportId:exported.exportId,directory:join(root,kind),expectedManifestSha256:exported.manifestSha256,chunkSize:65536});
      need(received.state==='COMPLETE'&&received.kind===kind&&received.packageManifestSha256===prepared.manifestSha256,
        'MSSQL_RECEIVING_TRANSFER_CHANGED');
      await retainedFile(kind+'-transfer',async()=>({exported,received}));return {exported,received};
    });
    const nativePackage=await verifyPreparedMssqlSeller(join(root,'merchant','package'));
    need(nativePackage.manifestSha256===prepared.manifestSha256,'MSSQL_RECEIVING_PACKAGE_CHANGED');
    const customer=await import(pathToFileURL(join(root,'customer','client','seller-client.mjs')).href);
    need(customer.source.sourceSha256===nativePackage.files['openapi.json'].sha256,'MSSQL_RECEIVING_CLIENT_CHANGED');
    await complete('receiving-original-workspace',async()=>{
      const received=await receiveCall('receive',{delivery:options.receiver.delivery,
        expectedManifestSha256:transfers.merchant.exported.manifestSha256,operationId:intent.operations.receive});
      const reopened=await receiveCall('release',{releaseId:prepared.releaseId});
      need(received.manifestSha256===prepared.manifestSha256&&reopened.manifestSha256===prepared.manifestSha256&&
        reopened.planId===prepared.planId,'MSSQL_RECEIVING_RELEASE_CHANGED');
      same(reopened.choices,choices,'MSSQL_RECEIVING_CHOICES_CHANGED');
      await retainedFile('received-release',async()=>reopened);
    });
    await complete('customer-original-contract',async()=>{
      const service=await readJSON(join(root,'merchant','package','service.json'),16777216);
      const sourceRoute=service.routes.find(value=>value.id===preview.endpointId);
      const operation=customer.operations.find(value=>value.id===preview.endpointId);
      need(operation&&sourceRoute,'MSSQL_RECEIVING_CLIENT_OPERATION_MISSING');
      same(operation.offer,sourceRoute.offer,'MSSQL_RECEIVING_CLIENT_CHANGED');
      const before=await call('status',{});
      const runtime=await call('start',{releaseId:prepared.releaseId,manifestSha256:prepared.manifestSha256});
      if(!before.runtime)ownedRuntime=runtime;
      const openapi=await readJSON(join(root,'customer','openapi.json'),16777216);
      const nativeOperation=Object.values(openapi.paths).flatMap(item=>Object.values(item)).find(value=>value.operationId===preview.endpointId);
      need(nativeOperation,'MSSQL_RECEIVING_CLIENT_OPERATION_MISSING');
      const request=buildUnpaidRequest(nativeOperation,wireInput(operation.method,review.endpoints[0].route.example),runtime.url);
      const response=await fetch(request.url,{...request.init,signal:AbortSignal.timeout(15000)});
      const body=await readLimitedResponse(response);
      need(response.status===402,'MSSQL_RECEIVING_CHALLENGE_UNAVAILABLE');
      const paymentRequired=decodePaymentRequired(response.headers.get('payment-required'));
      same(paymentRequired.accepts,sourceRoute.offer.accepts,'MSSQL_RECEIVING_PAYMENT_CHANGED');
      await retainedFile('customer-challenge',async()=>({status:response.status,paymentRequired,body,
        clientSourceSha256:customer.source.sourceSha256}));
      if(ownedRuntime) {await call('stop',{runId:ownedRuntime.runId});ownedRuntime=null;}
    });
    report.status='COMPLETED';report.releaseId=prepared.releaseId;report.manifestSha256=prepared.manifestSha256;
    report.merchantTransfer=transfers.merchant.exported;report.customerTransfer=transfers.customer.exported;
  }catch(error) {
    report.status='FAILED';report.failure={stage,code:error.code??'MSSQL_MANAGED_RECEIVING_FAILED',
      message:String(error.message).slice(0,500)};
  }finally {
    if(ownedRuntime&&client&&selected)try {
      await originalCall(client,options.workspace,selected.workspaceId,'stop',{runId:ownedRuntime.runId});
    }catch(error){report.status='FAILED';report.failure??={stage:'stop-owned-merchant',code:error.code??'MSSQL_RECEIVING_STOP_FAILED'};}
    report.completedAt=new Date().toISOString();
    try{await replace(join(root,'receiving.json'),report);}finally{await lease.close();}
  }
  return {directory:root,...report};
}
export async function main(argv=process.argv.slice(2)) {
  if(argv.length===1&&['--help','help','-h'].includes(argv[0])) {
    process.stdout.write('mssql-managed-receive --options /private/managed-receiving.json\n'+
      'Use the two existing SQL Server workspaces, their same merchant host and an original approved choices file.\n');return;
  }
  need(argv.length===2&&argv[0]==='--options','MSSQL_RECEIVING_USAGE');
  const result=await receiveManagedMssql(await readJSON(resolve(argv[1]),1048576));
  process.stdout.write(JSON.stringify(result,null,2)+'\n');if(result.status!=='COMPLETED')process.exitCode=1;return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'MSSQL_MANAGED_RECEIVING_FAILED',message:error.message})+'\n');process.exitCode=1;});
