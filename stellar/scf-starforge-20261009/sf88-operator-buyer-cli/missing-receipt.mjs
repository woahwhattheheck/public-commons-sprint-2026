// MIT. Explicit recovery of one original payment whose seller receipt was lost.
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

const SOURCE='stellar-forge.sf88.missing-receipt-source.v1';
const VIEW='stellar-forge.sf88.manual-finalization.v1';
const HASH=/^[a-f0-9]{64}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
const ownPrivate=info=>(info.mode&0o077)===0&&info.uid===process.getuid();
const safeReason=result=>/^[A-Z0-9_]{1,120}$/.test(result?.reason??'')?result.reason:'MANUAL_FINALITY_NOT_VERIFIED';

async function privateDirectory(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'MANUAL_ABSOLUTE_PATH_REQUIRED');
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&ownPrivate(info)&&await realpath(path)===path,
    'MANUAL_PRIVATE_DIRECTORY_REQUIRED');
}
async function privateFile(path,limit=4_000_000) {
  await privateDirectory(dirname(path));
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    need(info.isFile()&&ownPrivate(info)&&info.size<=limit,'MANUAL_PRIVATE_SOURCE_REQUIRED');
    const raw=await handle.readFile();
    need(raw.length<=limit,'MANUAL_SOURCE_TOO_LARGE');
    return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
  } finally {await handle.close();}
}
async function exists(path) {
  try {await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}
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
    need(selected===undefined||typeof selected==='string'&&selected===current,'MANUAL_SELECTED_ATTEMPT_CHANGED');
}

async function originalContext({root,intentId,workspace,...expected}) {
  const queue=await openQueue(root);
  const job=await queue.show(intentId);
  need(job.attempt?.kind==='EXECUTE','INBOX_EXECUTION_ATTEMPT_REQUIRED');
  const jobDirectory=join(queue.root,'jobs',job.id);
  const active=await openWorkspace(['--dir',workspace]);
  const paths={request:join(jobDirectory,'request.json'),sourceConfig:join(jobDirectory,'source-config.json'),
    configuration:join(jobDirectory,'execution.json'),attempt:join(jobDirectory,'attempt.json'),
    evidence:join(active.manifest.directory,'evidence',job.id+'.json'),
    workspaceConfig:active.configPath,workspaceManifest:join(active.manifest.directory,'workspace.json')};
  need(job.evidencePath===paths.evidence,'MANUAL_EVIDENCE_PATH_MISMATCH');
  const sources=Object.fromEntries(await Promise.all(Object.entries(paths).map(async([name,path])=>
    [name,await privateFile(path)])));
  const cfg=await config(paths.configuration);
  const {op,owner,transport}=execution(cfg);
  const current=execution(active.config);
  need(sha(sources.configuration.raw)===job.configSha256&&
    ['python','actor','service','policy','ledger'].every(key=>owner[key]===current.owner[key])&&
    cfg.signerModule===active.config.signerModule&&cfg.evidenceDir===active.config.evidenceDir&&
    cfg.trustedPayer===active.config.trustedPayer&&same(transport,current.transport),
    'MANUAL_ORIGINAL_WORKSPACE_MISMATCH');
  need(['scheme','network','asset','payTo'].every(key=>op.expect[key]===current.op.expect[key]),
    'MANUAL_ORIGINAL_TERMS_MISMATCH');
  const evidence=sources.evidence.value;
  const reservation=evidence.operatorReservation;
  need(evidence.schema==='scf82.checkout-evidence.v1'&&evidence.intentId===intentId&&
    evidence.observation?.intentId===intentId&&reservation?.outcome==='FRESH_RESERVATION_APPROVED'&&
    reservation.requestId===intentId&&HASH.test(reservation.requestSha256??'')&&
    Number.isSafeInteger(evidence.report?.counts?.signedAttempts)&&evidence.report.counts.signedAttempts>=1,
    'MANUAL_ORIGINAL_RESERVATION_REQUIRED');
  need(evidence.observation?.buyer?.receipt==null&&evidence.reconciliation?.record?.receipt==null,
    'ORIGINAL_RECEIPT_PRESENT_USE_NORMAL_FINALIZER');
  need(Number.isFinite(Date.parse(evidence.observedAt))&&
    Date.parse(evidence.observedAt)>=Date.parse(job.attempt.startedAt),'MANUAL_EVIDENCE_PREDATES_ATTEMPT');
  need(op.expect.scheme==='exact'&&['network','asset'].every(key=>reservation[key]===op.expect[key])&&
    /^[1-9][0-9]*$/.test(reservation.reservedAtomicUnits??'')&&
    BigInt(reservation.reservedAtomicUnits)<=BigInt(op.expect.maxAtomic),'MANUAL_RESERVATION_TERMS_MISMATCH');
  const sourceHashes=Object.fromEntries(Object.entries(sources).map(([name,{raw}])=>[name,sha(raw)]));
  sourceHashes.body=job.bodySha256;
  const snapshot={schema:'stellar-forge.sf88.missing-receipt-attempt.v1',queueRoot:queue.root,
    workspace:active.manifest.directory,intentId,attemptId:job.attempt.id,configSha256:job.configSha256,
    expectedRequestSha256:reservation.requestSha256,attemptStartedAt:job.attempt.startedAt,
    evidenceObservedAt:evidence.observedAt,sourceHashes,bodySha256:job.bodySha256,bodyBytes:job.bodyBytes,
    expected:{network:op.expect.network,asset:op.expect.asset,amount:reservation.reservedAtomicUnits,
      payTo:op.expect.payTo,payer:cfg.trustedPayer}};
  expectedSelection(snapshot,expected);
  return {queue,job,jobDirectory,active,cfg,owner,transport,snapshot};
}

