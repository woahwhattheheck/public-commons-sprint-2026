// MIT. Explicit continuation of an original unsigned dataset page.
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {open,mkdir,lstat,realpath,readdir,unlink,link} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {need,InputError} from './config.mjs';
import {canonical,digest} from './dataset-page.mjs';
import {analyzeOne} from '../sf52-buyer-outcomes/outcomes.mjs';

const SCHEMA='stellar-forge.sf88.unpaid-continuation.v1';
const WORKER=fileURLToPath(new URL('./dataset-unpaid.py',import.meta.url));
const HASH=/^[a-f0-9]{64}$/;
const F=constants.O_NOFOLLOW??0;
const KEYS=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const NAMES=['config.json','attempt.json','result.json','evidence.json','failure.json'];

async function privateDirectory(path) {
  const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(path)===path&&
    (process.platform==='win32'||(info.mode&0o077)===0),'DATASET_PRIVATE_DIRECTORY_REQUIRED');
}
async function bytes(path,limit=262144,optional=false) {
  let handle;
  try {handle=await open(path,constants.O_RDONLY|F);}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  try {
    const info=await handle.stat();
    need(info.isFile()&&info.nlink===1&&info.size<=limit&&
      (process.platform==='win32'||(info.mode&0o077)===0),'DATASET_PRIVATE_FILE_REQUIRED');
    const value=await handle.readFile();need(value.length<=limit,'DATASET_FILE_LIMIT_EXCEEDED');return value;
  } finally {await handle.close();}
}
async function json(path,optional=false) {
  const raw=await bytes(path,262144,optional);
  if(raw===null)return null;
  try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}
  catch{throw new InputError('DATASET_UNPAID_HISTORY_INVALID');}
}
async function sync(path) {
  const handle=await open(path,constants.O_RDONLY);
  try{await handle.sync();}finally{await handle.close();}
}
async function createAtomic(path,value) {
  const raw=Buffer.isBuffer(value)?value:Buffer.from(JSON.stringify(value,null,2)+'\n');
  const existing=await bytes(path,Math.max(raw.length,262144),true);
  if(existing!==null){need(existing.equals(raw),'DATASET_UNPAID_HISTORY_CHANGED');return;}
  const temporary=join(dirname(path),'.unpaid-'+randomUUID());
  const handle=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|F,0o600);
  try {
    try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
    await link(temporary,path);
    await unlink(temporary);
    await sync(dirname(path));
  } finally {await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function paths(directory,cfg) {
  return {'config.json':join(directory,'config.json'),
    'attempt.json':join(directory,'attempt.json'),'result.json':join(directory,'result.json'),
    'evidence.json':join(cfg.evidenceDir,digest(cfg.operation.intentId)+'.json'),
    'failure.json':join(directory,'failure.json')};
}
function validPlan(plan,directory,cfg) {
  need(plan?.schema===SCHEMA&&plan.intentId===cfg.operation.intentId&&
    plan.configurationSha256===digest(canonical(cfg))&&HASH.test(plan.attemptSha256??'')&&
    plan.historyDirectory===join(directory,'unpaid-history',plan.attemptSha256)&&
    Array.isArray(plan.files)&&plan.files.length>=4&&plan.files.length<=5&&
    new Set(plan.files.map(x=>x.name)).size===plan.files.length&&
    plan.files.every(x=>NAMES.includes(x.name)&&HASH.test(x.sha256??'')&&
      Number.isSafeInteger(x.bytes)&&x.bytes>=1&&x.bytes<=262144)&&
    ['config.json','attempt.json','result.json','evidence.json'].every(name=>plan.files.some(x=>x.name===name))&&
    plan.files.find(x=>x.name==='attempt.json').sha256===plan.attemptSha256,
    'DATASET_UNPAID_HISTORY_INVALID');
  return plan;
}
function view(plan,status) {
  return {status,index:plan.index,intentId:plan.intentId,attemptSha256:plan.attemptSha256,
    originalError:plan.originalError,historyDirectory:plan.historyDirectory};
}
export async function pendingUnpaidContinuation(directory,cfg) {
  const root=join(directory,'unpaid-history');
  let names;
  try {await privateDirectory(root);names=await readdir(root);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  names=names.filter(x=>HASH.test(x));
  need(names.length<=128,'DATASET_UNPAID_HISTORY_LIMIT');
  let pending=null;
  for(const name of names) {
    const history=join(root,name);await privateDirectory(history);
    const plan=await json(join(history,'plan.json'),true);
    if(!plan)continue; // An empty pre-plan directory has never changed original files.
    validPlan(plan,directory,cfg);
    const continued=await json(join(history,'continued.json'),true);
    if(continued) {
      need(continued.schema===SCHEMA&&continued.attemptSha256===name&&
        continued.outcome==='ORIGINAL_UNPAID_ATTEMPT_ARCHIVED','DATASET_UNPAID_HISTORY_INVALID');
    }else{
      need(pending===null,'DATASET_MULTIPLE_UNPAID_CONTINUATIONS');
      pending=view(plan,'PREPARED');
    }
  }
  return pending;
}
async function eligible(directory,cfg,attempt,result) {
  if(attempt?.schema!=='stellar-forge.sf88.dataset-attempt.v1'||
    attempt.intentId!==cfg.operation.intentId||attempt.configurationSha256!==digest(canonical(cfg))||
    result?.schema!=='stellar-forge.sf88.dataset-attempt-result.v1')return null;
  const summary=result.summary;
  if(summary?.mode!=='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'||
    summary.intentId!==cfg.operation.intentId||summary.error?.paymentSent!==false||
    summary.operatorReservation!==null||summary.status!==null||summary.httpStatus!==null||
    summary.responseFile?.status!=='NOT_STARTED'||summary.evidenceError||summary.responseCleanupError)return null;
  const originals=paths(directory,cfg),evidenceRaw=await bytes(originals['evidence.json'],262144,true);
  if(!evidenceRaw||await bytes(cfg.responseFile.destination,1,true)!==null)return null;
  let evidence;
  try{evidence=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(evidenceRaw));}catch{return null;}
  if(evidence.schema!=='scf82.checkout-evidence.v1'||evidence.intentId!==cfg.operation.intentId||
    evidence.observation?.intentId!==cfg.operation.intentId||
    evidence.observation?.observedAt!==evidence.observedAt||
    !Number.isFinite(Date.parse(evidence.observedAt))||
    Date.parse(evidence.observedAt)<Date.parse(attempt.startedAt)||
    evidence.operatorReservation!==null||
    evidence.observation.buyer?.status!=='BLOCKED_BEFORE_SIGNATURE'||
    evidence.observation.buyer?.attempts!==0||
    evidence.observation.buyer?.receipt!=null||evidence.observation.chain!=null||
    analyzeOne(evidence.observation).status!=='BLOCKED_BEFORE_SIGNATURE'||
    summary.evidencePath!==originals['evidence.json'])return null;
  const attemptRaw=await bytes(originals['attempt.json'],8192);
  need(canonical(JSON.parse(attemptRaw))===canonical(attempt),'DATASET_ATTEMPT_CHANGED');
  const source=[];
  for(const name of NAMES) {
    const raw=await bytes(originals[name],262144,name==='failure.json');
    if(raw!==null)source.push({name,sha256:digest(raw),bytes:raw.length,raw});
  }
  need(canonical(JSON.parse(source.find(x=>x.name==='config.json').raw))===canonical(cfg)&&
    canonical(JSON.parse(source.find(x=>x.name==='result.json').raw))===canonical(result),
    'DATASET_UNPAID_SOURCE_CHANGED');
  const attemptSha256=digest(attemptRaw);
  return {schema:SCHEMA,index:attempt.index,intentId:cfg.operation.intentId,
    configurationSha256:attempt.configurationSha256,attemptSha256,
    originalError:{code:summary.error.code,
      ...(typeof summary.error.operatorReason==='string'?{operatorReason:summary.error.operatorReason}:{})},
    historyDirectory:join(directory,'unpaid-history',attemptSha256),source};
}
export async function inspectUnpaidContinuation(directory,cfg,attempt,result) {
  const candidate=await eligible(directory,cfg,attempt,result);
  return candidate?view(candidate,'AVAILABLE'):null;
}
function ledgerAbsent(cfg,configurationPath,configurationSha256,environment,signal) {
  need(process.platform!=='win32','WORKSPACE_POSIX_OPERATOR_REQUIRED');
  const env={LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
  for(const key of KEYS) {
    need(typeof environment[key]==='string'&&environment[key].length<=4096,'DATASET_ORIGINAL_OPERATOR_KEYS_REQUIRED');
    env[key]=environment[key];
  }
  return new Promise((resolve,reject)=>{
    const child=spawn(cfg.operator.python,['-I','-B','-u',WORKER,
      '--config',configurationPath,'--sha256',configurationSha256],
      {env,shell:false,stdio:['ignore','pipe','ignore']});
    const chunks=[];let size=0,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);
      signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill('SIGKILL');finish(new InputError('OPERATOR_ABORTED'));};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new InputError('DATASET_UNPAID_LEDGER_TIMEOUT'));},35000);
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
    child.once('error',()=>finish(new InputError('DATASET_UNPAID_LEDGER_START_FAILED')));
    child.stdout.on('data',raw=>{size+=raw.length;if(size>8192){child.kill('SIGKILL');
      finish(new InputError('DATASET_UNPAID_LEDGER_RESULT_TOO_LARGE'));}else chunks.push(raw);});
    child.once('close',code=>{
      if(done)return;
      try{
        const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if(value.schema!=='stellar-forge.sf88.unpaid-ledger-check.v1')throw new Error();
        if(code!==0||value.outcome!=='ABSENT_FROM_AUTHENTICATED_ORIGINAL_LEDGER') {
          const reason=/^[A-Z0-9_]{1,120}$/.test(value.code??'')?value.code:'DATASET_UNPAID_LEDGER_REFUSED';
          return finish(new InputError(reason));
        }
        need(value.intentId===cfg.operation.intentId&&value.ledger===cfg.operator.ledger&&
          value.reservationsForIntent===0,'DATASET_UNPAID_LEDGER_MISMATCH');
        finish(null,value);
      }catch{finish(new InputError('DATASET_UNPAID_LEDGER_RESULT_INVALID'));}
    });
  });
}
/** Called only while the original dataset run lock is held. */
export async function continueUnpaidPage(directory,cfg,{expectedAttemptSha256,environment,signal}={}) {
  need(HASH.test(expectedAttemptSha256??''),'DATASET_UNPAID_ATTEMPT_REVIEW_REQUIRED');
  need(!signal?.aborted,'OPERATOR_ABORTED');
  const pending=await pendingUnpaidContinuation(directory,cfg);
  let plan,source;
  if(pending) {
    need(pending.attemptSha256===expectedAttemptSha256,'DATASET_UNPAID_ATTEMPT_CHANGED');
    plan=validPlan(await json(join(pending.historyDirectory,'plan.json')),directory,cfg);
  }else{
    const candidate=await eligible(directory,cfg,await json(join(directory,'attempt.json')),
      await json(join(directory,'result.json')));
    need(candidate&&candidate.attemptSha256===expectedAttemptSha256,'DATASET_UNPAID_ATTEMPT_CHANGED');
    source=candidate.source;
    plan={...candidate,files:source.map(({raw,...metadata})=>metadata),recordedAt:new Date().toISOString()};
    delete plan.source;
  }
  const original=paths(directory,cfg);
  const cfgRaw=await bytes(original['config.json'],65536);
  need(digest(cfgRaw)===plan.files.find(x=>x.name==='config.json').sha256,'DATASET_UNPAID_CONFIG_CHANGED');
  need(await bytes(cfg.responseFile.destination,1,true)===null,'DATASET_UNPAID_RESPONSE_EXISTS');
  // This guard authenticates the original ledger under the same SF81 flock.
  // Normal SF81 approval subsequently requires a fresh atomic reservation, so
  // another original operator claiming this ID after the read cannot duplicate payment.
  const checked=await ledgerAbsent(cfg,original['config.json'],digest(cfgRaw),environment,signal);
  need(!signal?.aborted,'OPERATOR_ABORTED');
  const root=join(directory,'unpaid-history');
  await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(root);
  await mkdir(plan.historyDirectory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateDirectory(plan.historyDirectory);
  if(!pending)await createAtomic(join(plan.historyDirectory,'plan.json'),plan);
  for(const file of plan.files) {
    const archive=join(plan.historyDirectory,file.name);
    let raw=await bytes(archive,262144,true);
    if(raw===null) {
      raw=source?.find(x=>x.name===file.name)?.raw??await bytes(original[file.name],262144);
      need(raw.length===file.bytes&&digest(raw)===file.sha256,'DATASET_UNPAID_SOURCE_CHANGED');
      await createAtomic(archive,raw);
    }
    need(raw.length===file.bytes&&digest(raw)===file.sha256,'DATASET_UNPAID_HISTORY_CHANGED');
  }
  const archived=join(plan.historyDirectory,'archived.json');
  if(!await json(archived,true))await createAtomic(archived,{schema:SCHEMA,
    attemptSha256:plan.attemptSha256,outcome:'ORIGINAL_BYTES_DURABLY_ARCHIVED',
    archivedAt:new Date().toISOString(),originalLedgerCheck:checked});
  // Keep the durable attempt marker until every terminal file is archived and
  // removed. A crash in this phase remains PREPARED, which ordinary run refuses.
  for(const name of ['result.json','failure.json','evidence.json','attempt.json']) {
    const expected=plan.files.find(x=>x.name===name);
    const raw=await bytes(original[name],262144,true);
    if(raw!==null) {
      need(expected&&raw.length===expected.bytes&&digest(raw)===expected.sha256,
        'DATASET_UNPAID_SOURCE_CHANGED');
      await unlink(original[name]);await sync(dirname(original[name]));
    }
  }
  await createAtomic(join(plan.historyDirectory,'continued.json'),{schema:SCHEMA,
    attemptSha256:plan.attemptSha256,outcome:'ORIGINAL_UNPAID_ATTEMPT_ARCHIVED',
    completedAt:new Date().toISOString()});
  return view(plan,'ARCHIVED');
}
