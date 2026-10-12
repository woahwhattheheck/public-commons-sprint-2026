import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdir,writeFile,readFile,rename,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

// The original merchant operation accepts a selected source and an owned output path.
// It keeps the original Stellar XDR, transaction amounts, transfer dates and SF86 calls.
export async function runOriginalMerchantOperation(input) {
assert.ok(input && typeof input === 'object' && !Array.isArray(input));
assert.ok(typeof input.sourceRoot === 'string' && typeof input.directory === 'string');
const sourceRoot=await realpath(resolve(input.sourceRoot));
const source=join(sourceRoot,'stellar/scf-starforge-20261009');
const dependencyPackageJson=await realpath(resolve(input.dependencyPackageJson??join(input.runtimeDirectory,'package.json')));
const sdk=createRequire(dependencyPackageJson)('@stellar/stellar-sdk');
const {compileSellerRoutes}=await import(pathToFileURL(source+'/sf30-seller-sdk/resource-server.mjs').href);
const {nativeEvent,openOutbox}=await import(pathToFileURL(source+'/sf98-merchant-delivery/outbox.mjs').href);
const {reconcileReportedReceipt}=await import(pathToFileURL(source+'/sf86-rpc-transfer-reconcile/verify.mjs').href);
const {RPC_NETWORKS}=await import(pathToFileURL(source+'/sf86-rpc-transfer-reconcile/terms.mjs').href);
const {createOfficialEventDecoder}=await import(pathToFileURL(source+'/sf43-agent-commerce/verify.mjs').href);
const {startAccountingWorkspace}=await import(pathToFileURL(source+'/merchant-settlement-accounting/workspace/server.mjs').href);
const {createHandoff,renderCsv,parseReturnCsv,accountantColumns,CSV_COLUMNS,importReturn}=await import(pathToFileURL(source+'/merchant-settlement-accounting/accountant/engine.mjs').href);
const exec=promisify(execFile),hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const root=resolve(input.directory);
await mkdir(root,{mode:0o700});
assert.equal(await realpath(root),root);
const buyer=sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32,11));
const merchant=sdk.StrKey.encodeEd25519PublicKey(Buffer.alloc(32,12));
const asset=sdk.StrKey.encodeContract(Buffer.alloc(32,13));
const network='stellar:testnet',profile=RPC_NETWORKS[network];
const payment={scheme:'exact',network,asset,payTo:merchant,amount:'100',maxTimeoutSeconds:60};
const transactions={purchase:hash('dd7a-original-native-payment'),partial:hash('dd7a-reverse-partial'),bad:hash('dd7a-reverse-wrong-recipient'),full:hash('dd7a-reverse-remaining')};
const transferDefinitions=[
  {transaction:transactions.purchase,ledger:501,from:buyer,to:merchant,amount:'100',at:'2026-10-11T12:00:00.000Z'},
  {transaction:transactions.partial,ledger:502,from:merchant,to:buyer,amount:'40',at:'2026-10-11T13:00:00.000Z'},
  {transaction:transactions.bad,ledger:503,from:merchant,to:merchant,amount:'10',at:'2026-10-11T13:10:00.000Z'},
  {transaction:transactions.full,ledger:504,from:merchant,to:buyer,amount:'60',at:'2026-10-11T14:00:00.000Z'}
];
const encode=value=>value.toXDR('base64');
const nativeEventFor=transfer=>({id:transfer.ledger+'-0000000001-0000000000',ledger:transfer.ledger,
  txHash:transfer.transaction,contractId:asset,inSuccessfulContractCall:true,
  topic:[encode(sdk.xdr.ScVal.scvSymbol('transfer')),encode(new sdk.Address(transfer.from).toScVal()),encode(new sdk.Address(transfer.to).toScVal())],
  value:encode(sdk.nativeToScVal(BigInt(transfer.amount),{type:'i128'}))});
