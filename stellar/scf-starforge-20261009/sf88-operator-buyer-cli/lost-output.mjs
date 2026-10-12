// MIT. Recover an original paid attempt after its local output was lost.
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, realpath, link, unlink} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {config, execution, need} from './config.mjs';
import {openQueue} from './queue.mjs';
import {openWorkspace} from './workspace.mjs';
import {runOriginalFinalityWorker} from './finalization.mjs';
import {resolveBuyerProxy} from '../sf31-buyer-client/public-transport.mjs';
import {resolveRpcEndpoint} from '../sf86-rpc-transfer-reconcile/terms.mjs';

const SOURCE='stellar-forge.sf88.lost-output-source.v1';
const VIEW='stellar-forge.sf88.lost-output-finalization.v1';
const HASH=/^[a-f0-9]{64}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const canonical=value=>JSON.stringify(value,(_,item)=>object(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const same=(left,right)=>canonical(left)===canonical(right);
const REQUEST_FIELDS=['request_id','actor','service','network','asset','scheme','max_amount','resource',
  'pay_to','max_timeout_seconds','method','body_present','body_bytes','body_sha256','accepted_terms_sha256'].sort();
function validateApprovedRequest(value){
  need(object(value)&&Object.keys(value).sort().join('\n')===REQUEST_FIELDS.join('\n'),
    'LOST_OUTPUT_APPROVED_REQUEST_REQUIRED');
  need(HASH.test(value.body_sha256??'')&&HASH.test(value.accepted_terms_sha256??'')&&
    typeof value.body_present==='boolean'&&Number.isSafeInteger(value.body_bytes)&&value.body_bytes>=0&&
    Number.isSafeInteger(value.max_timeout_seconds)&&value.max_timeout_seconds>=1&&value.max_timeout_seconds<=86400&&
    typeof value.max_amount==='string'&&/^[1-9][0-9]*$/.test(value.max_amount),
    'LOST_OUTPUT_APPROVED_REQUEST_INVALID');
  return value;
}
const ownPrivate=info=>(info.mode&0o077)===0&&info.uid===process.getuid();
const safeReason=result=>/^[A-Z0-9_]{1,120}$/.test(result?.reason??'')?result.reason:'LOST_OUTPUT_FINALITY_NOT_VERIFIED';

async function privateDirectory(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'LOST_OUTPUT_ABSOLUTE_PATH_REQUIRED');
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&ownPrivate(info)&&await realpath(path)===path,
    'LOST_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
}
async function privateFile(path,limit=4_000_000,parse=true) {
  await privateDirectory(dirname(path));
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    need(info.isFile()&&ownPrivate(info)&&info.size<=limit,'LOST_OUTPUT_PRIVATE_SOURCE_REQUIRED');
    const raw=await handle.readFile();
    need(raw.length<=limit,'LOST_OUTPUT_SOURCE_TOO_LARGE');
    return {raw,value:parse?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):null};
  } finally {await handle.close();}
}
async function exists(path) {
  try {await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
}
async function inspectLostEvidence(path){
  if(!await exists(path))return {condition:'ABSENT',bytes:0,sha256:null};
  const {raw}=await privateFile(path,4_000_000,false);
  if(!raw.length)return {condition:'EMPTY',bytes:0,sha256:sha(raw)};
  let parsed=false;
  try{JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));parsed=true;}catch{}
  need(!parsed,'ORIGINAL_EVIDENCE_PRESENT_USE_EXISTING_RECOVERY');
  return {condition:'INVALID_JSON',bytes:raw.length,sha256:sha(raw)};
}
async function createSelection(path,value) {
  const temporary=join(dirname(path),'.selection-'+randomUUID());
  const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {
    try {await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();}
    finally {await file.close();}
    try {await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
    const parent=await open(dirname(path),constants.O_RDONLY);
    try {await parent.sync();}finally{await parent.close();}
  } finally {await unlink(temporary).catch(()=>{});}
  return (await privateFile(path)).value;
}
function expectedSelection(snapshot,{expectedRequestSha256,expectedAttemptId,expectedConfigSha256}={}) {
  for(const [selected,current] of [[expectedRequestSha256,snapshot.expectedRequestSha256],
    [expectedAttemptId,snapshot.attemptId],[expectedConfigSha256,snapshot.configSha256]])
    need(selected===undefined||typeof selected==='string'&&selected===current,'LOST_OUTPUT_SELECTED_ATTEMPT_CHANGED');
}

async function originalContext({root,intentId,workspace,approvedRequestFile,approvedRequest,...expected}) {
  const queue=await openQueue(root);
  const job=await queue.show(intentId);
  need(job.attempt?.kind==='EXECUTE','INBOX_EXECUTION_ATTEMPT_REQUIRED');
  const jobDirectory=join(queue.root,'jobs',job.id);
  const active=await openWorkspace(['--dir',workspace]);
  const paths={request:join(jobDirectory,'request.json'),sourceConfig:join(jobDirectory,'source-config.json'),
    configuration:join(jobDirectory,'execution.json'),attempt:join(jobDirectory,'attempt.json'),
    workspaceConfig:active.configPath,workspaceManifest:join(active.manifest.directory,'workspace.json')};
  const evidencePath=join(active.manifest.directory,'evidence',job.id+'.json');
  need(job.evidencePath===evidencePath,'LOST_OUTPUT_EVIDENCE_PATH_MISMATCH');
  const evidenceState=await inspectLostEvidence(evidencePath);
  const sources=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>
    [name,await privateFile(path)])));
  const cfg=await config(paths.configuration);
  const {op,owner,transport}=execution(cfg);
  const current=execution(active.config);
  need(sha(sources.configuration.raw)===job.configSha256&&
    ['python','actor','service','policy','ledger'].every(key=>owner[key]===current.owner[key])&&
    cfg.signerModule===active.config.signerModule&&cfg.evidenceDir===active.config.evidenceDir&&
    cfg.trustedPayer===active.config.trustedPayer&&same(transport,current.transport),
    'LOST_OUTPUT_ORIGINAL_WORKSPACE_MISMATCH');
  need(['scheme','network','asset','payTo'].every(key=>op.expect[key]===current.op.expect[key]),
    'LOST_OUTPUT_ORIGINAL_TERMS_MISMATCH');
  need(approvedRequestFile===undefined||approvedRequest===undefined,'LOST_OUTPUT_ONE_APPROVED_REQUEST_SOURCE_REQUIRED');
  approvedRequest=validateApprovedRequest(approvedRequest??(await privateFile(approvedRequestFile)).value);
  const requestSha256=sha(canonical(approvedRequest));
  need(approvedRequest.request_id===intentId&&approvedRequest.actor===owner.actor&&approvedRequest.service===owner.service&&
    approvedRequest.resource===op.url&&approvedRequest.method===op.method&&approvedRequest.scheme==='exact'&&
    ['network','asset','scheme'].every(key=>approvedRequest[key]===op.expect[key])&&
    approvedRequest.pay_to===op.expect.payTo&&BigInt(approvedRequest.max_amount)<=BigInt(op.expect.maxAtomic)&&
    (op.expect.maxTimeoutSeconds===undefined||approvedRequest.max_timeout_seconds<=op.expect.maxTimeoutSeconds)&&
    approvedRequest.body_present===(job.bodySha256!==null)&&approvedRequest.body_bytes===job.bodyBytes&&
    approvedRequest.body_sha256===(job.bodySha256??sha('')),
    'LOST_OUTPUT_APPROVED_REQUEST_MISMATCH');
  need(same(evidenceState,await inspectLostEvidence(evidencePath)),'LOST_OUTPUT_EVIDENCE_CHANGED');
  const sourceHashes=Object.fromEntries(Object.entries(sources).map(([name,{raw}])=>[name,sha(raw)]));
  sourceHashes.body=job.bodySha256;sourceHashes.evidence=evidenceState.sha256;
  const snapshot={schema:'stellar-forge.sf88.lost-output-attempt.v1',queueRoot:queue.root,
    workspace:active.manifest.directory,intentId,attemptId:job.attempt.id,configSha256:job.configSha256,
    expectedRequestSha256:requestSha256,attemptStartedAt:job.attempt.startedAt,
    evidenceObservedAt:null,evidenceState,sourceHashes,bodySha256:job.bodySha256,bodyBytes:job.bodyBytes,
    expected:{network:op.expect.network,asset:op.expect.asset,amount:approvedRequest.max_amount,
      payTo:op.expect.payTo,payer:cfg.trustedPayer}};
  expectedSelection(snapshot,expected);
  return {queue,job,jobDirectory,active,cfg,owner,transport,snapshot,approvedRequest};
}

