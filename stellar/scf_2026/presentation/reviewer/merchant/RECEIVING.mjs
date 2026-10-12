#!/usr/bin/env node
// MIT. Continue the original closed reviewer through the maintained merchant provider and complete-file client.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {startReviewerWorkbench} from '../workbench.mjs';
import {readSourceFile,writeSourceFile} from '../workspace.mjs';
import {operationLease} from '../../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import {startMerchantMcp} from '../../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {initializeReviewerMerchant} from './setup.mjs';
import {openReviewerMerchantClient,downloadReviewerExport,reopenReviewerExport} from './client.mjs';
import {CONNECTION_SCHEMA,TOOL_PREFIX,MANIFEST_NAME,digest,encode,decode} from './contracts.mjs';
const options={};
for(let i=2;i<process.argv.length;i+=2){
  assert.equal(process.argv[i],'--operation');assert(process.argv[i+1]&&!options.operation);
  options.operation=resolve(process.argv[i+1]);
}
assert(options.operation,'Use --operation ABS_ORIGINAL_REVIEWER_OPERATION.');
assert(Number(process.versions.node.split('.')[0])>=22,'Use the original maintained Node22 or later.');
const operation=options.operation,root=join(operation,'merchant-client'),
  sourceRoot=fileURLToPath(new URL('../../../../../',import.meta.url));
await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
for(const name of ['source','downloads'])await mkdir(join(root,name),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
const lease=await operationLease(join(operation,'controller.lock')),
  stateFile=join(root,'MERCHANT-STATE.json'),resultFile=join(root,'MERCHANT-RESULT.json');
let journal,originalBytes,original;
try{
  try{journal=decode(await readSourceFile(stateFile,{privateFile:true}));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  if(journal){
    assert.equal(journal.operation,operation);
    originalBytes=await readSourceFile(journal.original.path,{privateFile:true});
    assert.equal(digest(originalBytes),journal.original.sha256);
  }else{
    originalBytes=await readSourceFile(join(operation,'WORKBENCH-RESULT.json'),{privateFile:true});
    const path=join(root,'source','WORKBENCH-RESULT-'+digest(originalBytes)+'.json');
    try{await writeSourceFile(path,originalBytes);}
    catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await readSourceFile(path,{privateFile:true}),originalBytes);}
    journal={schema:'stellar-forge.grant-reviewer-merchant-receiving.v1',id:randomUUID(),operation,
      original:{path,sha256:digest(originalBytes),bytes:originalBytes.length},
      createdAt:new Date().toISOString(),state:'CONTINUING',phases:{},requests:{},openings:[],generations:[]};
  }
  original=decode(originalBytes);
  assert.equal(original.state,'COMPLETE');assert.equal(original.ownedWorkbenchesClosed,true);
  assert.equal(original.newPaymentTransactions,0);
  for(const name of ['original_packet_review','original_native_receive','closed_native_export',
    'complete_primary_result','complete_earlier_result','second_operator_packet_intake','second_operator_native_receive'])
    assert(original.phases[name],name+' must belong to the original completed reviewer.');
  journal.original.runId=original.runId;
  if(journal.state==='COMPLETE'){
    const result=await readSourceFile(resultFile,{privateFile:true});
    process.stdout.write(JSON.stringify({state:'REUSED_COMPLETE',resultFile,sha256:digest(result),newPaymentTransactions:0})+'\n');
    await lease.close();process.exit(0);
  }
}catch(error){await lease.close();throw error;}
let saving=Promise.resolve(),merchant=null,client=null,sender=null,stopping=false,activePhase='setup';
const abort=new AbortController();
const stop=()=>{stopping=true;abort.abort(new Error('Original merchant receiving cancelled.'));};
process.once('SIGINT',stop);process.once('SIGTERM',stop);
const save=()=>{
  const bytes=encode(journal);
  saving=saving.catch(()=>{}).then(()=>writeSourceFile(stateFile,bytes,{replace:true}));return saving;
};
const check=()=>{assert(!stopping,'Original merchant receiving was cancelled.');abort.signal.throwIfAborted();};
async function phase(name,fn){
  activePhase=name;if(journal.phases[name])return journal.phases[name];
  check();journal.activePhase=name;await save();
  const value=await fn();journal.phases[name]={...value,completedAt:new Date().toISOString()};await save();
  process.stdout.write(JSON.stringify({phase:name,state:'COMPLETE'})+'\n');return journal.phases[name];
}
const senderDirectory=join(operation,'workbenches','sender'),receiverDirectory=join(operation,'workbenches','receiver'),
  senderSelection=original.phases.original_packet_review.selectionId,
  receiverSelection=original.phases.second_operator_packet_intake.selectionId,
  originalPacket=original.phases.closed_native_export,
  configurationFile=join(root,'reviewer-connections.json'),
  merchantConfiguration=join(root,'host','merchant-mcp.json');