const rpcReads=[];
async function nativeRpcRead(url,options){
  assert.equal(String(url),profile.defaultEndpoint);options.signal?.throwIfAborted();
  const request=JSON.parse(options.body);rpcReads.push({method:request.method,params:request.params});let result;
  if(request.method==='getNetwork')result={passphrase:profile.passphrase,protocolVersion:23};
  else if(request.method==='getTransaction'){
    const transfer=transferDefinitions.find(item=>item.transaction===request.params.hash);assert.ok(transfer);
    result={status:'SUCCESS',txHash:transfer.transaction,ledger:transfer.ledger,createdAt:String(Date.parse(transfer.at)/1000)};
  }else if(request.method==='getEvents'){
    const transfer=transferDefinitions.find(item=>item.ledger===request.params.startLedger);assert.ok(transfer);
    result={events:[nativeEventFor(transfer)],latestLedger:504,cursor:String(transfer.ledger)+'-end'};
  }else throw new Error('Unexpected native RPC method: '+request.method);
  return new Response(JSON.stringify({jsonrpc:'2.0',id:request.id,result}),{status:200,headers:{'Content-Type':'application/json'}});
}
let app,workspace,runId,eventId,closedHandoffId,firstHandoffId,firstReturnId,closedId,refundJobId;
const receipts={root,source,sourceRoot,sourceCommit:input.sourceCommit??null,
  sourceConfiguration:{dependencyPackageJson,dependencyPackageSha256:hash(await readFile(dependencyPackageJson)),
    nodeExecutable:process.execPath,bitwaveContinuation:input.bitwaveContinuation?resolve(input.bitwaveContinuation):null},
  startedAt:new Date().toISOString(),transport:'Controlled RPC responses decoded through the original Stellar SDK and original SF86 read path',phases:[]};
const retain=async()=>{const temporary=join(root,'.operation-'+randomUUID()+'.json');await writeFile(temporary,json(receipts),{mode:0o600,flag:'wx'});await rename(temporary,join(root,'operation.json'));};
async function request(path,value){
  const response=await fetch(app.url+path,{method:value===undefined?'GET':'POST',redirect:'error',
    ...(value===undefined?{}:{headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(value)}),signal:AbortSignal.timeout(20_000)});
  const body=await response.json();
  if(!response.ok)throw Object.assign(new Error(body.message??body.error??'Workspace operation failed'),{code:body.error,status:response.status,body});
  return body;
}
const revision=()=>workspace.state.revision;
async function createAdjustment(kind,amount,reason){
  const preview=await request('/api/adjustments/preview',{runId,eventId,kind,amountAtomic:amount,
    effectiveAt:'2026-10-11T12:30:00.000Z',reason,reference:'order-dd7a',actor:'native merchant operation'});
  const value={...preview.request,revision:preview.workspaceRevision,previewSha256:preview.previewSha256};
  const saved=await request('/api/adjustments/record',value);
  assert.equal((await request('/api/adjustments/record',value)).duplicate,true);
  return saved.adjustment;
}
async function verifyRefund(record,transaction){
  const value={revision:revision(),actor:'native merchant operation',transaction};
  const result=await request('/api/adjustments/'+record.id+'/verify',value);
  const job=await workspace.adjustments.waitForJob(result.job.id);
  assert.equal((await request('/api/adjustments/jobs/'+job.id)).id,job.id);
  return {result,job};
}
async function withdraw(record,reason){return request('/api/adjustments/'+record.id+'/withdraw',{revision:revision(),actor:'native merchant operation',reason});}
function editCsv(handoff,changes){
  const parsed=parseReturnCsv(renderCsv(handoff),{columns:accountantColumns(handoff)});
  const row=parsed.records.find(item=>item.values.some(Boolean)),values=[...row.values];
  for(const [key,value] of Object.entries(changes)){const index=parsed.headers.indexOf(key);assert.ok(index>=0);values[index]=value;}
  const quote=value=>'"'+String(value).replaceAll('"','""')+'"';
  return Buffer.from([parsed.headers.map(quote).join(','),values.map(quote).join(',')].join('\r\n')+'\r\n');
}
async function start(options){
  app=await startAccountingWorkspace({port:0,directory:join(root,'workspace'),...options});
  workspace=app.workspace;workspace.adjustments.options.fetchImpl=nativeRpcRead;return app;
}

