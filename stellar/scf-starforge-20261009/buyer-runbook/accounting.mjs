// MIT. Saved acquisition views of the original SF88/SF36 accounting authority.
import {constants} from 'node:fs';
import {lstat,mkdir,open,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,join,resolve} from 'node:path';
import {config as nativeConfig,execution,need} from '../sf88-operator-buyer-cli/config.mjs';
import {openWorkspace} from '../sf88-operator-buyer-cli/workspace.mjs';
import {finalizeOriginalAttempt,readUnpaidAttempt,saveFinalizationView,
  summarizeFinalization} from '../sf88-operator-buyer-cli/finalization.mjs';

const SCHEMA='stellar-forge.buyer-runbook-accounting.v1';
const BINDING='stellar-forge.buyer-runbook-accounting-workspace.v1';
const FINAL=new Set(['FINALIZED','IDEMPOTENT_FINALIZED']);
const HASH=/^[a-f0-9]{64}$/;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'RUNBOOK_ACCOUNTING_FAILED';
const root=plan=>join(plan.directory,'accounting');
const viewPath=(plan,row)=>join(root(plan),row.id+'.json');
const bindingPath=(plan,row)=>join(root(plan),row.id+'.workspace.json');
const own=info=>(info.mode&0o077)===0&&typeof process.getuid==='function'&&info.uid===process.getuid();

function planDigest(plan) { const {createdAt,...value}=plan;return hash(encode(value)); }
function identity(plan,row) {
  return {directory:plan.directory,planId:plan.id,planSha256:planDigest(plan),
    id:row.id,intentId:row.intentId,configSha256:row.config.sha256};
}
function matches(value,expected) {
  return value&&Object.entries(expected).every(([key,item])=>value[key]===item);
}
function atomic(value) {
  if(typeof value==='number')need(Number.isSafeInteger(value)&&value>=0,'RUNBOOK_ACCOUNTING_AMOUNT_INVALID');
  const text=String(value);
  need(/^(?:0|[1-9][0-9]{0,39})$/.test(text),'RUNBOOK_ACCOUNTING_AMOUNT_INVALID');
  return text;
}
async function directory(path,create=false) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0'),
    'RUNBOOK_ACCOUNTING_CANONICAL_PATH_REQUIRED');
  if(create)await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&own(info)&&await realpath(path)===path,
    'RUNBOOK_ACCOUNTING_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