async function writeExact(path,bytes){
  try{await writeSourceFile(path,bytes);}
  catch(error){if(error.code!=='EEXIST')throw error;assert.deepEqual(await readSourceFile(path,{privateFile:true}),bytes);}
}
async function configure(){
  const packet=await readSourceFile(originalPacket.path,{privateFile:true});
  assert.equal(packet.length,originalPacket.export.bytes);assert.equal(digest(packet),originalPacket.export.sha256);
  const source=decode(await readSourceFile(join(senderDirectory,'workbench.json'),{privateFile:true})),
    receiver=decode(await readSourceFile(join(receiverDirectory,'workbench.json'),{privateFile:true}));
  await writeExact(configurationFile,encode({schema:CONNECTION_SCHEMA,workspaces:{
    original:{directory:senderDirectory,workbenchId:source.id,label:'Original purchase',allowStart:false,
      inputs:{handover:{file:originalPacket.path,sha256:originalPacket.export.sha256,label:'Original exported purchase'}}},
    receiver:{directory:receiverDirectory,workbenchId:receiver.id,label:'Original receiving operator',allowStart:true},
  }}));
  return initializeReviewerMerchant({directory:join(root,'host'),connection:configurationFile,
    name:'Original SCF reviewer merchant receiving'});
}
async function currentMerchant(){
  if(merchant)return client;
  check();
  if(!sender)sender=await startReviewerWorkbench({directory:senderDirectory,sourceRoot});
  check();
  const token=randomBytes(32).toString('base64url');
  merchant=await startMerchantMcp({configPath:merchantConfiguration,port:0,
    tokenEnv:'ORIGINAL_REVIEWER_MERCHANT_CODE',environment:{ORIGINAL_REVIEWER_MERCHANT_CODE:token}});
  client=await openReviewerMerchantClient({url:merchant.url,tokenEnv:'ORIGINAL_REVIEWER_MERCHANT_CODE',
    environment:{ORIGINAL_REVIEWER_MERCHANT_CODE:token},signal:abort.signal});
  return client;
}
async function closeMerchant(){
  if(!merchant)return;
  const owned=merchant;await owned.close();if(merchant===owned){merchant=null;client=null;}
}
async function value(result,file){
  assert.equal(result.retention?.state,'COMPLETE',result.retention?.recovery);
  return (await currentMerchant()).readValue({result,...(file?{file}:{})});
}
async function snapshot(workspace){
  const c=await currentMerchant();return value(await c.state({workspace}));
}
function priorRequest(phase,path){
  const rows=Object.values(original.requests).filter(row=>row.phase===phase&&row.path===path);
  assert.equal(rows.length,1,'Use the original single saved request for '+phase+' '+path);return rows[0];
}
async function originalMutation(workspace,action,phaseName,path,overrides={}){
  const retained=priorRequest(phaseName,path),args={workspace,requestId:retained.id,
    ...(retained.selectionId?{selectionId:retained.selectionId,expectedRevision:retained.expectedRevision}:{}),...overrides};
  const result=await (await currentMerchant()).call(action,args);
  return {result,value:await value(result,action==='export'?'operation.json':undefined)};
}
async function mutation(key,action,args){
  let record=journal.requests[key];
  if(record){assert.equal(record.action,action);assert.deepEqual(record.args,args);}
  else{record={action,args,requestId:randomUUID(),createdAt:new Date().toISOString()};journal.requests[key]=record;await save();}
  const result=await (await currentMerchant()).call(action,{...record.args,requestId:record.requestId});
  return {result,value:await value(result,action==='export'?'operation.json':undefined)};
}
async function ensureBuyer(workspace,selectionId){
  const c=await currentMerchant();await c.workbenchOpen({workspace});
  const state=await snapshot(workspace);
  if(state.buyer.active){assert.equal(state.buyer.selectionId,selectionId);return state.buyer;}
  const selected=state.selections.find(row=>row.id===selectionId);assert(selected);
  // A past open receipt is durable history, not a surviving native process.
  // This new lifecycle intent is justified by the current closed native state.
  const record={workspace,selectionId,expectedRevision:selected.revision,requestId:randomUUID(),
    observedClosedAt:new Date().toISOString(),workbenchId:state.id};
  journal.openings.push(record);await save();
  const result=await c.buyerOpen({workspace,selectionId,expectedRevision:selected.revision,requestId:record.requestId}),
    observed=await value(result);
  assert.equal(observed.buyer.active,true);assert.equal(observed.buyer.selectionId,selectionId);return observed.buyer;
}
async function completeFile(descriptor,name,label){
  assert.equal(descriptor.retention?.state,'COMPLETE');
  const directory=join(root,'downloads',label),
    receipt=await downloadReviewerExport({client:await currentMerchant(),workspace:descriptor.workspace,
      exportId:descriptor.exportId,expectedManifestSha256:descriptor.manifestSha256,directory,signal:abort.signal}),
    bytes=await readSourceFile(join(directory,name),{privateFile:true,maxBytes:64*1024*1024});
  const expected=descriptor.files.find(item=>item.name===name);assert(expected);
  assert.equal(bytes.length,expected.bytes);assert.equal(digest(bytes),expected.sha256);
  const reopened=await reopenReviewerExport({directory,workspace:descriptor.workspace,
    exportId:descriptor.exportId,expectedManifestSha256:descriptor.manifestSha256});
  return {receipt,reopened,file:name,bytes:bytes.length,sha256:digest(bytes)};
}
const allPhases=['source_and_configuration','original_provider_borrow','original_review_receive_replay',
  'both_complete_native_results','original_source_document','original_accepted_export',
  'durable_download_interruption','merchant_restart_and_complete_resume','receiver_file_intake_and_original_receive',
  'receiver_native_reopen','owned_and_borrowed_shutdown','cold_file_receiving'];
