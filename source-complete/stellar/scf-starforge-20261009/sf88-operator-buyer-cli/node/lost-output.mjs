// MIT. Direct Node operation source for the original SF36 lost-output finalizer.
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,open,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {dirname,isAbsolute,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {need,digest,exists} from './store.mjs';

const SOURCE='stellar-forge.sf88.lost-output-source.v1';
const CONTEXT='stellar-forge.sf36.node-attempt-context.v1';
const HASH=/^[a-f0-9]{64}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_,item)=>object(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item)
  .replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
const same=(left,right)=>canonical(left)===canonical(right);
const checkSignal=signal=>{need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted,'NODE_LOST_OUTPUT_ABORTED');};
const requestFields=['request_id','actor','service','network','asset','scheme','max_amount','resource',
  'pay_to','max_timeout_seconds','method','body_present','body_bytes','body_sha256','accepted_terms_sha256'].sort();
const runtimeImport=(operation,name)=>import(pathToFileURL(join(operation.buyer.runtime.directory,name)).href);
const ownPrivate=info=>(info.mode&0o077)===0&&info.uid===process.getuid();

async function privateDirectory(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'NODE_LOST_OUTPUT_ABSOLUTE_PATH_REQUIRED');
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&ownPrivate(info)&&await realpath(path)===path,
    'NODE_LOST_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
}
async function privateFile(path,limit=4_000_000,parse=true) {
  await privateDirectory(dirname(path));
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();
    need(info.isFile()&&ownPrivate(info)&&info.size<=limit,'NODE_LOST_OUTPUT_PRIVATE_FILE_REQUIRED');
    const raw=await file.readFile();
    need(raw.length<=limit,'NODE_LOST_OUTPUT_SOURCE_TOO_LARGE');
    return {raw,value:parse?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):null};
  } finally {await file.close();}
}
async function fileIdentity(path,limit,{classifyJson=false}={}) {
  if(!await exists(path))return {condition:'ABSENT',bytes:0,sha256:null};
  if(classifyJson) {
    const {raw}=await privateFile(path,limit,false);
    let condition=raw.length?'INVALID_JSON':'EMPTY';
    if(raw.length)try{JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));condition='JSON';}catch{}
    return {condition,bytes:raw.length,sha256:digest(raw)};
  }
  await privateDirectory(dirname(path));
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const before=await file.stat();
    need(before.isFile()&&ownPrivate(before)&&before.size<=limit,'NODE_LOST_OUTPUT_PRIVATE_FILE_REQUIRED');
    const hash=createHash('sha256'),buffer=Buffer.alloc(65536);
    let size=0;
    for(;;){const {bytesRead}=await file.read(buffer,0,buffer.length,null);if(!bytesRead)break;
      size+=bytesRead;need(size<=limit,'NODE_LOST_OUTPUT_SOURCE_TOO_LARGE');hash.update(buffer.subarray(0,bytesRead));}
    const after=await file.stat();
    need(size===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs,
      'NODE_LOST_OUTPUT_SOURCE_CHANGED');
    return {condition:size?'SAVED':'EMPTY',bytes:size,sha256:hash.digest('hex')};
  } finally {await file.close();}
}
async function createSelection(path,value) {
  const serialized=JSON.stringify(value,null,2)+'\n',frozen=JSON.parse(serialized);
  const temporary=join(dirname(path),'.node-selection-'+randomUUID());
  const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {
    try{await file.writeFile(serialized);await file.sync();}finally{await file.close();}
    try{await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    const parent=await open(dirname(path),constants.O_RDONLY);
    try{await parent.sync();}finally{await parent.close();}
  } finally {await unlink(temporary).catch(()=>{});}
  const current=(await privateFile(path)).value;
  need(same(current,frozen),'NODE_LOST_OUTPUT_SELECTION_CONFLICT');
  return current;
}

/** Fixed offline source projection reused by the original Python finalizer.
 * All body and ticket semantics come from this operation's original _bound().
 * No provider, signer, reservation or finalizer is invoked here. */
export async function readNodeAttemptContext(operation,{signal}={}) {
  checkSignal(signal);
  const {meta,config}=await operation._bound();
  need(meta.runtimeDirectory===operation.buyer.runtime.directory,'NODE_LOST_OUTPUT_RUNTIME_CHANGED');
  const directory=operation.directory;
  await privateDirectory(operation.buyer.stateDirectory);await privateDirectory(directory);
  need(directory===join(operation.buyer.stateDirectory,digest(operation.intentId)),
    'NODE_LOST_OUTPUT_OPERATION_DIRECTORY_MISMATCH');
  const paths={configuration:join(directory,'config.json'),operation:join(directory,'operation.json'),
    attempt:join(directory,'attempt.json')};
  const files=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>
    [name,await privateFile(path,name==='attempt'?16384:262144)])));
  const attempt=files.attempt.value;
  need(same(meta,files.operation.value)&&same(config,files.configuration.value)&&
    digest(files.configuration.raw)===meta.configSha256&&attempt.schema===meta.schema&&
    attempt.intentId===operation.intentId&&attempt.configSha256===meta.configSha256&&
    attempt.bodySha256===meta.bodySha256&&attempt.kind===undefined&&
    ['STARTING','STARTED','RECORDED','INTERRUPTED_OR_START_FAILED','NATIVE_RESULT_UNAVAILABLE'].includes(attempt.state),
    'NODE_LOST_OUTPUT_ORIGINAL_ATTEMPT_MISMATCH');
  const startedAt=attempt.startedAt??attempt.createdAt;
  need(typeof startedAt==='string'&&Number.isFinite(Date.parse(startedAt)),
    'NODE_LOST_OUTPUT_ATTEMPT_TIME_REQUIRED');
  need(config.evidenceDir===join(directory,'evidence'),'NODE_LOST_OUTPUT_EVIDENCE_DIRECTORY_MISMATCH');
  await privateDirectory(config.evidenceDir);
  const evidencePath=join(config.evidenceDir,digest(operation.intentId)+'.json');
  const evidenceState=await fileIdentity(evidencePath,4_000_000,{classifyJson:true});
  need(evidenceState.condition!=='JSON','ORIGINAL_EVIDENCE_PRESENT_USE_EXISTING_RECOVERY');
  const bodyPresent=config.operation.bodyFile!==undefined;
  const body=bodyPresent?await (await operation.buyer._requestFiles()).readRequestFile(config.operation.bodyFile):Buffer.alloc(0);
  need(digest(body)===meta.bodySha256,'NODE_LOST_OUTPUT_BODY_CHANGED');
  const ticket=config.operation.ticketFile?await privateFile(config.operation.ticketFile,16384,false):null;
  need((ticket?digest(ticket.raw):null)===(meta.ticketSha256??null),'NODE_LOST_OUTPUT_TICKET_CHANGED');
  const localOutcome={};
  for(const name of ['stdout','stderr','result'])
    localOutcome[name]=await fileIdentity(join(directory,name==='result'?'result.json':name==='stdout'?'stdout.json':'stderr.log'),
      name==='result'?16_777_216:33_554_432,{classifyJson:name==='result'});
  const {responseFile}=await runtimeImport(operation,'config.mjs');
  const download=responseFile(config);
  if(download){
    need(download.destination===join(directory,'response.bin'),'NODE_LOST_OUTPUT_RESPONSE_PATH_MISMATCH');
    localOutcome.response=await fileIdentity(download.destination,download.maxBytes);
  }
  let transportCheckpoint=null;
  if(await exists(join(config.evidenceDir,'wire-'+digest(operation.intentId)))) {
    const reader=await runtimeImport(operation,'attempt-wire.mjs');
    transportCheckpoint=await reader.readAttemptWireCheckpoint({cfg:config,body:bodyPresent?body:undefined});
    need(transportCheckpoint?.writerActive===false,'NODE_LOST_OUTPUT_WRITER_ACTIVE');
  }
  await operation._bound();
  need(same(evidenceState,await fileIdentity(evidencePath,4_000_000,{classifyJson:true})),
    'NODE_LOST_OUTPUT_EVIDENCE_CHANGED');
  checkSignal(signal);
  return {schema:CONTEXT,sourceKind:'node-operation',stateDirectory:operation.buyer.stateDirectory,
    operationDirectory:directory,runtimeDirectory:meta.runtimeDirectory,intentId:operation.intentId,
    attemptId:digest(files.attempt.raw),attemptState:attempt.state,attemptStartedAt:startedAt,
    configSha256:meta.configSha256,bodyPresent,bodyBytes:body.length,bodySha256:meta.bodySha256,
    ticketSha256:meta.ticketSha256??null,nativeWorkspace:meta.nativeWorkspace??null,
    evidencePath,evidenceState,localOutcome,transportCheckpointSha256:transportCheckpoint?digest(canonical(transportCheckpoint)):null,
    sourceHashes:{...Object.fromEntries(Object.entries(files).map(([name,{raw}])=>[name,digest(raw)])),
      body:bodyPresent?digest(body):null,ticket:ticket?digest(ticket.raw):null,evidence:evidenceState.sha256,
      ...Object.fromEntries(Object.entries(localOutcome).map(([name,value])=>[name,value.sha256]))}};
}