async function read(path) {
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const info=await file.stat();
    need(info.isFile()&&own(info)&&info.size<=4_000_000,'RUNBOOK_ACCOUNTING_PRIVATE_FILE_REQUIRED');
    const raw=await file.readFile();
    need(raw.length<=4_000_000,'RUNBOOK_ACCOUNTING_FILE_TOO_LARGE');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  } finally {await file.close();}
}
async function optional(path) {try{return await read(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function binding(plan,row) {
  const value=await optional(bindingPath(plan,row));
  if(value)need(value.schema===BINDING&&matches(value,identity(plan,row))&&
    typeof value.workspace==='string'&&isAbsolute(value.workspace)&&resolve(value.workspace)===value.workspace,
    'RUNBOOK_ACCOUNTING_WORKSPACE_CHANGED');
  return value;
}
function validateResult(result,row) {
  need(FINAL.has(result?.outcome)&&result.request_id===row.intentId&&HASH.test(result.request_sha256??'')&&
    typeof result.receipt_ref==='string'&&result.receipt_ref.startsWith(row.acceptedCaps.network+'/'),
    'RUNBOOK_ACCOUNTING_RESULT_CHANGED');
  atomic(result.actual);
}
async function savedView(plan,row) {
  const value=await optional(viewPath(plan,row));
  if(value) {
    need(value.schema===SCHEMA&&matches(value,identity(plan,row))&&value.attemptStartedAt===row.started?.at,
      'RUNBOOK_ACCOUNTING_VIEW_CHANGED');
    if(FINAL.has(value.result?.outcome))validateResult(value.result,row);
    if(value.lastFinalized)validateResult(value.lastFinalized.result,row);
    if(value.unsignedResponse)need(value.unsignedResponse.outcome==='NO_PAYMENT_REQUIRED'&&
      value.unsignedResponse.receipt===null&&value.unsignedResponse.actualAtomicUnits===null,
      'RUNBOOK_ACCOUNTING_VIEW_CHANGED');
  }
  return value;
}
function summarize(view,row,selected) {
  const summary=view?.unsignedResponse??summarizeFinalization(view);
  const final=FINAL.has(view?.result?.outcome)?{completedAt:view.completedAt,result:view.result}:view?.lastFinalized;
  const finalized=final?{outcome:final.result.outcome,completedAt:final.completedAt,
    actualAtomicUnits:atomic(final.result.actual),receipt:final.result.receipt_ref,
    requestSha256:final.result.request_sha256}:null;
  return {...summary,outcome:view?.observationError?'OBSERVATION_FAILED':summary.outcome,
    workspace:selected?.workspace??view?.workspace??null,
    workspaceSource:selected?.source??null,finalized,
    viewStatus:view?'SAVED':'NOT_RECORDED',
    lastError:view?.observationError??null,checkedAt:view?.completedAt??null,
    evidenceSha256:view?.evidenceSha256??null,
    recordAuthority:view?.unsignedResponse?.recordAuthority??'ORIGINAL_SF36_LEDGER; SAVED_ACQUISITION_VIEW',
    attempted:row.state!=='UNATTEMPTED'};
}

/** Read saved views only; this neither observes a network nor opens a wallet. */
export async function inspectAcquisitionAccounting(state) {
  let exists=true;
  try{await directory(root(state.plan));}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
  const operations=[];
  for(const row of state.operations) {
    let accounting;
    try {
      const selected=exists?await binding(state.plan,row):null;
      const view=exists?await savedView(state.plan,row):null;
      accounting=summarize(view,row,selected);
    } catch(error) {
      accounting={outcome:'SAVED_VIEW_UNAVAILABLE',viewStatus:'READ_FAILED',lastError:codeOf(error),
        workspace:null,finalized:null,attempted:row.state!=='UNATTEMPTED'};
    }
    operations.push({...row,accounting});
  }
  const groups=new Map();
  for(const row of operations) {
    const key=JSON.stringify([row.acceptedCaps.network,row.acceptedCaps.asset]);
    let group=groups.get(key);
    if(!group){group={network:row.acceptedCaps.network,asset:row.acceptedCaps.asset,operations:0,
      plannedMaximumAtomic:'0',finalizedActualAtomic:'0',finalizedOperations:0,
      unsignedOperations:0,unresolvedOperations:0,unattemptedOperations:0};groups.set(key,group);}
    group.operations++;
    group.plannedMaximumAtomic=(BigInt(group.plannedMaximumAtomic)+BigInt(row.acceptedCaps.maxAtomic)).toString();
    if(row.accounting.finalized){group.finalizedOperations++;
      group.finalizedActualAtomic=(BigInt(group.finalizedActualAtomic)+BigInt(row.accounting.finalized.actualAtomicUnits)).toString();}
    else if(row.accounting.outcome==='NO_PAYMENT_REQUIRED')group.unsignedOperations++;
    else if(row.state==='UNATTEMPTED')group.unattemptedOperations++;
    else group.unresolvedOperations++;
  }
  return {...state,operations,accounting:{schema:SCHEMA,groups:[...groups.values()],
    meaning:'Actual totals include each retained original finalized receipt once. Unsigned, unresolved and untouched operations retain separate counts. Network and asset amounts are never converted or combined.',
    finalizedOperations:operations.filter(row=>row.accounting.finalized).length,
    unsignedOperations:operations.filter(row=>!row.accounting.finalized&&row.accounting.outcome==='NO_PAYMENT_REQUIRED').length,
    unresolvedOperations:operations.filter(row=>row.state!=='UNATTEMPTED'&&!row.accounting.finalized&&row.accounting.outcome!=='NO_PAYMENT_REQUIRED').length}};
}

/** Check the retained configuration without rereading a previously spent body. */
async function frozenConfiguration(plan,row) {
  const cfgPath=join(plan.directory,'configs',row.id+'.json');
  await directory(join(plan.directory,'configs'));
  const file=await open(cfgPath,constants.O_RDONLY|constants.O_NOFOLLOW);
  let raw;
  try {const info=await file.stat();need(info.isFile()&&own(info)&&info.size<=65536,'RUNBOOK_ACCOUNTING_CONFIG_INVALID');
    raw=await file.readFile();need(raw.length<=65536&&hash(raw)===row.config.sha256,'FROZEN_CONFIG_CHANGED');}
  finally {await file.close();}
  const cfg=await nativeConfig(cfgPath),{op,owner,download}=execution(cfg);
  need(JSON.stringify(cfg)===JSON.stringify(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))),
    'FROZEN_CONFIG_CHANGED');
  need(row.config.path==='configs/'+row.id+'.json'&&op.intentId===row.intentId&&op.url===row.url&&
    op.method===row.method&&JSON.stringify(op.expect)===JSON.stringify(row.acceptedCaps)&&
    JSON.stringify(op.headers)===JSON.stringify(row.headers)&&owner.actor===row.actor&&owner.service===row.service&&
    cfg.evidenceDir===row.evidenceDirectory&&JSON.stringify(download)===JSON.stringify(row.responseFile),
    'FROZEN_PLAN_MISMATCH');
  need(row.body?row.body.path==='bodies/'+row.id+'.bin'&&op.bodyFile===join(plan.directory,row.body.path)&&
    HASH.test(row.body.sha256??'')&&Number.isSafeInteger(row.body.bytes)&&row.body.bytes>=0:
    op.bodyFile===undefined,'FROZEN_BODY_CHANGED');
  return cfg;
}

/** Bind an existing original operator. Its current ledger, payer and network
 * must match the frozen config; no signer code or spending key is loaded. */
async function originalWorkspace(plan,row,path) {
  path=await directory(path);
  const cfg=await frozenConfiguration(plan,row),native=await openWorkspace(['--dir',path]);
  const {owner,transport,op}=execution(cfg),other=execution(native.config);
  need(op.intentId===row.intentId&&cfg.evidenceDir===row.evidenceDirectory&&
    ['python','actor','service','policy','ledger'].every(key=>owner[key]===other.owner[key])&&
    cfg.signerModule===native.config.signerModule&&cfg.trustedPayer===native.config.trustedPayer&&
    cfg.evidenceDir===native.config.evidenceDir&&JSON.stringify(transport)===JSON.stringify(other.transport)&&
    ['scheme','network','asset','payTo'].every(key=>op.expect[key]===other.op.expect[key]),
    'RUNBOOK_ACCOUNTING_ORIGINAL_WORKSPACE_REQUIRED');
  return native.manifest.directory;
}
export async function bindAcquisitionWorkspace(plan,row,workspace,{source='OPERATOR_SELECTED'}={}) {
  need(['OPERATOR_SELECTED','RECEIVED_ORIGINAL_OPERATOR'].includes(source),'RUNBOOK_ACCOUNTING_BINDING_SOURCE_INVALID');
  const selected=await originalWorkspace(plan,row,workspace);
  await directory(root(plan),true);
  const previous=await binding(plan,row);
  const value={schema:BINDING,...identity(plan,row),workspace:selected,source,
    selectedAt:previous?.workspace===selected?previous.selectedAt:new Date().toISOString()};
  await saveFinalizationView(bindingPath(plan,row),value);
  return value;
}

/** One already performed original attempt. The caller holds the runbook lease.
 * No buyer execution, reservation, signer import or payment is initiated here. */
export async function finalizeAcquisitionOperation(plan,row,{workspace,workspaceSource,workspaceForOperation,
  signal,outbox,merchantRoute}={}) {
  need(row.started?.schema==='stellar-forge.buyer-runbook-started.v1'&&row.started.id===row.id&&
    row.started.intentId===row.intentId&&row.started.configSha256===row.config.sha256&&
    typeof row.started.at==='string'&&Number.isFinite(Date.parse(row.started.at)),
    'RUNBOOK_ACCOUNTING_ORIGINAL_ATTEMPT_REQUIRED');
  await directory(root(plan),true);
  const previous=await savedView(plan,row),oldBinding=await binding(plan,row);
  const evidencePath=join(row.evidenceDirectory,hash(row.intentId)+'.json');
  const base={schema:SCHEMA,...identity(plan,row),attemptStartedAt:row.started.at,
    bodySha256:row.body?.sha256??null,bodyBytes:row.body?.bytes??0,evidencePath,
    recordAuthority:'ORIGINAL_SF36_LEDGER; THIS_FILE_IS_A_SAVED_ACQUISITION_VIEW'};
  let view,selected=oldBinding;
  try {
    need(!signal?.aborted,'RUNBOOK_ACCOUNTING_INTERRUPTED');
    await frozenConfiguration(plan,row);
    need(!row.result?.summary?.evidencePath||row.result.summary.evidencePath===evidencePath,
      'RUNBOOK_ACCOUNTING_EVIDENCE_PATH_CHANGED');
    const unsigned=await readUnpaidAttempt({evidencePath,intentId:row.intentId,attemptStartedAt:row.started.at});
    if(unsigned) {
      need(!previous?.lastFinalized&&!FINAL.has(previous?.result?.outcome),'RUNBOOK_ACCOUNTING_UNPAID_CONFLICT');
      view={...base,unsignedResponse:unsigned,completedAt:new Date().toISOString()};
    } else {
      const automatic=workspace===undefined&&!oldBinding&&workspaceForOperation?
        await workspaceForOperation(row):null;
      const target=workspace??oldBinding?.workspace??automatic;
      need(target,'RUNBOOK_ACCOUNTING_WORKSPACE_REQUIRED');
      selected=await bindAcquisitionWorkspace(plan,row,target,{source:workspaceSource??oldBinding?.source??
        (automatic?'RECEIVED_ORIGINAL_OPERATOR':'OPERATOR_SELECTED')});
      const finalized=await finalizeOriginalAttempt({configurationPath:join(plan.directory,'configs',row.id+'.json'),
        configSha256:row.config.sha256,intentId:row.intentId,evidencePath,
        bodySha256:row.body?.sha256??null,bodyBytes:row.body?.bytes??0,
        attemptStartedAt:row.started.at,workspace:selected.workspace,signal,outbox,merchantRoute});
      view={...base,...finalized};
      if(FINAL.has(view.result.outcome)){validateResult(view.result,row);
        view.lastFinalized={completedAt:view.completedAt,result:view.result};}
    }
  } catch(error) {
    view={...base,workspace:selected?.workspace??null,completedAt:new Date().toISOString(),observationError:codeOf(error)};
  }
  if(!view.lastFinalized) {
    if(previous?.lastFinalized)view.lastFinalized=previous.lastFinalized;
    else if(FINAL.has(previous?.result?.outcome))view.lastFinalized={completedAt:previous.completedAt,result:previous.result};
  }
  let viewStatus='SAVED',saveError;
  try {await saveFinalizationView(viewPath(plan,row),view);}
  catch(error){viewStatus='SAVE_FAILED';saveError=codeOf(error);}
  return {id:row.id,intentId:row.intentId,...summarize(view,row,selected),viewStatus,
    ...(saveError?{saveError}:{}),status:view.observationError?'OBSERVATION_FAILED':
      view.unsignedResponse?.outcome??view.result?.outcome??'NOT_RECORDED'};
}

// Recovery reads the same original binding without creating an accounting selection.
export {originalWorkspace as inspectAcquisitionWorkspace};