/** Read the retained original reservation metadata and frozen request. This
 * projection does not open keys, load a signer, contact a provider, or reserve. */
export async function inspectMissingReceiptAttempt(options={}) {
  return (await originalContext(options)).snapshot;
}

function recoveryView(result,snapshot) {
  const recovery=result.recovery;
  const binding=recovery?.binding;
  need(FINALIZED.has(result.outcome)&&recovery?.schema==='stellar-forge.sf36.manual-recovery.v1'&&
    binding?.intentId===snapshot.intentId&&binding.attemptId===snapshot.attemptId&&
    binding.configSha256===snapshot.configSha256&&binding.requestSha256===snapshot.expectedRequestSha256&&
    Object.keys(snapshot.sourceHashes).every(key=>binding.sourceHashes?.[key]===snapshot.sourceHashes[key]),
    'MANUAL_FINALITY_RESULT_BINDING_MISMATCH');
  return {schema:VIEW,intentId:binding.intentId,attemptId:binding.attemptId,configSha256:binding.configSha256,
    requestSha256:binding.requestSha256,transaction:binding.transaction,sourceHashes:binding.sourceHashes,
    sourcePath:binding.sourcePath,sourceSha256:binding.sourceSha256,workspace:binding.workspace,
    attemptStartedAt:binding.attemptStartedAt,evidenceObservedAt:binding.evidenceObservedAt,
    completedAt:recovery.completedAt,observedAt:recovery.observedAt,requestBinding:binding.requestBinding,
    association:'OPERATOR_SELECTED_TRANSACTION',result:{...recovery.result,outcome:result.outcome},
    recordAuthority:recovery.recordAuthority};
}
async function invoke(context,sourcePath,{signal,node=process.execPath,environment=process.env,verifyOnly=false}={}) {
  const {active,cfg,owner,transport,snapshot}=context;
  const privileged=await openWorkspace(['--dir',active.manifest.directory],{accounting:true,environment});
  need(same(privileged.config,active.config)&&same(privileged.manifest,active.manifest),'MANUAL_WORKSPACE_CHANGED');
  const directory=dirname(sourcePath);
  const reports=verifyOnly?directory:join(directory,'reports');
  if(!verifyOnly)await mkdir(reports,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(reports);
  let rpcProxyUrl;
  if(!verifyOnly&&transport!==null) {
    resolveBuyerProxy(transport,environment);
    rpcProxyUrl=new URL(transport.proxyEnv===undefined?transport.proxyUrl:environment[transport.proxyEnv]).origin;
  }
  const args=['--manual-source',sourcePath,'--ledger',owner.ledger,'--policy',owner.policy,
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
export async function readMissingReceiptRecovery(options={}) {
  const queue=await openQueue(options.root);
  const job=await queue.show(options.intentId);
  const directory=join(queue.root,'jobs',job.id,'manual-finality');
  if(!await exists(join(directory,'recovery.json')))return null;
  const context=await originalContext(options);
  const envelope=(await privateFile(join(directory,'recovery.json'))).value;
  // The outer read selects only this job's fixed transaction descriptor. The
  // worker authenticates the HMAC, every binding and its original ledger row.
  const transaction=envelope.payload?.binding?.transaction;
  need(HASH.test(transaction??''),'MANUAL_RECOVERY_RECORD_INVALID');
  return invoke(context,join(directory,transaction+'.source.json'),{...options,verifyOnly:true});
}

/** Operator-selected finality for a recorded original attempt, without another
 * signer/payment. The original worker independently verifies the transfer and
 * atomically finalizes its existing reservation. All records are create-only. */
export async function recoverMissingReceipt(options={}) {
  const {transaction,expectedRequestSha256}=options;
  need(HASH.test(transaction??'')&&HASH.test(expectedRequestSha256??''),
    'MANUAL_TRANSACTION_AND_DIGEST_REQUIRED');
  const context=await originalContext(options);
  const {snapshot,jobDirectory}=context;
  const directory=join(jobDirectory,'manual-finality');
  await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(directory);
  const selection={schema:SOURCE,queueRoot:snapshot.queueRoot,workspace:snapshot.workspace,
    intentId:snapshot.intentId,attemptId:snapshot.attemptId,configSha256:snapshot.configSha256,
    requestSha256:snapshot.expectedRequestSha256,transaction,sourceHashes:snapshot.sourceHashes};
  const sourcePath=join(directory,transaction+'.source.json');
  const source=await createSelection(sourcePath,selection);
  need(same(source,selection),'MANUAL_SELECTION_CONFLICT');
  const manualFinalization=await invoke(context,sourcePath,options);
  return {...await context.queue.show(options.intentId),manualFinalization};
}
