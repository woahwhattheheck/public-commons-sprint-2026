// MIT. Original retained STAC/Cirrus customer journey through the maintained Node client, CLI and merchant MCP.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, chmod, open, rename, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
if(process.argv.length<7||process.argv.length>8||!/^[0-9a-f]{40}$/.test(process.argv[5]??'')){
 process.stderr.write('Usage: node stac-client-retained-receiving.mjs OUTPUT_DIR SOURCE_ROOT NATIVE_ROOT SOURCE_COMMIT ORIGINAL_PROCESSING_GZIP [EXACT_1807_WORKSPACE_FILE]\n');
 process.exit(2);
}
const root=resolve(process.argv[2]),repo=resolve(process.argv[3]),native=resolve(process.argv[4]);
const merchant=join(repo,'stellar-forge/mcp-merchant-operator');
const {StacWorkspaceClient,readStacWorkspaceConfiguration,saveStacFile,stacDigest,nativeStacItemId}=await import(pathToFileURL(join(merchant,'stac-workspace-client.mjs')));
const {MerchantStacWorkspaces}=await import(pathToFileURL(join(merchant,'stac-workspace.mjs')));
const {runStacWorkspaceCLI}=await import(pathToFileURL(join(merchant,'stac-workspace-cli.mjs')));
const workspaceModule=process.argv[7]?resolve(process.argv[7]):join(native,'sf30-seller-sdk/stac/workspace.mjs');
if(process.argv[7]){const bytes=await readFile(workspaceModule);assert.equal(createHash('sha1').update(Buffer.concat([Buffer.from('blob '+bytes.length+'\0'),bytes])).digest('hex'),'9667097fbc4053676100dfc52fa059e0d6790a74');}
const {openStacWorkspace}=await import(pathToFileURL(workspaceModule));
const {createProcessingController}=await import(pathToFileURL(join(native,'sf30-seller-sdk/stac/processing/workspace.mjs')));
const {startStacServer}=await import(pathToFileURL(join(native,'sf30-seller-sdk/stac/server.mjs')));
await mkdir(root,{recursive:true,mode:0o700});await chmod(root,0o700);
const exists=async path=>stat(path).then(()=>true,error=>{if(error.code==='ENOENT')return false;throw error;});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const op=name=>hash('SCF-STAC-WORKSPACE-AGENT-CUSTOMER-C79F-20261012:'+name).slice(0,32);
async function put(path,value){const body=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');const tmp=path+'.partial';const h=await open(tmp,'w',0o600);try{await h.writeFile(body);await h.sync();}finally{await h.close();}await rename(tmp,path);}
const progressPath=join(root,'progress.json');
let progress=await exists(progressPath)?JSON.parse(await readFile(progressPath,'utf8')):{schema:'stellar-forge.stac-workspace-client-receiving.v1',operationId:'SCF-STAC-WORKSPACE-AGENT-CUSTOMER-C79F-20261012',startedAt:new Date().toISOString(),stages:[]};
if(process.argv[7])progress.nativeSourceOverlay={repository:'woahwhattheheck/public-commons-sprint-2026',merge:'3a82a92aa7ee12c397606b979097b5f2655819e2',path:'stellar/scf-starforge-20261009/sf30-seller-sdk/stac/workspace.mjs',blob:'9667097fbc4053676100dfc52fa059e0d6790a74'};
const stage=async(name,result)=>{const prior=progress.stages.find(x=>x.name===name);if(prior)prior.result=result;else progress.stages.push({name,completedAt:new Date().toISOString(),result});await put(progressPath,progress);process.stdout.write(JSON.stringify({stage:name,status:'COMPLETE'})+'\n');return result;};
let externalAttempts=0;
const noProvider=async()=>{externalAttempts++;throw Error('This receiving journey uses the retained original source; no provider capture was requested.');};
const hosts=[],clients=[],adapters=[];
async function host(name,processingEnabled=true){
 const folder=join(root,name);await mkdir(folder,{recursive:true,mode:0o700});await chmod(folder,0o700);
 const workspace=await openStacWorkspace({directory:join(folder,'scenes'),transport:noProvider});
 const processing=processingEnabled?await createProcessingController({stacWorkspace:workspace,directory:join(folder,'processing'),config:{transport:noProvider,receivingDirectory:join(folder,'received-inputs'),handoverDirectory:join(folder,'exports')}}):null;
 const server=await startStacServer({workspace,processing});
 const value={folder,workspace,processing,server,record:join(root,name+'-serve.json'),closed:false,async close(){if(this.closed)return;this.closed=true;await server.close();await processing?.close();await workspace.close();}};
 await put(value.record,{url:server.url,workspaceId:(await workspace.getState()).id});
 hosts.push(value);return value;
}
async function cli(args,{code=0}={}){
 let stdout='',stderr='';const actual=await runStacWorkspaceCLI(args,{stdout:value=>{stdout+=value;},stderr:value=>{stderr+=value;}});
 assert.equal(actual,code,stderr);
 return stdout.trim()?JSON.parse(stdout.trim()):{stderr};
}
async function complete(client,job){if(job.status==='RUNNING')job=await client.wait(job.id,{timeoutMs:30000,intervalMs:20});assert.equal(job.status,'COMPLETE',JSON.stringify(job));return job;}
async function chunkFile(adapter,selection){
 let nextOffset=0,readId,expectedSha256,parts=[],first;
 do{
  const r=await adapter.call('merchant_stac_file_read',{workspace:'imagery',...selection,offset:nextOffset,limit:16384,...(readId?{readId,expectedSha256}:{})});
  first??=r;parts.push(Buffer.from(r.data,'base64'));readId=r.readId;expectedSha256=r.file.sha256;nextOffset=r.nextOffset;
 }while(nextOffset!==null);
 const bytes=Buffer.concat(parts);assert.equal(hash(bytes),first.file.sha256);assert.equal(bytes.length,first.file.bytes);
 return {bytes,sha256:hash(bytes),chunks:parts.length,file:first.file};
}
try{
 const sourceFile=resolve(process.argv[6]);
 const sourceBytes=await readFile(sourceFile),sourceSha='453026898def5ff1ef7de0fbb0546ecb4c95af6b3b040f5f16c5c08cac0eeed0';
 assert.equal(hash(sourceBytes),sourceSha);assert.equal(sourceBytes.length,148607);
 const source=join(root,'original-cirrus.processing.json.gz');await put(source,sourceBytes);
 const origin=await host('customer'),connection=join(root,'connection.json');
 if(!await exists(connection))await cli(['connection-init','--out',connection,'--console-url-file',origin.record,'--workspace','imagery']);
 let config=JSON.parse(await readFile(connection,'utf8'));config.workspaces.imagery.inputs={cirrus:{kind:'processing-handover',path:source,sha256:sourceSha}};
 await put(connection,config);
 const configured=await readStacWorkspaceConfiguration(connection);
 const client=new StacWorkspaceClient(configured.workspaces.imagery);clients.push(client);
 const adapter=new MerchantStacWorkspaces({stacWorkspaces:configured,exportsDirectory:root});adapters.push(adapter);
 const checked=await cli(['input-inspect','--connection',connection,'--input','cirrus']);assert.equal(checked.sha256,sourceSha);
 const importJob=await cli(['input-import','--connection',connection,'--input','cirrus','--sha256',sourceSha,'--operation-id',op('processing-import'),'--wait-ms','30000']);
 assert.equal(importJob.status,'COMPLETE',JSON.stringify(importJob));
 await stage('original-cli-complete-processing-import',{jobId:importJob.id,sourceSha256:sourceSha,bytes:sourceBytes.length,nativeReceipt:importJob.result});
 let state=await client.state();const sceneId='edition-0716a54ee55d41d49d368b36';
 const scene=await client.edition(sceneId);assert.equal(scene.items.length,15);assert.equal(scene.edition.pagesCount,4);
 let rows=[],offset=0,pin;
 do{const page=await adapter.call('merchant_stac_items',{workspace:'imagery',editionId:sceneId,offset,limit:4,...(pin?{expectedViewSha256:pin}:{})});rows.push(...page.items);pin=page.viewSha256;offset=page.nextOffset;}while(offset!==null);
 assert.equal(rows.length,15);assert.equal(new Set(rows.map(x=>x.itemId)).size,15);
 const one=await adapter.call('merchant_stac_item',{workspace:'imagery',editionId:sceneId,itemId:rows[0].itemId,expectedViewSha256:pin});
 assert.deepEqual(one.item,scene.items.find(x=>nativeStacItemId(x)===one.itemId));
 const selfCompare=await adapter.call('merchant_stac_compare',{workspace:'imagery',leftEditionId:sceneId,rightEditionId:sceneId,kind:'unchanged',limit:100});
 assert.equal(selfCompare.total,15);
 await stage('complete-native-scene-pagination-and-comparison',{editionId:sceneId,items:rows.length,pages:scene.edition.pagesCount,viewSha256:pin,selfUnchanged:selfCompare.total});
 const ps=await client.processingState(),runEdition='processing-edition-3da24759c3314821afe17256';
 const runs=await client.processingRead('runs',{editionId:runEdition});assert.equal(runs.runs.length,4);
 const firstRuns=await adapter.call('merchant_stac_processing_read',{workspace:'imagery',name:'runs',query:{editionId:runEdition},path:['runs'],limit:2});
 const nextRuns=await adapter.call('merchant_stac_processing_read',{workspace:'imagery',name:'runs',query:{editionId:runEdition},path:['runs'],offset:firstRuns.nextOffset,limit:2,expectedViewSha256:firstRuns.viewSha256});
 assert.equal(firstRuns.items.length+nextRuns.items.length,4);
 const stats=await client.processingRead('statistics',{editionId:runEdition}),associations=await client.processingRead('associations',{editionId:runEdition});
 const sourceRead=await client.file({kind:'processing-source',deploymentKey:ps.deployments[0].key});assert.equal(sourceRead.bytes.length,53275);
 await put(join(root,'processing-statistics.json'),stats);await put(join(root,'processing-associations.json'),associations);
 await stage('complete-native-processing-views',{workspaceId:ps.id,editions:ps.editions.length,runs:runs.runs.length,viewSha256:firstRuns.viewSha256,sourceBytes:sourceRead.bytes.length,sourceSha256:sourceRead.sha256});
 const asset=state.workspace.assets.find(x=>x.status==='COMPLETE');assert(asset);assert.equal(asset.bytes,29731);assert.equal(asset.sha256,'3838006f6aa188a3e52eaa58bbb58de3d1f4c65fad201d50bea495e86f3905b7');
 const assetTarget=join(root,'received-thumbnail.jpg');let saved;
 if(await exists(assetTarget)){assert.equal(hash(await readFile(assetTarget)),asset.sha256);saved={filename:assetTarget,bytes:asset.bytes,sha256:asset.sha256,reopened:true};}
 else saved=await saveStacFile(client,{kind:'asset',assetId:asset.id},assetTarget,{expectedSha256:asset.sha256});
 let chunks=[],rangeOffset=0;
 do{const r=await adapter.call('merchant_stac_asset_range',{workspace:'imagery',assetId:asset.id,offset:rangeOffset,limit:8192,...(rangeOffset?{expectedSha256:asset.sha256}:{})});chunks.push(Buffer.from(r.data,'base64'));rangeOffset=r.nextOffset;}while(rangeOffset!==null);
 assert.equal(hash(Buffer.concat(chunks)),asset.sha256);
 await assert.rejects(()=>saveStacFile(client,{kind:'asset',assetId:asset.id},assetTarget,{expectedSha256:asset.sha256}),error=>error.code==='EEXIST');
 const reviewedAsset=await adapter.call('merchant_stac_asset_review',{workspace:'imagery',editionId:sceneId,itemId:asset.itemId,assetKey:asset.assetKey,maxBytes:asset.bytes});
 await stage('verified-stream-range-and-native-asset-review',{assetId:asset.id,bytes:saved.bytes,sha256:saved.sha256,ranges:chunks.length,reviewId:reviewedAsset.id});
 if(!progress.stages.some(x=>x.name==='native-query-decision-and-stale-cas')){
  state=await client.state();const original=state.workspace.queries.find(x=>x.id===scene.edition.queryId);
  const query=Object.fromEntries(['collections','bbox','intersects','datetime','cloudCoverMax','pageSize','maxPages'].filter(k=>original[k]!==undefined).map(k=>[k,original[k]]));query.name='Retained Austin analyst receiving';
  const q=await adapter.call('merchant_stac_query_save',{workspace:'imagery',query,expectedRevision:state.workspace.revision});
  const review=await adapter.call('merchant_stac_search_review',{workspace:'imagery',queryId:q.id});
  state=await client.state();const decision={workspace:'imagery',editionId:sceneId,itemId:asset.itemId,status:'SELECTED',actor:'C79F receiving operator',note:'Retained original Austin thumbnail selected for the customer handover; source capture unchanged.',assetKeys:[asset.assetKey],expectedRevision:state.workspace.revision};
  const selected=await adapter.call('merchant_stac_decision_save',decision);
  await assert.rejects(()=>adapter.call('merchant_stac_decision_save',{...decision,note:'Stale caller write'}),error=>error.code==='STAC_WORKSPACE_REVISION_CHANGED');
  await stage('native-query-decision-and-stale-cas',{queryId:q.id,reviewId:review.id,decisionId:selected.id,rejectedStaleRevision:decision.expectedRevision});
 }
 const afterDecision=await client.edition(sceneId);assert(afterDecision.decisions.some(x=>x.itemId===asset.itemId&&x.actor==='C79F receiving operator'));
 for(const format of ['json','csv','html']){const report=await client.file({kind:'report',editionId:sceneId,format});await put(join(root,'analyst-report.'+format),report.bytes);}
 const handover=await chunkFile(adapter,{kind:'handover',editionIds:[sceneId],includeAssets:true});await put(join(root,'imagery-handover.json'),handover.bytes);
 const portable=JSON.parse(handover.bytes.toString('utf8'));assert(portable.decisions.some(x=>x.actor==='C79F receiving operator'));
 await stage('complete-native-reports-and-retained-handover',{sha256:handover.sha256,bytes:handover.bytes.length,chunks:handover.chunks,nativeDigest:portable.digest,files:portable.files.length});
 const second=await host('receiving'),secondClient=new StacWorkspaceClient({consoleUrlFile:second.record});clients.push(secondClient);
 const received=await secondClient.importHandover(portable),again=await secondClient.importHandover(portable);assert.equal(received.id,again.id);
 const reScene=await secondClient.edition(sceneId);assert.equal(reScene.items.length,15);assert.deepEqual(reScene.items,scene.items);assert(reScene.decisions.some(x=>x.actor==='C79F receiving operator'));
 await stage('native-imagery-receive-idempotency',{targetWorkspaceId:(await secondClient.state()).workspace.id,receiptId:received.id,reusedReceiptId:again.id,items:reScene.items.length});
 const exportOperation=op('processing-export');
 const exportJob=await complete(client,await adapter.call('merchant_stac_processing_action',{workspace:'imagery',name:'export-handover',operationId:exportOperation,input:{editionIds:ps.editions.map(x=>x.id),includeStacAssets:true}}));
 const processingOut=await chunkFile(adapter,{kind:'processing-handover',exportId:exportJob.result.exportId});
 await put(join(root,'processing-handover.json.gz'),processingOut.bytes);
 const receivedProcessing=await complete(secondClient,await secondClient.processingAction('import-handover',{operationId:op('processing-second-import'),input:{bodyBase64:processingOut.bytes.toString('base64')}}));
 assert.equal((await secondClient.processingRead('runs',{editionId:runEdition})).runs.length,4);
 await stage('native-processing-export-receive',{jobId:exportJob.id,exportId:exportJob.result.exportId,sha256:processingOut.sha256,bytes:processingOut.bytes.length,chunks:processingOut.chunks,receivedJobId:receivedProcessing.id});
 const receivedResume=await complete(secondClient,await secondClient.processingAction('cancel',{operationId:op('retained-processing-cancel'),input:{editionId:runEdition}}));
 await stage('explicit-native-retained-cancel-control',{jobId:receivedResume.id,result:receivedResume.result});
 const beforeId=(await client.state()).workspace.id;await origin.close();
 const reopened=await host('customer');assert.equal((await reopened.workspace.getState()).id,beforeId);
 assert.equal((await client.state()).workspace.id,beforeId);
 const recoveredOp=await adapter.call('merchant_stac_operation',{workspace:'imagery',operationId:op('processing-import')});assert.equal(recoveredOp.recentJob,null);
 assert.equal((await client.edition(sceneId)).items.length,15);
 const wrong=new StacWorkspaceClient({consoleUrlFile:second.record,workspaceId:beforeId});clients.push(wrong);
 await assert.rejects(()=>wrong.state(),error=>error.code==='STAC_WORKSPACE_ID_CHANGED');
 const waitClient=new StacWorkspaceClient({consoleUrlFile:reopened.record,timeoutMs:60000});clients.push(waitClient);
 const began=performance.now();let waitCode;
 try{await waitClient.wait(op('processing-import'),{timeoutMs:1});}catch(error){waitCode=error.code;}
 assert.equal(waitCode,'STAC_CLIENT_WAIT_EXPIRED');assert(performance.now()-began<1000);
 await stage('host-restart-identity-operation-and-wait',{workspaceId:beforeId,recentJobAfterRestart:recoveredOp.recentJob,retainedProcessingOperation:recoveredOp.processing,waitCode,waitElapsedMs:Math.round(performance.now()-began)});
 const disconnected=await adapter.call('merchant_stac_disconnect',{workspace:'imagery'});assert.equal(disconnected.client,'DISCONNECTED');assert.equal((await client.state()).workspace.id,beforeId);
 assert.equal(externalAttempts,0);
 progress.status='COMPLETE';progress.completedAt=new Date().toISOString();progress.externalProviderRequests=externalAttempts;progress.maxRssKiB=process.resourceUsage().maxRSS;
 progress.sourcePin=process.argv[5];await put(progressPath,progress);await put(join(root,'result.json'),progress);
 process.stdout.write(JSON.stringify({status:progress.status,stages:progress.stages.length,providerRequests:externalAttempts,maxRssKiB:progress.maxRssKiB})+'\n');
}catch(error){progress.status='INTERRUPTED';progress.error={code:error.code??error.name,message:error.message,stack:error.stack};await put(progressPath,progress);process.stderr.write(JSON.stringify(progress.error)+'\n');process.exitCode=1;}
finally{for(const a of adapters)await a.close().catch(()=>{});for(const c of clients)c.close();for(const h of hosts.reverse())await h.close().catch(()=>{});}
