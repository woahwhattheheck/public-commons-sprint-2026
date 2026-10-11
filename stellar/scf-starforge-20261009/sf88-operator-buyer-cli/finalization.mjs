// MIT. Complete accounting for one existing buyer attempt using original SF36.
import {spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat, mkdir, open, realpath, rename, unlink} from 'node:fs/promises';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {config, execution, need, InputError} from './config.mjs';
import {openQueue} from './queue.mjs';
import {openWorkspace} from './workspace.mjs';
import {resolveBuyerProxy} from '../sf31-buyer-client/public-transport.mjs';
import {originalRecordFromEvidence} from '../sf86-rpc-transfer-reconcile/cli.mjs';
import {checkOriginalTerms, resolveRpcEndpoint} from '../sf86-rpc-transfer-reconcile/terms.mjs';
import {analyzeOne} from '../sf52-buyer-outcomes/outcomes.mjs';

const SCHEMA='stellar-forge.sf88.inbox-finalization.v1';
const WORKER_SCHEMA='stellar-forge.sf36.finalization.v1';
const WORKER=fileURLToPath(new URL('../sf36-spend-governor/finalize.py',import.meta.url));
const HASH=/^[a-f0-9]{64}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const sha=value=>createHash('sha256').update(value).digest('hex');
const ownPrivate=info=>(info.mode&0o077)===0&&info.uid===process.getuid();
const errorCode=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'INBOX_FINALIZATION_IO_FAILED';

async function privateDirectory(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'INBOX_FINALIZATION_ABSOLUTE_PATH_REQUIRED');
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&ownPrivate(info)&&await realpath(path)===path,
    'INBOX_FINALIZATION_PRIVATE_DIRECTORY_REQUIRED');
}
async function readPrivate(path,limit=4_000_000) {
  await privateDirectory(dirname(path));
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await handle.stat();
    need(info.isFile()&&ownPrivate(info)&&info.size<=limit,'INBOX_FINALIZATION_PRIVATE_FILE_REQUIRED');
    const raw=await handle.readFile();
    need(raw.length<=limit,'INBOX_FINALIZATION_FILE_TOO_LARGE');
    return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
  } finally {await handle.close();}
}
export async function saveFinalizationView(path,value) {
  const temporary=join(dirname(path),'.finalization-'+randomUUID());
  const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL,0o600);
  try {
    try {await handle.writeFile(JSON.stringify(value,null,2)+'\n');await handle.sync();}
    finally {await handle.close();}
    await rename(temporary,path);
    const directory=await open(dirname(path),constants.O_RDONLY);
    try {await directory.sync();}finally{await directory.close();}
  } finally {await unlink(temporary).catch(()=>{});}
}

function runWorker(python,args,operatorEnvironment,signal,rpcProxyUrl) {
  need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
  need(!signal?.aborted,'OPERATOR_ABORTED');
  return new Promise((accept,reject)=>{
    const child=spawn(python,['-B','-E','-s',WORKER,...args],{shell:false,
      env:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8',...operatorEnvironment,
        ...(rpcProxyUrl===undefined?{}:{SF36_RPC_PROXY_URL:rpcProxyUrl})},
      stdio:['ignore','pipe','ignore']});
    const chunks=[];let size=0,settled=false,killTimer;
    const abort=()=>{child.kill('SIGTERM');killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);};
    const timeout=setTimeout(()=>{child.kill('SIGKILL');finish(new InputError('INBOX_FINALIZATION_TIMEOUT'));},450000);
    const finish=(error,result)=>{
      if(settled)return;settled=true;clearTimeout(timeout);clearTimeout(killTimer);
      signal?.removeEventListener('abort',abort);error?reject(error):accept(result);
    };
    signal?.addEventListener('abort',abort,{once:true});
    child.once('error',()=>finish(new InputError('INBOX_FINALIZATION_WORKER_START_FAILED')));
    child.stdout.on('data',chunk=>{
      size+=chunk.length;
      if(size>4_000_000){child.kill('SIGKILL');finish(new InputError('INBOX_FINALIZATION_RESULT_TOO_LARGE'));}
      else chunks.push(chunk);
    });
    child.once('close',code=>{
      if(settled)return;
      if(signal?.aborted)return finish(new InputError('INBOX_FINALIZATION_INTERRUPTED'));
      try {
        const result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        need(result?.schema===WORKER_SCHEMA&&
          ['FINALIZED','IDEMPOTENT_FINALIZED','NOT_FINALIZED','WORKER_ERROR'].includes(result.outcome)&&
          (code===0||code===2),'INBOX_FINALIZATION_RESULT_INVALID');
        finish(null,result);
      } catch {finish(new InputError('INBOX_FINALIZATION_WORKER_FAILED'));}
    });
  });
}