async function originalContext(operation,options={}) {
  checkSignal(options.signal);
  const context=await readNodeAttemptContext(operation,options);
  const [{openWorkspace},{config,execution}]=await Promise.all([
    runtimeImport(operation,'workspace.mjs'),runtimeImport(operation,'config.mjs')]);
  const workspace=options.workspace??context.nativeWorkspace;
  need(typeof workspace==='string','NODE_LOST_OUTPUT_ORIGINAL_WORKSPACE_REQUIRED');
  const active=await openWorkspace(['--dir',workspace]);
  const cfg=await config(operation.configPath),{op,owner,transport}=execution(cfg);
  const current=execution(active.config);
  need(['python','actor','service','ledger','policy'].every(key=>owner[key]===current.owner[key])&&
    cfg.signerModule===active.config.signerModule&&cfg.trustedPayer===active.config.trustedPayer&&
    same(transport,current.transport)&&['scheme','network','asset','payTo'].every(key=>op.expect[key]===current.op.expect[key])&&
    (context.nativeWorkspace===null||context.nativeWorkspace===active.manifest.directory),
    'NODE_LOST_OUTPUT_ORIGINAL_WORKSPACE_MISMATCH');
  need(options.approvedRequest===undefined||options.approvedRequestFile===undefined,
    'LOST_OUTPUT_ONE_APPROVED_REQUEST_SOURCE_REQUIRED');
  const selectedRequest=options.approvedRequest??(options.approvedRequestFile===undefined?null:
    (await privateFile(options.approvedRequestFile,65536)).value);
  const request=selectedRequest===null?null:JSON.parse(canonical(selectedRequest));
  need(object(request)&&Object.keys(request).sort().join('\n')===requestFields.join('\n'),
    'LOST_OUTPUT_APPROVED_REQUEST_REQUIRED');
  need(HASH.test(request.body_sha256??'')&&HASH.test(request.accepted_terms_sha256??'')&&
    Number.isSafeInteger(request.max_timeout_seconds)&&request.max_timeout_seconds>=1&&request.max_timeout_seconds<=86400&&
    typeof request.max_amount==='string'&&/^[1-9][0-9]*$/.test(request.max_amount)&&
    request.request_id===operation.intentId&&request.actor===owner.actor&&request.service===owner.service&&
    request.resource===op.url&&request.method===op.method&&request.scheme==='exact'&&
    ['network','asset','scheme'].every(key=>request[key]===op.expect[key])&&request.pay_to===op.expect.payTo&&
    BigInt(request.max_amount)<=BigInt(op.expect.maxAtomic)&&
    (op.expect.maxTimeoutSeconds===undefined||request.max_timeout_seconds<=op.expect.maxTimeoutSeconds)&&
    request.body_present===context.bodyPresent&&request.body_bytes===context.bodyBytes&&request.body_sha256===context.bodySha256,
    'NODE_LOST_OUTPUT_APPROVED_REQUEST_MISMATCH');
  const sourceHashes={...context.sourceHashes};
  for(const [name,path] of [['workspaceConfig',active.configPath],['workspaceManifest',join(active.manifest.directory,'workspace.json')]])
    sourceHashes[name]=digest((await privateFile(path,262144)).raw);
  const snapshot={...context,schema:'stellar-forge.sf88.node-lost-output-attempt.v1',workspace:active.manifest.directory,
    expectedRequestSha256:digest(canonical(request)),sourceHashes,
    expected:{network:op.expect.network,asset:op.expect.asset,amount:request.max_amount,payTo:op.expect.payTo,payer:cfg.trustedPayer}};
  for(const [chosen,currentValue] of [[options.expectedRequestSha256,snapshot.expectedRequestSha256],
    [options.expectedAttemptId,snapshot.attemptId],[options.expectedConfigSha256,snapshot.configSha256]])
    need(chosen===undefined||chosen===currentValue,'NODE_LOST_OUTPUT_SELECTED_ATTEMPT_CHANGED');
  return {operation,active,cfg,owner,transport,snapshot,approvedRequest:request};
}