/** Read the retained original reservation metadata and frozen request. This
 * projection reads the supplied original request preimage and frozen inputs. */
export async function inspectLostOutputAttempt(options={}) {
  return (await originalContext(options)).snapshot;
}

function recoveryView(result,snapshot) {
  const recovery=result.recovery;
  const binding=recovery?.binding;
  need(FINALIZED.has(result.outcome)&&recovery?.schema==='stellar-forge.sf36.lost-output-recovery.v1'&&
    binding?.intentId===snapshot.intentId&&binding.attemptId===snapshot.attemptId&&
    binding.configSha256===snapshot.configSha256&&binding.requestSha256===snapshot.expectedRequestSha256&&
    Object.keys(snapshot.sourceHashes).every(key=>binding.sourceHashes?.[key]===snapshot.sourceHashes[key]),
    'LOST_OUTPUT_FINALITY_RESULT_BINDING_MISMATCH');
  return {schema:VIEW,intentId:binding.intentId,attemptId:binding.attemptId,configSha256:binding.configSha256,
    requestSha256:binding.requestSha256,transaction:binding.transaction,sourceHashes:binding.sourceHashes,evidenceState:binding.evidenceState,
    sourcePath:binding.sourcePath,sourceSha256:binding.sourceSha256,workspace:binding.workspace,
    attemptStartedAt:binding.attemptStartedAt,evidenceObservedAt:binding.evidenceObservedAt,
    completedAt:recovery.completedAt,observedAt:recovery.observedAt,requestBinding:binding.requestBinding,
    association:'OPERATOR_SELECTED_TRANSACTION_AFTER_LOCAL_OUTPUT_LOSS',result:{...recovery.result,outcome:result.outcome},
    recordAuthority:recovery.recordAuthority};
}
async function invoke(context,sourcePath,{signal,node=process.execPath,environment=process.env,verifyOnly=false}={}) {
  const {active,cfg,owner,transport,snapshot}=context;
  const privileged=await openWorkspace(['--dir',active.manifest.directory],{accounting:true,environment});
  need(same(privileged.config,active.config)&&same(privileged.manifest,active.manifest),'LOST_OUTPUT_WORKSPACE_CHANGED');
  const directory=dirname(sourcePath);
  const reports=verifyOnly?directory:join(directory,'reports');
  if(!verifyOnly)await mkdir(reports,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(reports);
  let rpcProxyUrl;
  if(!verifyOnly&&transport!==null) {
    resolveBuyerProxy(transport,environment);
    rpcProxyUrl=new URL(transport.proxyEnv===undefined?transport.proxyUrl:environment[transport.proxyEnv]).origin;
  }
  const args=['--lost-output-source',sourcePath,'--ledger',owner.ledger,'--policy',owner.policy,
    '--payer',cfg.trustedPayer,'--node',node,'--reports',reports,
    '--expected-request-sha',snapshot.expectedRequestSha256,
    ...(verifyOnly?['--verify-only']:['--rpc-endpoint',resolveRpcEndpoint(snapshot.expected.network,active.manifest.signer.rpcUrl)]),
    ...(rpcProxyUrl===undefined?[]:['--rpc-proxy-env','SF36_RPC_PROXY_URL'])];
  const result=await runOriginalFinalityWorker(owner.python,args,privileged.operatorEnvironment,signal,rpcProxyUrl,environment);
  need(FINALIZED.has(result.outcome),safeReason(result));
  return recoveryView(result,snapshot);
}

/** Authenticate an existing successful recovery against current original source
 * and SF36's HMAC journal. Returns null before a completed recovery. Provider IO
 * and ledger finalization are absent from this read path. */
export async function readLostOutputRecovery(options={}) {
  const queue=await openQueue(options.root);
  const job=await queue.show(options.intentId);
  const directory=join(queue.root,'jobs',job.id,'lost-output');
  if(!await exists(join(directory,'recovery.json')))return null;
  const envelope=(await privateFile(join(directory,'recovery.json'))).value;
  // The outer read selects only this job's fixed transaction descriptor. The
  // worker authenticates the HMAC, every binding and its original ledger row.
  const transaction=envelope.payload?.binding?.transaction;
  need(HASH.test(transaction??''),'LOST_OUTPUT_RECOVERY_RECORD_INVALID');
  const sourcePath=join(directory,transaction+'.source.json');
  const source=(await privateFile(sourcePath)).value;
  const context=await originalContext({...options,approvedRequestFile:undefined,approvedRequest:source.approvedRequest});
  return invoke(context,sourcePath,{...options,verifyOnly:true});
}

/** Operator-selected finality for a recorded original attempt, without another
 * signer/payment. The original worker independently verifies the transfer and
 * atomically finalizes its existing reservation. All records are create-only. */
export async function recoverLostOutput(options={}) {
  const {transaction,expectedRequestSha256}=options;
  need(HASH.test(transaction??'')&&HASH.test(expectedRequestSha256??''),
    'LOST_OUTPUT_TRANSACTION_AND_DIGEST_REQUIRED');
  const context=await originalContext(options);
  const {snapshot,jobDirectory}=context;
  const directory=join(jobDirectory,'lost-output');
  await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(directory);
  const selection={schema:SOURCE,queueRoot:snapshot.queueRoot,workspace:snapshot.workspace,
    intentId:snapshot.intentId,attemptId:snapshot.attemptId,configSha256:snapshot.configSha256,
    requestSha256:snapshot.expectedRequestSha256,transaction,sourceHashes:snapshot.sourceHashes,
    approvedRequest:context.approvedRequest,evidenceState:snapshot.evidenceState};
  const sourcePath=join(directory,transaction+'.source.json');
  const source=await createSelection(sourcePath,selection);
  need(same(source,selection),'LOST_OUTPUT_SELECTION_CONFLICT');
  const lostOutputFinalization=await invoke(context,sourcePath,options);
  return {...await context.queue.show(options.intentId),lostOutputFinalization};
}

/** Export the original authenticated transfer facts for merchant reconciliation. */
export async function exportLostOutputProof({output,...options}={}) {
  const view=await readLostOutputRecovery(options);
  need(view,'LOST_OUTPUT_RECOVERY_NOT_COMPLETED');
  const facts=view.result.verifiedFacts;
  need(facts?.intentId===options.intentId&&facts.transaction===view.transaction&&
    facts.request_sha256===view.requestSha256&&HASH.test(view.sourceSha256??''),
    'LOST_OUTPUT_VERIFIED_FACTS_BINDING_MISMATCH');
  const queue=await openQueue(options.root),job=await queue.show(options.intentId);
  const completion=await privateFile(join(queue.root,'jobs',job.id,'lost-output','recovery.json'));
  need(output!==job.evidencePath,'LOST_OUTPUT_EXPORT_REQUIRES_DISTINCT_DESTINATION');
  await privateDirectory(dirname(output));
  const proof={schema:'stellar-forge.sf88.lost-output-verified-transfer.v1',
    origin:'ORIGINAL_SF43_VERIFIED_TRANSFER_RECOVERY',proof:'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH',
    reservation:'ORIGINAL_SF36_FINALIZED',sellerReport:'LOCAL_OUTPUT_LOST_AFTER_PAYMENT',
    intentId:options.intentId,attemptId:view.attemptId,configSha256:view.configSha256,
    requestSha256:view.requestSha256,transaction:facts.transaction,network:facts.network,
    asset:facts.asset,payer:facts.payer,recipient:facts.recipient,atomicAmount:facts.atomicAmount,
    ledger:facts.ledger,matchingEventId:facts.eventId,
    observedAt:view.observedAt,completedAt:view.completedAt,sealedRecoverySha256:sha(completion.raw),
    sourceHashes:view.sourceHashes,evidenceState:view.evidenceState,recordAuthority:view.recordAuthority};
  const stored=await createSelection(output,proof);
  need(same(stored,proof),'LOST_OUTPUT_EXPORTED_PROOF_CONFLICT');
  const exact=await privateFile(output);
  return {path:output,bytes:exact.raw.length,sha256:sha(exact.raw),proof};
}

/** Read original history with authenticated completed recoveries for this
 * accounting workspace. A damaged recovery stays visible as a local error. */
export async function readLostOutputQueueViews({root,workspace,...options}={}) {
  const queue=await openQueue(root),jobs=await queue.list();
  if(workspace===undefined)return jobs;
  const views=[];
  for(const job of jobs){
    try{
      const recovered=await readLostOutputRecovery({...options,root:queue.root,
        workspace,intentId:job.intentId??job.operation?.intentId});
      views.push(recovered?{...job,lostOutputFinalization:recovered}:job);
    }catch(error){
      const reason=/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'LOST_OUTPUT_HISTORY_READ_FAILED';
      views.push({...job,lostOutputFinalizationError:reason});
    }
  }
  return views;
}