// The missing-receipt branch shares this fixed worker and isolated key pipe.
export {runWorker as runOriginalFinalityWorker};

/** Trusted host core for an existing original attempt. Callers retain their own
 * immutable attempt/config/body record; SF36 remains the only ledger authority.
 * A native session caller may supply its validated sourceEvidenceDirectory;
 * ordinary inbox/application calls retain the workspace directory requirement.
 * This API never creates an attempt, reservation, signer or payment. */
export async function finalizeOriginalAttempt({configurationPath,configSha256,intentId,
  evidencePath,bodySha256,bodyBytes,attemptStartedAt,workspace,outbox,merchantRoute,signal,
  sourceEvidenceDirectory}={}) {
  need(process.platform!=='win32','WORKSPACE_POSIX_OPERATOR_REQUIRED');
  need(typeof configurationPath==='string'&&isAbsolute(configurationPath)&&
    resolve(configurationPath)===configurationPath,'INBOX_FINALIZATION_ABSOLUTE_PATH_REQUIRED');
  need(HASH.test(configSha256??'')&&typeof intentId==='string'&&
    /^[A-Za-z0-9._:-]{1,160}$/.test(intentId)&&
    (bodySha256===null||typeof bodySha256==='string'&&HASH.test(bodySha256))&&
    Number.isSafeInteger(bodyBytes)&&bodyBytes>=0&&bodyBytes<=1_048_576&&
    (bodySha256!==null||bodyBytes===0)&&typeof attemptStartedAt==='string'&&
    Number.isFinite(Date.parse(attemptStartedAt)),'INBOX_ATTEMPT_METADATA_INVALID');
  need(Boolean(outbox)===Boolean(merchantRoute),'OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER');
  const {raw:cfgRaw}=await readPrivate(configurationPath,65536);
  need(sha(cfgRaw)===configSha256,'INBOX_CONFIG_CHANGED');
  const cfg=await config(configurationPath);
  const {op,owner,transport}=execution(cfg);
  need(op.intentId===intentId&&(op.bodyFile!==undefined)===(bodySha256!==null),
    'INBOX_APPROVED_OPERATION_MISMATCH');
  const active=await openWorkspace(['--dir',workspace]);
  const {op:workspaceOp,owner:workspaceOwner,transport:workspaceTransport}=execution(active.config);
  const selectedEvidenceDirectory=sourceEvidenceDirectory??active.config.evidenceDir;
  await privateDirectory(selectedEvidenceDirectory);
  // Use the original selected workspace, never a replacement payer or ledger.
  need(['python','actor','service','policy','ledger'].every(key=>owner[key]===workspaceOwner[key])&&
    cfg.signerModule===active.config.signerModule&&cfg.evidenceDir===selectedEvidenceDirectory&&
    cfg.trustedPayer===active.config.trustedPayer,'INBOX_WORKSPACE_OPERATOR_MISMATCH');
  need(JSON.stringify(transport)===JSON.stringify(workspaceTransport),
    'INBOX_WORKSPACE_TRANSPORT_MISMATCH');
  need(['scheme','network','asset','payTo'].every(key=>op.expect[key]===workspaceOp.expect[key]),
    'INBOX_WORKSPACE_TERMS_MISMATCH');
  // A later spending-cap reduction does not undo a previously authorized debt.
  // Original SF36 authenticates the actual earlier reservation before finality.
  const rpcEndpoint=resolveRpcEndpoint(op.expect.network,active.manifest.signer.rpcUrl);
  let rpcProxyUrl;
  if(workspaceTransport!==null) {
    // Resolve the existing explicit source for this invocation. The actual
    // ephemeral endpoint is never saved or placed in process arguments.
    resolveBuyerProxy(workspaceTransport);
    rpcProxyUrl=new URL(workspaceTransport.proxyEnv===undefined?
      workspaceTransport.proxyUrl:process.env[workspaceTransport.proxyEnv]).origin;
  }
  need(evidencePath===join(selectedEvidenceDirectory,sha(intentId)+'.json'),
    'INBOX_FINALIZATION_EVIDENCE_PATH_MISMATCH');
  const {raw:evidenceRaw,value:evidence}=await readPrivate(evidencePath);
  const record=originalRecordFromEvidence(evidence);
  checkOriginalTerms(record,active.config.trustedPayer);
  const approved=record.operatorReservation?.approved_request;
  const approvedSha=record.operatorReservation?.request_sha256;
  need(approved&&HASH.test(approvedSha??'')&&approved.request_id===intentId&&
    approved.actor===owner.actor&&approved.service===owner.service&&
    approved.resource===new URL(op.url).href&&approved.method===op.method&&
    approved.body_present===(bodySha256!==null)&&approved.body_bytes===bodyBytes&&
    approved.body_sha256===(bodySha256??sha(''))&&
    ['scheme','network','asset'].every(key=>approved[key]===op.expect[key])&&
    approved.pay_to===op.expect.payTo&&/^[1-9][0-9]*$/.test(approved.max_amount??'')&&
    BigInt(approved.max_amount)<=BigInt(op.expect.maxAtomic)&&
    (op.expect.maxTimeoutSeconds===undefined||approved.max_timeout_seconds<=op.expect.maxTimeoutSeconds),
    'INBOX_APPROVED_OPERATION_MISMATCH');
  need(Number.isFinite(Date.parse(evidence.observedAt))&&
    Date.parse(evidence.observedAt)>=Date.parse(attemptStartedAt),'INBOX_EVIDENCE_PREDATES_ATTEMPT');
  // Reuse the original key loader, with no wallet prerequisite or provider import.
  const privileged=await openWorkspace(['--dir',workspace],{accounting:true});
  need(JSON.stringify(privileged.config)===JSON.stringify(active.config)&&
    JSON.stringify(privileged.manifest)===JSON.stringify(active.manifest),'INBOX_WORKSPACE_CHANGED');
  const reports=join(active.manifest.directory,'finalization-reports');
  await mkdir(reports,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(reports);
  const args=['--record',evidencePath,'--ledger',owner.ledger,'--policy',owner.policy,
    '--payer',active.config.trustedPayer,'--node',process.execPath,'--reports',reports,
    '--rpc-endpoint',rpcEndpoint,'--expected-request-sha',approvedSha,
    ...(rpcProxyUrl===undefined?[]:['--rpc-proxy-env','SF36_RPC_PROXY_URL']),
    ...(outbox?['--outbox',outbox,'--merchant-route',merchantRoute]:[])];
  const result=await runWorker(owner.python,args,privileged.operatorEnvironment,signal,rpcProxyUrl);
  if(FINALIZED.has(result.outcome))need(result.request_id===intentId&&result.request_sha256===approvedSha,
    'INBOX_FINALIZATION_RESULT_BINDING_MISMATCH');
  return {result,approvedRequestSha256:approvedSha,evidencePath,evidenceSha256:sha(evidenceRaw),
    workspace:active.manifest.directory,completedAt:new Date().toISOString()};
}

/** Reconcile the saved queue attempt and retain the original inbox view. */
export async function finalizeQueueIntent({root,intentId,workspace,outbox,merchantRoute,signal}={}) {
  const queue=await openQueue(root);
  const job=await queue.show(intentId);
  need(job.attempt?.kind==='EXECUTE','INBOX_EXECUTION_ATTEMPT_REQUIRED');
  const directory=join(queue.root,'jobs',job.id);
  const finalized=await finalizeOriginalAttempt({configurationPath:join(directory,'execution.json'),
    configSha256:job.configSha256,intentId,evidencePath:job.evidencePath,
    bodySha256:job.bodySha256,bodyBytes:job.bodyBytes,attemptStartedAt:job.attempt.startedAt,
    workspace,outbox,merchantRoute,signal});
  const {result}=finalized;
  const view={schema:SCHEMA,intentId,attemptId:job.attempt.id,configSha256:job.configSha256,
    ...finalized,
    recordAuthority:'ORIGINAL_SF36_LEDGER; THIS_FILE_IS_A_SAVED_OPERATOR_VIEW'};
  if(FINALIZED.has(result.outcome))view.lastFinalized={completedAt:view.completedAt,result};
  else if(job.finalization?.lastFinalized)view.lastFinalized=job.finalization.lastFinalized;
  try {await saveFinalizationView(join(directory,'finalization.json'),view);}
  catch(error) {
    // Preserve a successful ledger result even if its inbox view could not save.
    return {...job,finalization:view,finalizationView:{status:'SAVE_FAILED',code:errorCode(error)}};
  }
  return {...await queue.show(intentId),finalizationView:{status:'SAVED'}};
}

/** Bounded display of the original saved view; its ledger remains authoritative. */
export function summarizeFinalization(view) {
  const result=view?.result;
  const done=FINALIZED.has(result?.outcome);
  const previous=view?.lastFinalized;
  return {outcome:result?.outcome??'NOT_RECORDED',
    actualAtomicUnits:done?result.actual:null,receipt:done?result.receipt_ref:null,
    requestSha256:result?.request_sha256??null,completedAt:view?.completedAt??null,
    ...(typeof result?.reason==='string'?{reason:result.reason}:{}),
    lastFinalized:previous&&FINALIZED.has(previous.result?.outcome)?{
      completedAt:previous.completedAt,outcome:previous.result.outcome,
      actualAtomicUnits:previous.result.actual,receipt:previous.result.receipt_ref}:null};
}

/** Identify an original unsigned response, without manufacturing a ledger result. */
export async function readUnpaidAttempt({evidencePath,intentId,attemptStartedAt}) {
  const {value:evidence}=await readPrivate(evidencePath);
  need(evidence?.schema==='scf82.checkout-evidence.v1'&&evidence.intentId===intentId&&
    evidence.observation?.intentId===intentId&&
    Number.isFinite(Date.parse(evidence.observedAt))&&
    Date.parse(evidence.observedAt)>=Date.parse(attemptStartedAt),
    'INBOX_EVIDENCE_ATTEMPT_MISMATCH');
  if(evidence.observation.buyer?.status!=='NO_PAYMENT_REQUIRED')return null;
  need(evidence.operatorReservation===null&&evidence.observedAt===evidence.observation.observedAt&&
    analyzeOne(evidence.observation).status==='NO_PAYMENT_REQUIRED','INBOX_UNPAID_EVIDENCE_MISMATCH');
  return {outcome:'NO_PAYMENT_REQUIRED',actualAtomicUnits:null,receipt:null,
    requestSha256:null,completedAt:evidence.observedAt,lastFinalized:null,
    recordAuthority:'ORIGINAL_UNSIGNED_RESPONSE; NO_LEDGER_FINALIZATION_ASSERTED'};
}
