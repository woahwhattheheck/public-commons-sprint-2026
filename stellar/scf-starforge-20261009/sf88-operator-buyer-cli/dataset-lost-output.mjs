// MIT. Recover a paid Dataset attempt through the original SF36 finality worker.
import {constants} from 'node:fs';
import {open,lstat,mkdir,realpath,link,unlink,readdir} from 'node:fs/promises';
import {dirname,join,isAbsolute,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {need,execution} from './config.mjs';
import {canonical,digest,object,inspectDatasetPage} from './dataset-page.mjs';
import {openWorkspace} from './workspace.mjs';
import {runOriginalFinalityWorker} from './finalization.mjs';
import {resolveBuyerProxy} from '../sf31-buyer-client/public-transport.mjs';
import {resolveRpcEndpoint} from '../sf86-rpc-transfer-reconcile/terms.mjs';

const SOURCE='stellar-forge.sf88.lost-output-source.v1';
const VIEW='stellar-forge.sf88.dataset-lost-output-finalization.v1';
const HASH=/^[a-f0-9]{64}$/;
const FINALIZED=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const F=constants.O_NOFOLLOW??0;
const same=(a,b)=>canonical(a)===canonical(b);
const ownPrivate=info=>(info.mode&0o077)===0&&info.uid===process.getuid();
const REQUEST_FIELDS=['request_id','actor','service','network','asset','scheme','max_amount','resource',
 'pay_to','max_timeout_seconds','method','body_present','body_bytes','body_sha256','accepted_terms_sha256'].sort();
function approved(value) {
 need(object(value)&&Object.keys(value).sort().join('\n')===REQUEST_FIELDS.join('\n'),
  'LOST_OUTPUT_APPROVED_REQUEST_REQUIRED');
 need(HASH.test(value.body_sha256??'')&&HASH.test(value.accepted_terms_sha256??'')&&
  typeof value.body_present==='boolean'&&Number.isSafeInteger(value.body_bytes)&&value.body_bytes>=0&&
  Number.isSafeInteger(value.max_timeout_seconds)&&value.max_timeout_seconds>=1&&value.max_timeout_seconds<=86400&&
  typeof value.max_amount==='string'&&/^[1-9][0-9]*$/.test(value.max_amount),
  'LOST_OUTPUT_APPROVED_REQUEST_INVALID');
 return value;
}
async function privateDirectory(path) {
 need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'DATASET_LOST_OUTPUT_ABSOLUTE_PATH_REQUIRED');
 const info=await lstat(path);
 need(info.isDirectory()&&!info.isSymbolicLink()&&ownPrivate(info)&&await realpath(path)===path,
  'DATASET_LOST_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
}
async function file(path,{limit=4_000_000,optional=false,parse=true}={}) {
 await privateDirectory(dirname(path));
 let handle;
 try {handle=await open(path,constants.O_RDONLY|F);}
 catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
 try {
  const info=await handle.stat();
  need(info.isFile()&&ownPrivate(info)&&info.size<=limit,'DATASET_LOST_OUTPUT_PRIVATE_SOURCE_REQUIRED');
  const raw=await handle.readFile();
  need(raw.length<=limit,'DATASET_LOST_OUTPUT_SOURCE_TOO_LARGE');
  return {raw,value:parse?JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)):null};
 } finally {await handle.close();}
}
async function lostEvidence(path) {
 const found=await file(path,{optional:true,parse:false});
 if(!found)return {condition:'ABSENT',bytes:0,sha256:null};
 if(found.raw.length) {
  let parsed=false;
  try {JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(found.raw));parsed=true;}catch {}
  need(!parsed,'ORIGINAL_EVIDENCE_PRESENT_USE_EXISTING_RECOVERY');
 }
 return {condition:found.raw.length?'INVALID_JSON':'EMPTY',bytes:found.raw.length,sha256:digest(found.raw)};
}
async function createAtomic(path,value) {
 await privateDirectory(dirname(path));
 const temporary=join(dirname(path),'.dataset-recovery-'+randomUUID());
 const raw=Buffer.from(JSON.stringify(value,null,2)+'\n');
 need(raw.length<=4_000_000,'DATASET_LOST_OUTPUT_SOURCE_TOO_LARGE');
 const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|F,0o600);
 try {
  try {await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
  try {await link(temporary,path);}catch(error){if(error.code!=='EEXIST')throw error;}
  const parent=await open(dirname(path),constants.O_RDONLY);
  try {await parent.sync();}finally{await parent.close();}
 } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 // A killed earlier publication can leave its completed file with its own
 // temporary hard link. Retire only aliases of this exact published inode.
 const target=await lstat(path);
 if(target.nlink>1) {
  let removed=false;
  for(const name of await readdir(dirname(path))) {
   if(!/^\.dataset-recovery-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name))continue;
   const candidate=join(dirname(path),name);
   let info;
   try {info=await lstat(candidate);}catch(error){if(error.code==='ENOENT')continue;throw error;}
   if(!info.isFile()||info.isSymbolicLink()||info.dev!==target.dev||info.ino!==target.ino)continue;
   const current=await lstat(path);
   need(current.dev===target.dev&&current.ino===target.ino,'DATASET_LOST_OUTPUT_PUBLICATION_CHANGED');
   try {await unlink(candidate);removed=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  if(removed) {
   const parent=await open(dirname(path),constants.O_RDONLY);
   try {await parent.sync();}finally{await parent.close();}
  }
 }
 const retained=await file(path);
 need(same(retained.value,value),'DATASET_LOST_OUTPUT_SELECTION_CONFLICT');
 return {path,bytes:retained.raw.length,sha256:digest(retained.raw),value:retained.value};
}
function pageDirectory(directory,index) {
 need(Number.isSafeInteger(index)&&index>=1&&index<=10000,'DATASET_LOST_OUTPUT_PAGE_REQUIRED');
 return join(directory,'pages',String(index).padStart(6,'0'));
}
async function context({directory,index,workspace,approvedRequestFile,approvedRequest,
 expectedRequestSha256,expectedAttemptSha256,expectedConfigSha256}={}) {
 await privateDirectory(directory);
 const {readRetainedDatasetAttempt}=await import('./dataset-session.mjs');
 const retained=await readRetainedDatasetAttempt(directory,index);
 const {definition,cfg,attempt,sourceHashes,body,responseState,previous}=retained;
 const selectedWorkspace=workspace??definition.workspaceDirectory;
 need(definition.workspaceDirectory===undefined||selectedWorkspace===definition.workspaceDirectory,
  'DATASET_SAVED_WORKSPACE_MISMATCH');
 const active=await openWorkspace(['--dir',selectedWorkspace]);
 const {op,owner,transport}=execution(cfg),current=execution(active.config);
 need(['python','actor','service','policy','ledger'].every(key=>owner[key]===current.owner[key])&&
  cfg.signerModule===active.config.signerModule&&cfg.trustedPayer===active.config.trustedPayer&&
  cfg.evidenceDir===join(directory,'evidence')&&same(transport,current.transport)&&
  ['scheme','network','asset','payTo'].every(key=>op.expect[key]===current.op.expect[key]),
  'DATASET_LOST_OUTPUT_ORIGINAL_WORKSPACE_MISMATCH');
 need(approvedRequestFile===undefined||approvedRequest===undefined,'LOST_OUTPUT_ONE_APPROVED_REQUEST_SOURCE_REQUIRED');
 const preimage=approved(approvedRequest??(await file(approvedRequestFile)).value);
 need(preimage.request_id===op.intentId&&preimage.actor===owner.actor&&preimage.service===owner.service&&
  preimage.resource===op.url&&preimage.method==='GET'&&op.method==='GET'&&
  preimage.scheme==='exact'&&['network','asset','scheme'].every(key=>preimage[key]===op.expect[key])&&
  preimage.pay_to===op.expect.payTo&&BigInt(preimage.max_amount)<=BigInt(op.expect.maxAtomic)&&
  (op.expect.maxTimeoutSeconds===undefined||preimage.max_timeout_seconds<=op.expect.maxTimeoutSeconds)&&
  preimage.body_present===false&&preimage.body_bytes===0&&preimage.body_sha256===digest(''),
  'DATASET_LOST_OUTPUT_APPROVED_REQUEST_MISMATCH');
 const evidencePath=join(directory,'evidence',digest(op.intentId)+'.json');
 const evidenceState=await lostEvidence(evidencePath);
 const workspaceConfig=await file(active.configPath);
 const workspaceManifest=await file(join(active.manifest.directory,'workspace.json'));
 need(same(workspaceConfig.value,active.config)&&same(workspaceManifest.value,active.manifest),
  'DATASET_LOST_OUTPUT_WORKSPACE_CHANGED');
 const hashes={...sourceHashes,workspaceConfig:digest(workspaceConfig.raw),
  workspaceManifest:digest(workspaceManifest.raw),body:null,evidence:evidenceState.sha256};
 const requestSha256=digest(canonical(preimage));
 for(const [expected,value] of [[expectedRequestSha256,requestSha256],
  [expectedAttemptSha256,hashes.attempt],[expectedConfigSha256,hashes.configuration]])
  need(expected===undefined||expected===value,'DATASET_LOST_OUTPUT_SELECTED_ATTEMPT_CHANGED');
 const snapshot={schema:'stellar-forge.sf88.dataset-lost-output-attempt.v1',sourceKind:'dataset',
  sessionDirectory:directory,pageIndex:index,workspace:active.manifest.directory,intentId:op.intentId,
  attemptId:hashes.attempt,configSha256:hashes.configuration,sessionConfigurationSha256:definition.configurationSha256,
  expectedRequestSha256:requestSha256,attemptStartedAt:attempt.startedAt,sourceHashes:hashes,
  evidencePath,evidenceState,responsePath:cfg.responseFile.destination,responseState,
  expected:{network:op.expect.network,asset:op.expect.asset,amount:preimage.max_amount,
   payTo:op.expect.payTo,payer:cfg.trustedPayer}};
 return {retained,active,cfg,owner,transport,preimage,snapshot,body,previous};
}
export async function inspectDatasetLostOutput(options={}) {
 return (await context(options)).snapshot;
}
function recoveryView(result,snapshot) {
 const recovery=result.recovery,binding=recovery?.binding;
 need(FINALIZED.has(result.outcome)&&recovery?.schema==='stellar-forge.sf36.lost-output-recovery.v1'&&
  binding?.sourceKind==='dataset'&&binding.sessionDirectory===snapshot.sessionDirectory&&
  binding.pageIndex===snapshot.pageIndex&&binding.intentId===snapshot.intentId&&
  binding.attemptId===snapshot.attemptId&&binding.configSha256===snapshot.configSha256&&
  binding.requestSha256===snapshot.expectedRequestSha256&&
  same(binding.sourceHashes,snapshot.sourceHashes)&&same(binding.evidenceState,snapshot.evidenceState)&&
  same(binding.responseState,snapshot.responseState)&&binding.workspace===snapshot.workspace,
  'DATASET_LOST_OUTPUT_FINALITY_RESULT_BINDING_MISMATCH');
 return {schema:VIEW,sourceKind:'dataset',sessionDirectory:binding.sessionDirectory,pageIndex:binding.pageIndex,
  intentId:binding.intentId,attemptId:binding.attemptId,configSha256:binding.configSha256,
  sessionConfigurationSha256:snapshot.sessionConfigurationSha256,
  requestSha256:binding.requestSha256,transaction:binding.transaction,workspace:binding.workspace,
  sourceHashes:binding.sourceHashes,evidencePath:snapshot.evidencePath,evidenceState:binding.evidenceState,
  responsePath:snapshot.responsePath,responseState:binding.responseState,
  sourcePath:binding.sourcePath,sourceSha256:binding.sourceSha256,
  attemptStartedAt:binding.attemptStartedAt,observedAt:recovery.observedAt,completedAt:recovery.completedAt,
  association:'OPERATOR_SELECTED_TRANSACTION_AFTER_LOCAL_OUTPUT_LOSS',
  requestBinding:binding.requestBinding,result:{...recovery.result,outcome:result.outcome},
  recordAuthority:recovery.recordAuthority};
}
async function invoke(ctx,sourcePath,{signal,node=process.execPath,environment=process.env,
 verifyOnly=false,rpcEndpoint,rpcProxyEnv,outbox,merchantRoute}={}) {
 const {active,cfg,owner,transport,snapshot}=ctx;
 const privileged=await openWorkspace(['--dir',active.manifest.directory],{accounting:true,environment});
 need(same(privileged.config,active.config)&&same(privileged.manifest,active.manifest),
  'DATASET_LOST_OUTPUT_WORKSPACE_CHANGED');
 need(Boolean(outbox)===Boolean(merchantRoute),'OUTBOX_AND_ORIGINAL_MERCHANT_ROUTE_REQUIRED_TOGETHER');
 const reports=verifyOnly?dirname(sourcePath):join(dirname(sourcePath),'reports');
 if(!verifyOnly)await mkdir(reports,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 await privateDirectory(reports);
 let rpcProxyUrl;
 if(!verifyOnly) {
  if(rpcProxyEnv!==undefined) {
   need(typeof rpcProxyEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(rpcProxyEnv),
    'DATASET_LOST_OUTPUT_RPC_PROXY_ENV_INVALID');
   const proxy=new URL(environment[rpcProxyEnv]);
   need(proxy.protocol==='http:'&&proxy.username===''&&proxy.password===''&&
    proxy.pathname==='/'&&!proxy.search&&!proxy.hash,'DATASET_LOST_OUTPUT_RPC_PROXY_INVALID');
   rpcProxyUrl=proxy.origin;
  } else if(transport!==null) {
   resolveBuyerProxy(transport,environment);
   rpcProxyUrl=new URL(transport.proxyEnv===undefined?transport.proxyUrl:environment[transport.proxyEnv]).origin;
  }
 }
 const args=['--lost-output-source',sourcePath,'--ledger',owner.ledger,'--policy',owner.policy,
  '--payer',cfg.trustedPayer,'--node',node,'--reports',reports,
  '--expected-request-sha',snapshot.expectedRequestSha256,
  ...(verifyOnly?['--verify-only']:['--rpc-endpoint',resolveRpcEndpoint(snapshot.expected.network,
   rpcEndpoint??active.manifest.signer.rpcUrl)]),
  ...(rpcProxyUrl===undefined?[]:['--rpc-proxy-env','SF36_RPC_PROXY_URL']),
  ...(!verifyOnly&&outbox?['--outbox',outbox,'--merchant-route',merchantRoute]:[])];
 const result=await runOriginalFinalityWorker(owner.python,args,privileged.operatorEnvironment,
  signal,rpcProxyUrl,environment);
 need(FINALIZED.has(result.outcome),/^[A-Z0-9_]{1,120}$/.test(result.reason??'')?
  result.reason:'DATASET_LOST_OUTPUT_FINALITY_NOT_VERIFIED');
 return {...recoveryView(result,snapshot),merchant:result.merchant??null};
}
async function completed(options) {
 const directory=join(pageDirectory(options.directory,options.index),'lost-output');
 await privateDirectory(pageDirectory(options.directory,options.index));
 let exists;
 try {exists=await lstat(directory);}catch(error){if(error.code==='ENOENT')return null;throw error;}
 need(exists.isDirectory()&&!exists.isSymbolicLink(),'DATASET_LOST_OUTPUT_PRIVATE_DIRECTORY_REQUIRED');
 const record=await file(join(directory,'recovery.json'),{optional:true});
 if(!record)return null;
 const transaction=record.value?.payload?.binding?.transaction;
 need(HASH.test(transaction??''),'DATASET_LOST_OUTPUT_RECOVERY_RECORD_INVALID');
 const sourcePath=join(directory,transaction+'.source.json'),source=(await file(sourcePath)).value;
 const ctx=await context({...options,workspace:options.workspace??source.workspace,
  approvedRequestFile:undefined,approvedRequest:source.approvedRequest});
 const view=await invoke(ctx,sourcePath,{...options,verifyOnly:true});
 return {ctx,view,directory};
}
/** Read authenticates the same completed recovery and ledger, without provider IO. */
export async function readDatasetLostOutputRecovery(options={}) {
 return (await completed(options))?.view??null;
}
async function makeProof(view) {
 const directory=join(pageDirectory(view.sessionDirectory,view.pageIndex),'lost-output');
 const record=await file(join(directory,'recovery.json'));
 const facts=view.result.verifiedFacts;
 need(facts?.intentId===view.intentId&&facts.transaction===view.transaction&&
  facts.request_sha256===view.requestSha256,'DATASET_LOST_OUTPUT_VERIFIED_FACTS_BINDING_MISMATCH');
 const proof={schema:'stellar-forge.sf88.lost-output-verified-transfer.v1',sourceKind:'dataset',
  origin:'ORIGINAL_SF43_VERIFIED_TRANSFER_RECOVERY',proof:'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH',
  reservation:'ORIGINAL_SF36_FINALIZED',sellerReport:'LOCAL_OUTPUT_LOST_AFTER_PAYMENT',
  sessionDirectory:view.sessionDirectory,pageIndex:view.pageIndex,
  intentId:view.intentId,attemptId:view.attemptId,configSha256:view.configSha256,
  sessionConfigurationSha256:view.sessionConfigurationSha256,requestSha256:view.requestSha256,
  transaction:facts.transaction,network:facts.network,asset:facts.asset,payer:facts.payer,
  recipient:facts.recipient,atomicAmount:facts.atomicAmount,ledger:facts.ledger,matchingEventId:facts.eventId,
  transactionCreatedAt:facts.transactionCreatedAt,attemptStartedAt:view.attemptStartedAt,
  observedAt:view.observedAt,completedAt:view.completedAt,sealedRecoverySha256:digest(record.raw),
  sourceHashes:view.sourceHashes,originalEvidencePath:view.evidencePath,evidenceState:view.evidenceState,
  responsePath:view.responsePath,responseState:view.responseState,recordAuthority:view.recordAuthority};
 return proof;
}
async function exportProof(view,output) {
 need(output!==view.evidencePath&&output!==view.responsePath,'DATASET_LOST_OUTPUT_DISTINCT_EXPORT_REQUIRED');
 const proof=await makeProof(view);
 const stored=await createAtomic(output,proof);
 return {path:output,bytes:stored.bytes,sha256:stored.sha256,proof};
}
/** Finalize the existing reservation, then retain a separate public transfer proof.
 * Original absent/empty/invalid SF82 bytes and the existing page remain intact. */
export async function recoverDatasetLostOutput(options={}) {
 need(HASH.test(options.transaction??'')&&HASH.test(options.expectedRequestSha256??''),
  'LOST_OUTPUT_TRANSACTION_AND_DIGEST_REQUIRED');
 const ctx=await context(options),s=ctx.snapshot;
 const directory=join(pageDirectory(options.directory,options.index),'lost-output');
 await mkdir(directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 await privateDirectory(directory);
 const selection={schema:SOURCE,sourceKind:'dataset',sessionDirectory:s.sessionDirectory,pageIndex:s.pageIndex,
  workspace:s.workspace,intentId:s.intentId,attemptId:s.attemptId,configSha256:s.configSha256,
  requestSha256:s.expectedRequestSha256,transaction:options.transaction,sourceHashes:s.sourceHashes,
  approvedRequest:ctx.preimage,evidenceState:s.evidenceState,responseState:s.responseState};
 const sourcePath=join(directory,options.transaction+'.source.json');
 await createAtomic(sourcePath,selection);
 const view=await invoke(ctx,sourcePath,options);
 const transfer=await exportProof(view,join(directory,'transfer.json'));
 return {...view,transfer};
}
export async function exportDatasetLostOutputProof({output,...options}={}) {
 const done=await completed(options);
 need(done,'DATASET_LOST_OUTPUT_RECOVERY_NOT_COMPLETED');
 return exportProof(done.view,output??join(done.directory,'transfer.json'));
}
/** Admission uses the original page parser and authenticates the source-bound
 * completion. Missing HTTP headers are represented by the separate recovery kind. */
export async function recoveredDatasetPage({directory,index,cfg,previous,expectedSnapshot,maxRows}={}) {
 const done=await completed({directory,index});
 if(!done)return null;
 const {ctx,view}=done;
 need(same(cfg,ctx.cfg)&&view.responseState.condition==='SAVED'&&ctx.body?.length>0,
  'DATASET_LOST_OUTPUT_SAVED_PAGE_REQUIRED');
 const path=join(done.directory,'transfer.json'),stored=await file(path,{optional:true});
 need(stored,'DATASET_LOST_OUTPUT_FINISH_TRANSFER_EXPORT');
 const proof=stored.value;
 need(same(proof,await makeProof(view)),'DATASET_LOST_OUTPUT_TRANSFER_EXPORT_CHANGED');
 const page=inspectDatasetPage(ctx.body,{url:cfg.operation.url,previous,expectedSnapshot,maxRows});
 need(page.sha256===view.responseState.sha256&&page.bytes===view.responseState.bytes,
  'DATASET_LOST_OUTPUT_RESPONSE_CHANGED');
 return {...page,intentId:view.intentId,requestUrl:cfg.operation.url,responsePath:cfg.responseFile.destination,
  evidencePath:path,evidenceSha256:digest(stored.raw),evidenceKind:'ORIGINAL_SF36_LOST_OUTPUT_RECOVERY',
  originalEvidencePath:view.evidencePath,nativeBuyerStatus:'PAID_OUTPUT_RECOVERED',
  originalOutcome:{status:'TRANSFER_VERIFIED_SAVED_BODY_RECOVERED',transaction:view.transaction,
   proof:'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH',responseFileSha256:page.sha256,httpStatus:null},
  operatorReservation:{outcome:'IDEMPOTENT_FINALIZED',requestId:view.intentId,
   requestSha256:view.requestSha256,network:view.result.verifiedFacts.network,
   actualAtomicUnits:view.result.verifiedFacts.atomicAmount},
  lostOutputFinalization:view,recoveredFromOriginalFiles:true};
}
