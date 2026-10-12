// MIT. Privileged one-attempt adapter to the original SF36 finality worker.
// Key values remain in this child. This module never loads a signer or buyer.
import {lstat,realpath} from 'node:fs/promises';
import {join,dirname,resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {absolute,digest,jsonBytes,parseJson,readBytes,need,object,safeCode} from './store.mjs';
import {OPERATION_ACCOUNTING_COMMAND,OPERATION_ACCOUNTING_NATIVE,sameAccountingValue,
  accountingPrivateDirectory,accountingPrivateFile,readOperationAccountingSource} from './operation-accounting.mjs';

const HASH=/^[a-f0-9]{64}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const requestFields=['request_id','actor','service','network','asset','scheme','max_amount','resource',
  'pay_to','max_timeout_seconds','method','body_present','body_bytes','body_sha256','accepted_terms_sha256'].sort();
const here=fileURLToPath(import.meta.url);
const time=value=>typeof value==='string'&&Number.isFinite(Date.parse(value));
const importOriginal=(root,name)=>import(pathToFileURL(resolve(root,name)).href);

async function verifyCode(descriptor){
  need(object(descriptor)&&absolute(descriptor.path)===descriptor.path&&
    await realpath(descriptor.path)===descriptor.path&&HASH.test(descriptor.sha256??'')&&
    Number.isSafeInteger(descriptor.bytes)&&descriptor.bytes>=0,
    'ACCOUNTING_IMPLEMENTATION_SOURCE_INVALID');
  const info=await lstat(descriptor.path);
  need(info.isFile()&&(info.mode&0o022)===0,'ACCOUNTING_IMPLEMENTATION_SOURCE_INVALID');
  const raw=await readBytes(descriptor.path,16_777_216);
  need(raw.length===descriptor.bytes&&digest(raw)===descriptor.sha256,'ACCOUNTING_IMPLEMENTATION_CHANGED');
}

async function verifySavedSource(context,current){
  need(sameAccountingValue(current.identity,context.identity),'ACCOUNTING_ORIGINAL_ATTEMPT_CHANGED');
  for(const name of ['operation','configuration','body','ticket','evidence'])
    need(sameAccountingValue(current.files[name],context.source[name]),'ACCOUNTING_ORIGINAL_SOURCE_CHANGED');
  const original=await accountingPrivateFile(join(context.commandDirectory,'attempt-source.json'),65536);
  const evidence=await accountingPrivateFile(join(context.commandDirectory,'evidence-source.json'),4_194_304);
  need(original.descriptor.sha256===context.source.attempt.sha256&&
    evidence.descriptor.sha256===context.source.evidence.sha256,
    'ACCOUNTING_ARCHIVED_SOURCE_CHANGED');
  const attempt=parseJson(original.raw);
  need(attempt.schema==='stellar-forge.node-buyer.v1'&&attempt.kind===undefined&&
    attempt.intentId===context.identity.intentId&&attempt.createdAt===context.identity.attemptCreatedAt&&
    attempt.configSha256===context.identity.configurationSha256&&
    attempt.bodySha256===context.identity.bodySha256,
    'ACCOUNTING_ARCHIVED_ATTEMPT_CHANGED');
}

async function workspacePins(context){
  for(const key of ['configuration','manifest']){
    const descriptor=context.workspaceSource?.[key];
    need(descriptor?.path===join(context.request.workspaceDirectory,
      key==='configuration'?'operator.json':'workspace.json'),'ACCOUNTING_WORKSPACE_SOURCE_INVALID');
    const source=await accountingPrivateFile(descriptor.path);
    need(sameAccountingValue(source.descriptor,descriptor),'ACCOUNTING_ORIGINAL_WORKSPACE_CHANGED');
  }
}

export async function finalizeSelectedNodeAttempt(contextPath,contextSha256,{signal}={}){
  need(HASH.test(contextSha256??''),'ACCOUNTING_CONTEXT_DIGEST_REQUIRED');
  const input=await accountingPrivateFile(absolute(contextPath),262144),context=parseJson(input.raw);
  need(input.descriptor.sha256===contextSha256&&digest(jsonBytes(context))===contextSha256&&
    context.schema===OPERATION_ACCOUNTING_COMMAND&&
    contextPath===join(context.commandDirectory,'context.json')&&
    /^finalize-[A-Za-z0-9]{6}$/.test(context.commandId??'')&&
    context.commandDirectory===join(context.identity.operationDirectory,'accounting',context.commandId)&&
    context.identity.operationDirectory===join(context.identity.stateDirectory,digest(context.identity.intentId))&&
    time(context.startedAt)&&Number.isSafeInteger(context.resultLimit)&&
    context.resultLimit>=65536&&context.resultLimit<=4_194_304,
    'ACCOUNTING_CONTEXT_CHANGED');
  need(context.execution.worker.path===here&&
    context.execution.adapter.path===fileURLToPath(new URL('./operation-accounting.mjs',import.meta.url))&&
    await realpath(context.execution.node)===await realpath(process.execPath),
    'ACCOUNTING_SELECTED_WORKER_CHANGED');
  await verifyCode(context.execution.worker);await verifyCode(context.execution.adapter);
  const root=absolute(context.execution.runtimeDirectory);
  need(root===context.execution.runtimeDirectory&&await realpath(root)===root,
    'ACCOUNTING_RUNTIME_CANONICAL_PATH_REQUIRED');
  const required=['config.mjs','workspace.mjs','finalization.mjs',
    '../sf36-spend-governor/finalize.py','../sf86-rpc-transfer-reconcile/cli.mjs',
    '../sf86-rpc-transfer-reconcile/terms.mjs'].map(path=>resolve(root,path));
  need(Array.isArray(context.execution.originalSource)&&
    context.execution.originalSource.length===required.length&&
    context.execution.originalSource.every((value,index)=>value.path===required[index]),
    'ACCOUNTING_ORIGINAL_IMPLEMENTATION_REQUIRED');
  for(const descriptor of context.execution.originalSource)await verifyCode(descriptor);

  // The loaded SDK reads its own original Operation contract. Its selected
  // runtime supplies the maintained financial implementation; the producing
  // runtime and exact attempt remain in context.identity.
  const {Buyer}=await import('./client.mjs');
  const buyer=new Buyer({runtimeDirectory:root,stateDirectory:context.identity.stateDirectory,
    node:context.execution.node,environment:process.env,outputLimit:context.resultLimit});
  const operation=buyer.operation(context.identity.intentId);
  const source=await readOperationAccountingSource(operation,{requireEnded:true,signal});
  await verifySavedSource(context,source);
  const [{config,execution},{openWorkspace},financial,{readAttemptWireCheckpoint}]=await Promise.all([
    importOriginal(root,'config.mjs'),importOriginal(root,'workspace.mjs'),
    importOriginal(root,'finalization.mjs'),importOriginal(root,'attempt-wire.mjs'),
  ]);
  need(typeof financial.runOriginalFinalityWorker==='function'&&
    typeof financial.readUnpaidAttempt==='function','ACCOUNTING_ORIGINAL_FINALITY_API_REQUIRED');
  const cfg=await config(operation.configPath),{op,owner,transport}=execution(cfg);
  need(sameAccountingValue(cfg,source.config)&&op.intentId===source.identity.intentId,
    'ACCOUNTING_ORIGINAL_CONFIGURATION_CHANGED');
  const wire=await readAttemptWireCheckpoint({cfg,body:source.identity.bodyPresent?source.body:undefined});
  need(wire===null||wire?.writerActive===false,'ACCOUNTING_PRODUCING_WRITER_LIVE');
  const base={schema:OPERATION_ACCOUNTING_NATIVE,contextSha256,identity:context.identity,
    workspace:context.request.workspaceDirectory,workspaceSource:context.workspaceSource,
    accountingRuntimeDirectory:root,evidencePath:source.evidencePath,
    evidenceSha256:source.files.evidence.sha256,attemptSnapshotSha256:context.source.attempt.sha256,
    observedAttemptSha256:source.files.attempt.sha256,producer:source.producer};
  const unpaid=await financial.readUnpaidAttempt({evidencePath:source.evidencePath,
    intentId:op.intentId,attemptStartedAt:source.identity.attemptCreatedAt});
  if(unpaid!==null){
    await verifySavedSource(context,await readOperationAccountingSource(operation,{requireEnded:true,signal}));
    return{...base,kind:'UNPAID_RESPONSE',approvedRequestSha256:null,result:unpaid,
      completedAt:new Date().toISOString(),recordAuthority:'ORIGINAL_UNSIGNED_RESPONSE'};
  }

  need(typeof context.request.workspaceDirectory==='string',
    'ACCOUNTING_ORIGINAL_WORKSPACE_REQUIRED');
  await accountingPrivateDirectory(context.request.workspaceDirectory);
  await workspacePins(context);
  const active=await openWorkspace(['--dir',context.request.workspaceDirectory]);
  const current=execution(active.config);
  need(['python','actor','service','policy','ledger'].every(key=>owner[key]===current.owner[key])&&
    cfg.trustedPayer===active.config.trustedPayer&&
    sameAccountingValue(transport,current.transport)&&
    ['scheme','network','asset','payTo'].every(key=>op.expect[key]===current.op.expect[key])&&
    (source.identity.nativeWorkspace===null||
      source.identity.nativeWorkspace===active.manifest.directory&&cfg.signerModule===active.config.signerModule),
    'ACCOUNTING_ORIGINAL_OPERATOR_WORKSPACE_MISMATCH');
  // A separately reviewed fromConfig/SF103 signer retains the same authenticated
  // owner, ledger, payer and operation. Historical signer/cap changes do not
  // invalidate a reservation already authenticated by original SF36.
  const [{originalRecordFromEvidence},{checkOriginalTerms,resolveRpcEndpoint},{resolveBuyerProxy}]=await Promise.all([
    importOriginal(root,'../sf86-rpc-transfer-reconcile/cli.mjs'),
    importOriginal(root,'../sf86-rpc-transfer-reconcile/terms.mjs'),
    importOriginal(root,'../sf31-buyer-client/public-transport.mjs'),
  ]);
  const evidence=parseJson(source.evidenceRaw),record=originalRecordFromEvidence(evidence);
  checkOriginalTerms(record,active.config.trustedPayer);
  const approved=record.operatorReservation?.approved_request;
  const approvedSha256=record.operatorReservation?.request_sha256;
  need(object(approved)&&Object.keys(approved).sort().join('\n')===requestFields.join('\n')&&
    HASH.test(approvedSha256??'')&&HASH.test(approved.accepted_terms_sha256??'')&&
    approved.request_id===op.intentId&&approved.actor===owner.actor&&approved.service===owner.service&&
    approved.resource===new URL(op.url).href&&approved.method===op.method&&
    approved.body_present===source.identity.bodyPresent&&approved.body_bytes===source.identity.bodyBytes&&
    approved.body_sha256===source.identity.bodySha256&&
    ['scheme','network','asset'].every(key=>approved[key]===op.expect[key])&&
    approved.pay_to===op.expect.payTo&&/^[1-9][0-9]*$/.test(approved.max_amount??'')&&
    BigInt(approved.max_amount)<=BigInt(op.expect.maxAtomic)&&
    Number.isSafeInteger(approved.max_timeout_seconds)&&approved.max_timeout_seconds>=1&&
    approved.max_timeout_seconds<=86400&&
    (op.expect.maxTimeoutSeconds===undefined||approved.max_timeout_seconds<=op.expect.maxTimeoutSeconds)&&
    evidence.intentId===op.intentId&&time(evidence.observedAt)&&
    Date.parse(evidence.observedAt)>=Date.parse(source.identity.attemptCreatedAt),
    'ACCOUNTING_ORIGINAL_APPROVED_REQUEST_CHANGED');
  need(source.evidencePath===join(cfg.evidenceDir,digest(op.intentId)+'.json')&&
    (source.identity.nativeWorkspace===null||cfg.evidenceDir===active.config.evidenceDir),
    'ACCOUNTING_ORIGINAL_EVIDENCE_DIRECTORY_CHANGED');
  const rpcEndpoint=resolveRpcEndpoint(op.expect.network,active.manifest.signer.rpcUrl);
  let rpcProxyUrl;
  if(current.transport!==null){
    resolveBuyerProxy(current.transport);
    rpcProxyUrl=new URL(current.transport.proxyEnv===undefined?
      current.transport.proxyUrl:process.env[current.transport.proxyEnv]).origin;
  }
  need((context.request.outboxDirectory===null)===(context.request.merchantRoute===null),
    'OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER');
  if(context.request.outboxDirectory!==null){
    await accountingPrivateDirectory(context.request.outboxDirectory);
    need(/^[A-Za-z0-9._:-]{1,160}$/.test(context.request.merchantRoute),
      'ACCOUNTING_MERCHANT_ROUTE_INVALID');
  }
  await workspacePins(context);
  await verifySavedSource(context,await readOperationAccountingSource(operation,{requireEnded:true,signal}));
  const privileged=await openWorkspace(['--dir',context.request.workspaceDirectory],{accounting:true});
  need(sameAccountingValue(privileged.config,active.config)&&
    sameAccountingValue(privileged.manifest,active.manifest),'ACCOUNTING_ORIGINAL_WORKSPACE_CHANGED');
  const reports=await accountingPrivateDirectory(join(context.commandDirectory,'reports'),{create:true});
  const args=['--record',source.evidencePath,'--ledger',owner.ledger,'--policy',owner.policy,
    '--payer',active.config.trustedPayer,'--node',context.execution.node,'--reports',reports,
    '--rpc-endpoint',rpcEndpoint,'--expected-request-sha',approvedSha256,
    ...(rpcProxyUrl===undefined?[]:['--rpc-proxy-env','SF36_RPC_PROXY_URL']),
    ...(context.request.outboxDirectory===null?[]:[
      '--outbox',context.request.outboxDirectory,'--merchant-route',context.request.merchantRoute])];
  const result=await financial.runOriginalFinalityWorker(owner.python,args,
    privileged.operatorEnvironment,signal,rpcProxyUrl);
  if(FINALIZED.has(result.outcome))need(result.request_id===op.intentId&&
    result.request_sha256===approvedSha256,'ACCOUNTING_FINALIZED_REQUEST_CHANGED');
  return{...base,kind:'PAID_FINALIZATION',approvedRequestSha256:approvedSha256,result,
    operator:{python:owner.python,actor:owner.actor,service:owner.service,
      policy:owner.policy,ledger:owner.ledger,payer:active.config.trustedPayer},
    completedAt:new Date().toISOString(),recordAuthority:'ORIGINAL_SF36_LEDGER_RESULT'};
}

async function main(){
  need(process.argv.length===6&&process.argv[2]==='--context'&&
    process.argv[4]==='--context-sha256','ACCOUNTING_WORKER_ARGUMENTS_INVALID');
  const controller=new AbortController();
  const abort=()=>controller.abort();
  process.once('SIGINT',abort);process.once('SIGTERM',abort);
  try{
    const result=await finalizeSelectedNodeAttempt(process.argv[3],process.argv[5],{signal:controller.signal});
    const raw=jsonBytes(result);
    const context=parseJson((await accountingPrivateFile(process.argv[3],262144)).raw);
    need(raw.length<=context.resultLimit,'ACCOUNTING_RESULT_LIMIT');
    process.stdout.write(raw);
    process.exitCode=result.kind==='UNPAID_RESPONSE'||FINALIZED.has(result.result.outcome)?0:2;
  }finally{
    process.removeListener('SIGINT',abort);process.removeListener('SIGTERM',abort);
  }
}
if(process.argv[1]&&await realpath(process.argv[1]).catch(()=>null)===here)
  main().catch(error=>{process.stderr.write(JSON.stringify({
    error:safeCode(error.code,'ACCOUNTING_WORKER_FAILED')})+'\n');process.exitCode=2;});