try{
  const outboxDir=join(root,'outbox'),proofDir=join(root,'proofs'),termsFile=join(root,'terms.json');
  await mkdir(proofDir,{mode:0o700});const outbox=await openOutbox(outboxDir);
  const compiled=compileSellerRoutes([{id:'merchant_report',definition:{method:'GET',url:'https://merchant.example/report',
    description:'Retained merchant reporting operation',payment},handler:()=>({ok:true})}]);
  const receipt={success:true,network,payer:buyer,transaction:transactions.purchase,amount:'100'};
  const captured=nativeEvent(compiled,[null,payment,null,{request:{method:'GET',path:'/report',adapter:{getHeader:()=> 'order-dd7a'}}}],
    {success:true,headers:{'payment-response':json(receipt).toString('base64')}},'2026-10-11T12:00:01.000Z');
  assert.ok(captured);eventId=captured.id;await outbox.record(captured);
  await outbox.recordDelivery({id:eventId,state:'DELIVERED',attempt:1,at:'2026-10-11T12:00:02.000Z',nextAt:null});
  const proof=await reconcileReportedReceipt({intentId:'dd7a-retained-original-payment',requirement:payment,receipt,payer:buyer,
    fetchImpl:nativeRpcRead,decodeContractEvent:await createOfficialEventDecoder()});
  await writeFile(join(proofDir,'original-sf86.json'),json(proof),{mode:0o600});
  await writeFile(termsFile,json({schema:'stellar-forge.merchant-accounting-terms.v1',routes:[{routeId:'merchant_report',method:'GET',network,asset,payTo:merchant,
    amountAtomic:'100',unitPriceUsd:null,unitCostUsd:null,priceBasis:'Merchant original quote'}]}),{mode:0o600});
  const nativeInputs={'events.ndjson':hash(await readFile(join(outboxDir,'events.ndjson'))),'proof.json':hash(await readFile(join(proofDir,'original-sf86.json')))};
  await start({outboxDir,proofDir,termsFile});
  await workspace.periods.save({revision:revision(),name:'October 11 recorded activity',from:'2026-10-11T00:00:00.000Z',until:'2026-10-12T00:00:00.000Z',select:true,actor:'native merchant operation'});
  const begun=await workspace.begin({revision:revision(),name:'Original merchant operation',actor:'native merchant operation'});runId=begun.run.id;
  await Promise.all([...workspace.tasks]);assert.equal(workspace.runRow(runId).status,'complete',workspace.runRow(runId).error);
  const originalReport=await workspace.reportFile(runId,'report.json'),originalReportSha=hash(originalReport);
  assert.equal((await workspace.report(runId)).ledger[0].transfer,'OFFICIAL_TRANSFER_MATCHED');
  const legacySource={runId,reportSha256:originalReportSha,manifestSha256:workspace.runRow(runId).manifestSha256,inputManifestSha256:workspace.runRow(runId).inputManifestSha256};
  const legacy=createHandoff({reportBytes:originalReport,source:legacySource,name:'Legacy report-only handoff',actor:'native merchant operation'});
  assert.deepEqual(accountantColumns(legacy),[...CSV_COLUMNS]);
  assert.equal(importReturn({handoff:legacy,csvBytes:editCsv(legacy,{externalStatus:'REVIEWED'}),actor:'native accountant',name:'Legacy return'}).summary.appliedRows,1);
  receipts.phases.push({phase:'original capture and reconciliation',runId,eventId,reportSha256:originalReportSha,legacyColumns:CSV_COLUMNS.length});
  await createAdjustment('CANCELLATION','100','Merchant cancelled the original order');
  const first=await createAdjustment('REFUND','40','Return the first part of the original payment');
  const {result:firstVerification,job:firstJob}=await verifyRefund(first,transactions.partial);assert.equal(firstJob.status,'COMPLETED');
  assert.equal(firstJob.result.verification.transferAt,'2026-10-11T13:00:00.000Z');
  assert.equal((await request('/api/adjustments/'+first.id+'/verify',{revision:revision(),actor:'native merchant operation',transaction:transactions.partial})).job.id,firstVerification.job.id);
  const bad=await createAdjustment('REFUND','10','Review a supplied reverse transfer');
  const failed=await verifyRefund(bad,transactions.bad);assert.equal(failed.job.status,'FAILED');assert.equal(failed.job.error.code,'NO_EXACT_TRANSFER');
  await withdraw(bad,'Withdraw the request after the native recipient did not match');
  const reused=await createAdjustment('REFUND','10','Inspect transaction reuse against another request');
  await assert.rejects(request('/api/adjustments/'+reused.id+'/verify',{revision:revision(),actor:'native merchant operation',transaction:transactions.partial}),error=>error.code==='REFUND_TRANSACTION_ALREADY_ASSIGNED');
  await withdraw(reused,'Retain the original verified refund assignment');
  const partial=(await workspace.adjustments.event(runId,eventId)).totals;
  assert.equal(partial.grossAmountAtomic,'100');assert.equal(partial.refundedAmountAtomic,'40');assert.equal(partial.pendingRefundAmountAtomic,'0');assert.equal(partial.remainingAmountAtomic,'60');assert.equal(partial.cancelledAmountAtomic,'100');
  receipts.phases.push({phase:'merchant adjustments',partial,nativeWrongRecipient:failed.job.error.code,reusedTransaction:'original assignment retained'});
  const handoff=await request('/api/accountant/handoffs',{revision:revision(),runId,name:'Original partial refund handoff',actor:'native merchant operation'});
  firstHandoffId=handoff.record.id;const frozen=await app.accountant.readHandoff(firstHandoffId),frozenBytes=(await app.accountant.file(firstHandoffId,'adjustments.json',{revisionId:'initial'})).bytes;
  assert.equal(frozen.rows[0].adjustments.refundedAmountAtomic,'40');
  const tampered=await app.accountant.preview(firstHandoffId,{expectedParentId:null,name:'Protected amount edit',actor:'native accountant',csvBase64:editCsv(frozen,{refundedAmountAtomic:'41',externalStatus:'REVIEWED'}).toString('base64')});
  assert.equal(tampered.revision.summary.conflictRows,1);assert.equal(tampered.revision.results[0].status,'PROTECTED_VALUE_CONFLICT');
  const returned={id:randomUUID(),createdAt:new Date().toISOString(),expectedParentId:null,name:'Merchant bookkeeping return',actor:'native accountant',
    csvBase64:editCsv(frozen,{externalStatus:'BOOKED',externalBookRef:'BOOK-DD7A-001',externalAccountCode:'Merchant refunds',externalNote:'Original gross and verified partial refund retained'}).toString('base64')};
  const review=await request('/api/accountant/handoffs/'+firstHandoffId+'/preview',returned);assert.equal(review.revision.summary.appliedRows,1);
  const saved=await request('/api/accountant/handoffs/'+firstHandoffId+'/returns',{...returned,revision:review.workspaceRevision,previewSha256:review.revision.integrity.sha256});
  firstReturnId=saved.savedReturn.id;
  assert.equal(hash((await app.accountant.file(firstHandoffId,'adjustments.json',{revisionId:firstReturnId})).bytes),hash(frozenBytes));
  const closed=await workspace.periods.retainClose({revision:revision(),runId,name:'Partial refund period close',actor:'native merchant operation'});closedId=closed.close.id;
  const closeBytes=(await workspace.periods.file(closedId,'adjustments.json')).bytes,closeHash=hash(closeBytes);assert.equal(closeHash,closed.close.adjustmentsSha256);
  receipts.phases.push({phase:'accountant and frozen period',handoffId:firstHandoffId,returnId:firstReturnId,closeId:closedId,closedAdjustmentSha256:closeHash,protectedEdit:'conflict preserved'});
  const final=await createAdjustment('REFUND','60','Return the remaining original payment');
  const actualCommit=workspace.commit.bind(workspace);let injected=false;
  workspace.commit=async(action,...args)=>{if(action==='merchant_refund_verified'&&!injected){injected=true;throw Object.assign(new Error('Native operation: interrupt state commit after complete proof save'),{code:'OPERATION_INTERRUPTED_COMMIT'});}return actualCommit(action,...args);};
  const finalQueued=await request('/api/adjustments/'+final.id+'/verify',{revision:revision(),actor:'native merchant operation',transaction:transactions.full});refundJobId=finalQueued.job.id;
  await Promise.all([...workspace.tasks]);assert.equal(workspace.adjustments.job(refundJobId).status,'FAILED');
  const retainedProofBytes=await readFile(join(workspace.directory,'adjustments',final.id,refundJobId+'.proof.json'));
  const readsBeforeReopen=rpcReads.length;await app.close();app=null;
  await start();assert.equal(rpcReads.length,readsBeforeReopen);
  const recovered=await request('/api/adjustments/jobs/'+refundJobId);assert.equal(recovered.status,'COMPLETED');assert.equal(recovered.result.recovered,true);
  assert.equal(hash(retainedProofBytes),recovered.result.verification.sha256);
  const complete=(await workspace.adjustments.event(runId,eventId)).totals;assert.equal(complete.refundedAmountAtomic,'100');assert.equal(complete.remainingAmountAtomic,'0');assert.equal(complete.refundStatus,'FULL');
  assert.equal(hash(await workspace.reportFile(runId,'report.json')),originalReportSha);
  assert.equal(hash((await workspace.periods.file(closedId,'adjustments.json')).bytes),closeHash);
  assert.equal(hash((await app.accountant.file(firstHandoffId,'adjustments.json',{revisionId:firstReturnId})).bytes),hash(frozenBytes));
  const selectedClose=await request('/api/accountant/handoffs',{revision:revision(),runId,closeId:closedId,name:'Closed period after later refund',actor:'native merchant operation'});
  closedHandoffId=selectedClose.record.id;const reopenedFrozen=await app.accountant.readHandoff(closedHandoffId);
  assert.equal(reopenedFrozen.rows[0].adjustments.refundedAmountAtomic,'40');assert.equal(reopenedFrozen.rows[0].adjustments.remainingAmountAtomic,'60');assert.equal(reopenedFrozen.source.adjustments.sha256,closeHash);
  const fullExport=await workspace.exportRun(runId,{revision:revision(),actor:'native merchant operation',includeSources:true});
  const members=(await exec('tar',['-tf',join(workspace.directory,'exports',fullExport.export.id+'.tar')])).stdout.split('\n');
  for(const name of ['adjustments.json','adjustments.csv','adjustments.html'])assert.ok(members.some(value=>value===name||value==='./'+name));
  assert.equal(hash(await readFile(join(outboxDir,'events.ndjson'))),nativeInputs['events.ndjson']);assert.equal(hash(await readFile(join(proofDir,'original-sf86.json'))),nativeInputs['proof.json']);
  const cli=await exec(process.execPath,[source+'/merchant-settlement-accounting/workspace/server.mjs','adjustments','event','--url',app.url,'--run',runId,'--event',eventId]);
  assert.equal(JSON.parse(cli.stdout).totals.refundedAmountAtomic,'100');
  for(const path of ['/','/adjustments.html','/adjustments.mjs','/adjustments.css'])assert.equal((await fetch(app.url+path)).status,200);
  receipts.phases.push({phase:'native result recovery and frozen reopen',refundJobId,nativeReads:rpcReads.length,recoveredProofSha256:hash(retainedProofBytes),complete,closedHandoffId,exportId:fullExport.export.id,archiveMembers:members.filter(Boolean),runningOwnerCli:'complete'});
  receipts.url=app.url;receipts.runId=runId;receipts.eventId=eventId;receipts.closedHandoffId=closedHandoffId;await retain();
  console.log(JSON.stringify({state:'READY_FOR_BROWSER_AND_BITWAVE',url:app.url,root,runId,eventId,closedHandoffId,refundJobId,phases:receipts.phases.length}));
  if(input.bitwaveContinuation){
    const {continueBitwave}=await import(pathToFileURL(resolve(input.bitwaveContinuation)).href);
    const result=await continueBitwave({app,workspace,accountant:app.accountant,closedHandoffId,runId,request,root,assert});
    receipts.phases.push({phase:'Bitwave continuation',...result});await retain();
    console.log(JSON.stringify({state:'BITWAVE_COMPLETE',result}));
  }
  await app.close();app=null;
  const direct=await exec(process.execPath,[source+'/merchant-settlement-accounting/workspace/server.mjs','adjustments','event','--workspace',join(root,'workspace'),'--run',runId,'--event',eventId]);
  assert.equal(JSON.parse(direct.stdout).totals.refundedAmountAtomic,'100');
  receipts.result='PASS';receipts.finishedAt=new Date().toISOString();receipts.stoppedOwnerCli='complete';receipts.nativeRpcMethods=[...new Set(rpcReads.map(item=>item.method))];await retain();
  console.log(JSON.stringify({result:'PASS',root,phases:receipts.phases.length,receipt:join(root,'operation.json'),nativeReads:rpcReads.length,stoppedOwnerCli:'complete'}));
  return receipts;
}catch(error){receipts.result='FAILED';receipts.error={message:error.message,code:error.code,stack:error.stack};await retain();throw error;}
finally{await app?.close();}
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);assert.equal(args.length,1,'Provide one operation configuration JSON path');
  runOriginalMerchantOperation(JSON.parse(await readFile(resolve(args[0]),'utf8'))).catch(error=>{console.error(error.stack??error);process.exitCode=1;});
}