let thrown;
try{
  const code={};
  for(const name of ['contracts.mjs','catalog.mjs','connection.mjs','runtime.mjs','provider.mjs','setup.mjs',
    'client.mjs','cli.mjs','RECEIVING.mjs'])code[name]=digest(await readFile(new URL(name,import.meta.url)));
  journal.generations.push({startedAt:new Date().toISOString(),sourceRoot,node:process.version,sourceSha256:code});
  await save();
  if(!allPhases.every(name=>journal.phases[name])||!journal.ownedMerchantClosed||!journal.ownedWorkbenchesClosed){
    await configure();
    await phase('source_and_configuration',async()=>({
      configuration:merchantConfiguration,connectionSha256:digest(await readSourceFile(configurationFile,{privateFile:true})),
      originalResultSha256:journal.original.sha256,originalRunId:original.runId,
      loadedProviderSourceSha256:code,newPaymentTransactions:0,
    }));
    await phase('original_provider_borrow',async()=>{
      const c=await currentMerchant(),opened=await c.workbenchOpen({workspace:'original'});
      assert.equal(opened.ownership,'BORROWED');assert.equal(opened.instanceId,sender.instanceId);
      const tools=merchant.operator.tools.filter(tool=>tool.name.startsWith(TOOL_PREFIX));
      assert.equal(tools.length,20);
      const state=await snapshot('original');assert.equal(state.id,sender.workbenchId);
      assert.equal(state.newPayments,0);assert.equal(state.signingConnected,false);
      return {workbenchId:state.id,ownership:opened.ownership,tools:tools.map(t=>t.name),
        retainedSelectionIds:state.selections.map(s=>s.id)};
    });
    await phase('original_review_receive_replay',async()=>{
      const c=await currentMerchant();await c.workbenchOpen({workspace:'original'});
      const state=await snapshot('original'),selection=state.selections.find(s=>s.id===senderSelection);assert(selection);
      const bundled=await readSourceFile(fileURLToPath(new URL('../hpd-purchase.json',import.meta.url)));
      assert.equal(digest(bundled),original.phases.original_packet_review.packetSha256);
      const reviewed=await originalMutation('original','review','original_packet_review','/api/review',
        {source:'bundled',title:selection.title});
      assert.equal(reviewed.value.replayed,true);assert.equal(reviewed.value.selection.id,senderSelection);
      const received=await originalMutation('original','receive','original_native_receive','/api/receive');
      assert.equal(received.value.replayed,true);
      const after=await snapshot('original');assert.equal(after.selections.length,state.selections.length);
      return {selectionId:senderSelection,reviewActionId:reviewed.value.actionId,receiveActionId:received.value.actionId,
        selectionsBefore:state.selections.length,selectionsAfter:after.selections.length,replayed:true};
    });
    await phase('both_complete_native_results',async()=>{
      await ensureBuyer('original',senderSelection);const c=await currentMerchant(),results=[];
      for(const [name,label]of [['complete_primary_result','primary'],['complete_earlier_result','earlier']]){
        const expected=original.phases[name],descriptor=await c.buyerResult({workspace:'original',quoteId:expected.quoteId}),
          item=descriptor.files.find(item=>item.name==='saved-result.json');
        assert.equal(item.bytes,expected.bytes);assert.equal(item.sha256,expected.sha256);
        const downloaded=await completeFile(descriptor,'saved-result.json',label);
        const status=await value(await c.buyerRead({workspace:'original',tool:'bazaar_status',
          arguments:{quoteId:expected.quoteId}}));
        assert.equal(status.status,expected.status);assert.equal(status.attempts,1);
        results.push({quoteId:expected.quoteId,status:status.status,attempts:status.attempts,...downloaded});
      }
      const state=await c.state({workspace:'original'}),page=await c.json({workspace:'original',
        exportId:state.exportId,file:'original-response.json',expectedManifestSha256:state.manifestSha256,
        pointer:'/operations',offset:0,limit:1});
      assert.equal(page.type,'array');assert.equal(page.value.length,1);
      return {results,originalHistoryPage:page,sourcePaymentsUnchanged:true};
    });
    await phase('original_source_document',async()=>{
      const c=await currentMerchant();await c.workbenchOpen({workspace:'original'});
      const selected=await value(await c.selection({workspace:'original',selectionId:senderSelection})),
        expected=selected.packet.documents[0];assert(expected);
      const descriptor=await c.document({workspace:'original',selectionId:senderSelection,index:0}),
        item=descriptor.files[0];assert.equal(item.sha256,expected.sha256);assert.equal(item.bytes,expected.bytes);
      return {originalPath:expected.path,...await completeFile(descriptor,item.name,'original-source')};
    });
    await phase('original_accepted_export',async()=>{
      await ensureBuyer('original',senderSelection);
      const c=await currentMerchant(),closed=await mutation('sender-close-for-handover','buyer_close',{workspace:'original'});
      assert.equal(closed.value.buyer.active,false);
      const exported=await originalMutation('original','export','closed_native_export','/api/export');
      assert.equal(exported.value.replayed,true);assert.equal(exported.value.export.sha256,originalPacket.export.sha256);
      assert.equal(exported.value.export.packetId,originalPacket.export.packetId);
      const item=exported.result.files.find(item=>item.name==='grant-reviewer-packet.json');
      assert.equal(item.sha256,originalPacket.export.sha256);
      const action=await value(await c.action({workspace:'original',requestId:originalPacket.actionId}));
      assert.equal(action.operation.state,'COMPLETED');assert.equal(action.buyer.active,false);
      return {descriptor:exported.result,packetId:exported.value.export.packetId,
        originalExportActionId:originalPacket.actionId,closeActionId:closed.value.actionId};
    });
    await phase('durable_download_interruption',async()=>{
      const descriptor=journal.phases.original_accepted_export.descriptor,directory=join(root,'downloads','original-handover');
      if(journal.downloadInterruption)return journal.downloadInterruption;
      const controller=new AbortController();let interrupted=false;
      try{
        await downloadReviewerExport({client:await currentMerchant(),workspace:'original',exportId:descriptor.exportId,
          expectedManifestSha256:descriptor.manifestSha256,directory,chunkSize:16384,
          signal:AbortSignal.any([abort.signal,controller.signal]),onProgress:async progress=>{
            if(progress.file==='grant-reviewer-packet.json' && progress.bytes>=32768 && progress.bytes<progress.total){
              journal.downloadInterruption={directory,exportId:descriptor.exportId,manifestSha256:descriptor.manifestSha256,
                file:progress.file,checkpointBytes:progress.bytes,totalBytes:progress.total};
              await save();controller.abort(new Error('Intentional original durable-download receiving interruption.'));
            }
          }});
      }catch(error){
        if(!controller.signal.aborted)throw error;interrupted=true;
      }
      assert(interrupted);assert(journal.downloadInterruption);
      const state=decode(await readSourceFile(join(directory,'download-state','checkpoint.json'),{privateFile:true}));
      assert(state.files['grant-reviewer-packet.json'].bytes>=32768);
      return {...journal.downloadInterruption,retainedCheckpointBytes:state.files['grant-reviewer-packet.json'].bytes};
    });
    await phase('merchant_restart_and_complete_resume',async()=>{
      const c=await currentMerchant(),before=await c.workbenchOpen({workspace:'original'});
      assert.equal(before.ownership,'BORROWED');
      const oldUrl=merchant.url;await closeMerchant();
      const health=await fetch(sender.url+'health');assert.equal((await health.json()).instanceId,sender.instanceId);
      const resumed=await currentMerchant(),after=await resumed.workbenchOpen({workspace:'original'});
      assert.equal(after.instanceId,sender.instanceId);assert.equal(after.ownership,'BORROWED');
      const descriptor=journal.phases.original_accepted_export.descriptor,
        receipt=await downloadReviewerExport({client:resumed,workspace:'original',exportId:descriptor.exportId,
          expectedManifestSha256:descriptor.manifestSha256,directory:journal.downloadInterruption.directory,
          signal:abort.signal});
      assert.equal(receipt.resumed,true);assert(receipt.resumedBytes>=journal.downloadInterruption.checkpointBytes);
      const bytes=await readSourceFile(join(receipt.directory,'grant-reviewer-packet.json'),{privateFile:true});
      assert.equal(digest(bytes),originalPacket.export.sha256);
      return {receipt,merchantListenerChanged:oldUrl!==merchant.url,originalWorkbenchSurvived:true,
        originalWorkbenchId:after.workbenchId,packetSha256:digest(bytes)};
    });
    await phase('receiver_file_intake_and_original_receive',async()=>{
      const c=await currentMerchant(),opened=await c.workbenchOpen({workspace:'receiver'});
      assert.equal(opened.ownership,'OWNED');
      const state=await snapshot('receiver'),selection=state.selections.find(s=>s.id===receiverSelection);assert(selection);
      const descriptor=journal.phases.original_accepted_export.descriptor,
        request=priorRequest('second_operator_packet_intake','/api/review');
      const reviewed=await value(await c.reviewExport({workspace:'receiver',sourceWorkspace:'original',
        exportId:descriptor.exportId,expectedManifestSha256:descriptor.manifestSha256,title:selection.title,requestId:request.id}));
      assert.equal(reviewed.replayed,true);assert.equal(reviewed.selection.id,receiverSelection);
      const local=await value(await c.reviewFile({workspace:'receiver',
        file:join(journal.downloadInterruption.directory,'grant-reviewer-packet.json'),
        title:selection.title,requestId:request.id,expectedSha256:originalPacket.export.sha256}));
      assert.equal(local.replayed,true);assert.equal(local.selection.id,receiverSelection);
      const received=await originalMutation('receiver','receive','second_operator_native_receive','/api/receive');
      assert.equal(received.value.replayed,true);
      await ensureBuyer('receiver',receiverSelection);
      const expected=original.phases.complete_primary_result,
        result=await c.buyerResult({workspace:'receiver',quoteId:expected.quoteId});
      assert.equal(result.files[0].sha256,expected.sha256);
      return {selectionId:receiverSelection,workbenchId:opened.workbenchId,ownership:opened.ownership,
        reviewActionId:request.id,receiveActionId:received.value.actionId,
        originalPacketSha256:originalPacket.export.sha256,
        completeOriginalResult:await completeFile(result,'saved-result.json','receiver-primary')};
    });
    await phase('receiver_native_reopen',async()=>{
      const c=await currentMerchant(),before=await c.workbenchOpen({workspace:'receiver'}),
        released=await c.workbenchRelease({workspace:'receiver'});
      assert.equal(released.originalWorkbenchClosed,true);
      const reopened=await c.workbenchOpen({workspace:'receiver'});
      assert.equal(reopened.workbenchId,before.workbenchId);assert.notEqual(reopened.instanceId,before.instanceId);
      const request=priorRequest('second_operator_native_receive','/api/open'),
        historical=await value(await c.buyerOpen({workspace:'receiver',selectionId:request.selectionId,
          expectedRevision:request.expectedRevision,requestId:request.id}));
      assert.equal(historical.replayed,true);assert.equal(historical.buyer.active,false);
      assert.equal(historical.recordedResult.buyer.active,true);
      await ensureBuyer('receiver',receiverSelection);
      const expected=original.phases.complete_primary_result,status=await value(await c.buyerRead({
        workspace:'receiver',tool:'bazaar_status',arguments:{quoteId:expected.quoteId}}));
      assert.equal(status.status,expected.status);assert.equal(status.attempts,1);
      return {workbenchId:reopened.workbenchId,originalReceiptReportsCurrentClosed:true,
        freshNativeInstance:true,quoteId:expected.quoteId,status:status.status,attempts:status.attempts};
    });
    await phase('owned_and_borrowed_shutdown',async()=>{
      const c=await currentMerchant();await c.workbenchOpen({workspace:'receiver'});
      const owned=await c.workbenchRelease({workspace:'receiver'}),
        borrowed=await c.workbenchRelease({workspace:'original'});
      assert.equal(owned.originalWorkbenchClosed,true);assert.equal(borrowed.originalWorkbenchClosed,false);
      await closeMerchant();
      const health=await fetch(sender.url+'health');assert.equal((await health.json()).instanceId,sender.instanceId);
      return {ownedWorkbenchClosed:true,borrowedWorkbenchStillOwnedByOriginal:true,merchantClosed:true};
    });
    await phase('cold_file_receiving',async()=>{
      assert.equal(merchant,null);
      const descriptor=journal.phases.original_accepted_export.descriptor,
        receipt=await reopenReviewerExport({workspace:'original',exportId:descriptor.exportId,
          expectedManifestSha256:descriptor.manifestSha256,directory:journal.downloadInterruption.directory}),
        bytes=await readSourceFile(join(receipt.directory,'grant-reviewer-packet.json'),{privateFile:true});
      assert.equal(digest(bytes),originalPacket.export.sha256);
      return {receipt,packetSha256:digest(bytes),noListenerRequired:true};
    });
  }
}catch(error){
  thrown=error;journal.state='CONTINUATION_REQUIRED';journal.error={phase:activePhase,code:error.code??error.name,message:error.message};
  await save().catch(()=>{});
}finally{
  try{await closeMerchant();journal.ownedMerchantClosed=true;}
  catch(error){thrown??=error;journal.ownedMerchantClosed=false;}
  try{if(sender){await sender.close();sender=null;}journal.ownedWorkbenchesClosed=journal.ownedMerchantClosed;}
  catch(error){thrown??=error;journal.ownedWorkbenchesClosed=false;}
  journal.closedAt=new Date().toISOString();await save().catch(error=>{thrown??=error;});
  process.off('SIGINT',stop);process.off('SIGTERM',stop);
}
try{
  if(thrown)throw thrown;
  assert(allPhases.every(name=>journal.phases[name]));
  assert(journal.ownedMerchantClosed&&journal.ownedWorkbenchesClosed);
  journal.state='COMPLETE';journal.completedAt=new Date().toISOString();delete journal.error;
  const result={...journal,schema:'stellar-forge.grant-reviewer-merchant-receiving-result.v1',
    originalPurchaseTransactions:original.originalPurchaseTransactions,originalQuoteAttempts:original.originalQuoteAttempts,
    newPaymentTransactions:0};
  await writeSourceFile(resultFile,encode(result),{replace:true});await save();
  process.stdout.write(JSON.stringify({state:'COMPLETE',phases:allPhases.length,resultFile,
    sha256:digest(await readFile(resultFile)),ownedMerchantClosed:true,ownedWorkbenchesClosed:true,newPaymentTransactions:0})+'\n');
}finally{await lease.close();}