export async function inspectNodeLostOutput(operation,options={}) {
  return (await originalContext(operation,options)).snapshot;
}
function viewOf(result,snapshot) {
  const recovery=result.recovery,binding=recovery?.binding;
  need(FINALIZED.has(result.outcome)&&recovery?.schema==='stellar-forge.sf36.lost-output-recovery.v1'&&
    binding?.sourceKind==='node-operation'&&binding.intentId===snapshot.intentId&&
    binding.attemptId===snapshot.attemptId&&binding.configSha256===snapshot.configSha256&&
    binding.requestSha256===snapshot.expectedRequestSha256&&same(binding.sourceHashes,snapshot.sourceHashes),
    'NODE_LOST_OUTPUT_FINALITY_BINDING_MISMATCH');
  return {schema:'stellar-forge.sf88.node-lost-output-finalization.v1',sourceKind:'node-operation',
    intentId:binding.intentId,attemptId:binding.attemptId,configSha256:binding.configSha256,
    requestSha256:binding.requestSha256,transaction:binding.transaction,workspace:binding.workspace,
    stateDirectory:binding.stateDirectory,operationDirectory:binding.operationDirectory,
    sourceHashes:binding.sourceHashes,sourcePath:binding.sourcePath,sourceSha256:binding.sourceSha256,
    evidenceState:binding.evidenceState,localOutcome:binding.localOutcome,
    attemptStartedAt:binding.attemptStartedAt,completedAt:recovery.completedAt,observedAt:recovery.observedAt,
    requestBinding:binding.requestBinding,recordAuthority:recovery.recordAuthority,
    association:'OPERATOR_SELECTED_TRANSACTION_AFTER_LOCAL_OUTPUT_LOSS',
    result:{...recovery.result,outcome:result.outcome}};
}
async function invoke(context,sourcePath,{signal,node=process.execPath,environment=process.env,verifyOnly=false}={}) {
  checkSignal(signal);
  const {operation,active,cfg,owner,transport,snapshot}=context;
  const [{openWorkspace},{runOriginalFinalityWorker},{resolveBuyerProxy},{resolveRpcEndpoint}]=await Promise.all([
    runtimeImport(operation,'workspace.mjs'),runtimeImport(operation,'finalization.mjs'),
    runtimeImport(operation,'../sf31-buyer-client/public-transport.mjs'),
    runtimeImport(operation,'../sf86-rpc-transfer-reconcile/terms.mjs')]);
  const privileged=await openWorkspace(['--dir',active.manifest.directory],{accounting:true,environment});
  need(same(privileged.config,active.config)&&same(privileged.manifest,active.manifest),'NODE_LOST_OUTPUT_WORKSPACE_CHANGED');
  const directory=dirname(sourcePath),reports=verifyOnly?directory:join(directory,'reports');
  if(!verifyOnly)await mkdir(reports,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(reports);
  let rpcProxyUrl;
  if(!verifyOnly&&transport!==null) {
    resolveBuyerProxy(transport,environment);
    rpcProxyUrl=new URL(transport.proxyEnv===undefined?transport.proxyUrl:environment[transport.proxyEnv]).origin;
  }
  const args=['--lost-output-source',sourcePath,'--ledger',owner.ledger,'--policy',owner.policy,
    '--payer',cfg.trustedPayer,'--node',node,'--reports',reports,'--expected-request-sha',snapshot.expectedRequestSha256,
    ...(verifyOnly?['--verify-only']:['--rpc-endpoint',resolveRpcEndpoint(snapshot.expected.network,active.manifest.signer.rpcUrl)]),
    ...(rpcProxyUrl===undefined?[]:['--rpc-proxy-env','SF36_RPC_PROXY_URL'])];
  const result=await runOriginalFinalityWorker(owner.python,args,privileged.operatorEnvironment,signal,rpcProxyUrl,environment);
  need(FINALIZED.has(result.outcome),/^[A-Z0-9_]{1,120}$/.test(result?.reason??'')?result.reason:'NODE_LOST_OUTPUT_FINALITY_NOT_VERIFIED');
  return viewOf(result,snapshot);
}

export async function readNodeLostOutputRecovery(operation,options={}) {
  checkSignal(options.signal);
  await operation._bound();
  const directory=join(operation.directory,'lost-output'),recoveryPath=join(directory,'recovery.json');
  if(!await exists(recoveryPath))return null;
  const envelope=(await privateFile(recoveryPath)).value,transaction=envelope.payload?.binding?.transaction;
  need(HASH.test(transaction??''),'NODE_LOST_OUTPUT_RECOVERY_INVALID');
  const sourcePath=join(directory,transaction+'.source.json'),source=(await privateFile(sourcePath)).value;
  const context=await originalContext(operation,{...options,approvedRequestFile:undefined,approvedRequest:source.approvedRequest});
  return invoke(context,sourcePath,{...options,verifyOnly:true});
}
export async function recoverNodeLostOutput(operation,options={}) {
  need(HASH.test(options.transaction??'')&&HASH.test(options.expectedRequestSha256??''),
    'LOST_OUTPUT_TRANSACTION_AND_DIGEST_REQUIRED');
  const context=await originalContext(operation,options),snapshot=context.snapshot;
  const directory=join(operation.directory,'lost-output');
  await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(directory);
  const selection={schema:SOURCE,sourceKind:'node-operation',stateDirectory:snapshot.stateDirectory,
    operationDirectory:snapshot.operationDirectory,runtimeDirectory:snapshot.runtimeDirectory,workspace:snapshot.workspace,
    intentId:snapshot.intentId,attemptId:snapshot.attemptId,configSha256:snapshot.configSha256,
    requestSha256:snapshot.expectedRequestSha256,transaction:options.transaction,sourceHashes:snapshot.sourceHashes,
    evidenceState:snapshot.evidenceState,localOutcome:snapshot.localOutcome,transportCheckpointSha256:snapshot.transportCheckpointSha256,
    approvedRequest:context.approvedRequest};
  await createSelection(join(directory,'selection.json'),selection);
  const sourcePath=join(directory,options.transaction+'.source.json');
  await createSelection(sourcePath,selection);
  return invoke(context,sourcePath,options);
}
export async function exportNodeLostOutputProof(operation,{output,...options}={}) {
  const view=await readNodeLostOutputRecovery(operation,options);
  need(view,'NODE_LOST_OUTPUT_RECOVERY_NOT_COMPLETED');
  const facts=view.result.verifiedFacts;
  need(facts?.intentId===operation.intentId&&facts.transaction===view.transaction&&
    facts.request_sha256===view.requestSha256,'NODE_LOST_OUTPUT_VERIFIED_FACTS_MISMATCH');
  await privateDirectory(dirname(output));
  need(resolve(output)!==join(operation.directory,'evidence',digest(operation.intentId)+'.json'),
    'NODE_LOST_OUTPUT_DISTINCT_EXPORT_REQUIRED');
  const completion=await privateFile(join(operation.directory,'lost-output','recovery.json'));
  const proof={schema:'stellar-forge.sf88.lost-output-verified-transfer.v1',
    origin:'ORIGINAL_SF43_VERIFIED_TRANSFER_RECOVERY',proof:'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH',
    reservation:'ORIGINAL_SF36_FINALIZED',sellerReport:'LOCAL_OUTPUT_LOST_AFTER_PAYMENT',sourceKind:'node-operation',
    intentId:operation.intentId,attemptId:view.attemptId,configSha256:view.configSha256,requestSha256:view.requestSha256,
    transaction:facts.transaction,network:facts.network,asset:facts.asset,payer:facts.payer,recipient:facts.recipient,
    atomicAmount:facts.atomicAmount,ledger:facts.ledger,matchingEventId:facts.eventId,
    transactionCreatedAt:facts.transactionCreatedAt,attemptStartedAt:view.attemptStartedAt,
    observedAt:view.observedAt,completedAt:view.completedAt,sealedRecoverySha256:digest(completion.raw),
    sourceHashes:view.sourceHashes,evidenceState:view.evidenceState,localOutcome:view.localOutcome,
    recordAuthority:view.recordAuthority};
  await createSelection(output,proof);
  const exact=await privateFile(output);
  return {path:output,bytes:exact.raw.length,sha256:digest(exact.raw),proof};
}
