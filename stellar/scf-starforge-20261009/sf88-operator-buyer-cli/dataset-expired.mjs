// MIT. Explicit continuation of a source-bound expired, untransferred Dataset page.
import {spawn,spawnSync} from 'node:child_process';
import {constants} from 'node:fs';
import {lstat,readdir,unlink,realpath,open,rename} from 'node:fs/promises';
import {join,dirname,resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {need,InputError} from './config.mjs';
import {canonical,digest} from './dataset-page.mjs';
import {readAttemptWireCheckpoint} from './attempt-wire.mjs';
import {privateDirectory,readBytes,readJson,writeBytes,jsonBytes,syncDirectory,exists} from './node/store.mjs';

const SCHEMA='stellar-forge.sf88.expired-page-continuation.v1';
const SOURCE='stellar-forge.sf36.expired-authorization-source.v1';
const WORKER=fileURLToPath(new URL('../sf36-spend-governor/expired_authorization.py',import.meta.url));
const HASH=/^[a-f0-9]{64}$/;
const KEYS=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const MAX=16*1024*1024;
const names=new Set(['config.json','attempt.json','result.json','failure.json','evidence.json',
  'response-lock','response-partial']);

function absolute(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0'),
    'DATASET_EXPIRY_ABSOLUTE_PATH_REQUIRED');
  return path;
}
async function directory(path,{create=false}={}) {
  absolute(path);await privateDirectory(path,{create});
  need(await realpath(path)===path,'DATASET_EXPIRY_SYMLINK_DIRECTORY_REFUSED');
}
async function file(path,{optional=false,limit=MAX}={}) {
  try {
    const info=await lstat(path);
    need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&info.size<=limit&&
      (process.platform==='win32'||!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid())),
      'DATASET_EXPIRY_PRIVATE_ORIGINAL_FILE_REQUIRED');
    return await readBytes(path,limit);
  }catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
}
function parse(raw) {
  try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}
  catch{throw new InputError('DATASET_EXPIRY_JSON_INVALID');}
}
async function json(path,optional=false) {
  const raw=await file(path,{optional,limit:1048576});return raw===null?null:parse(raw);
}
async function retained(path,raw) {
  const old=await file(path,{optional:true,limit:Math.max(raw.length,1048576)});
  if(old!==null){need(old.equals(raw),'DATASET_EXPIRY_HISTORY_CHANGED');return;}
  // Every caller holds the original Dataset run lock. Its private history has
  // one writer and complete bytes are renamed before any original is removed.
  await writeBytes(path,raw);
}
const writeRecord=(path,value)=>retained(path,jsonBytes(value));
function validPlan(plan,page,cfg) {
  need(plan?.schema===SCHEMA&&plan.intentId===cfg.operation.intentId&&
    plan.configurationSha256===digest(canonical(cfg))&&HASH.test(plan.attemptSha256??'')&&
    HASH.test(plan.requestSha256??'')&&HASH.test(plan.sourceSha256??'')&&
    HASH.test(plan.proofSha256??'')&&HASH.test(plan.generation??'')&&HASH.test(plan.releaseJournalMac??'')&&
    (plan.previousReleaseJournalMac===null||HASH.test(plan.previousReleaseJournalMac??''))&&
    Number.isSafeInteger(plan.index)&&plan.index>=1&&plan.index<=10000&&
    plan.historyDirectory===join(page,'expired-history',plan.attemptSha256)&&
    Array.isArray(plan.files)&&plan.files.length>=2&&plan.files.length<=8&&
    new Set(plan.files.map(x=>x.name)).size===plan.files.length&&
    plan.files.every(x=>names.has(x.name)&&isAbsolute(x.path)&&
      (x.state==='ABSENT'&&x.bytes===0&&x.sha256===null||
       x.state==='SAVED'&&HASH.test(x.sha256??'')&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&x.bytes<=MAX))&&
    plan.files.some(x=>x.name==='config.json'&&x.path===join(page,'config.json')&&x.state==='SAVED')&&
    plan.files.some(x=>x.name==='attempt.json'&&x.path===join(page,'attempt.json')&&
      x.state==='SAVED'&&x.sha256===plan.attemptSha256),
    'DATASET_EXPIRY_HISTORY_INVALID');
  absolute(plan.sourceFile);absolute(plan.reportsDirectory);
  return plan;
}
const view=(plan,status)=>({status,index:plan.index,intentId:plan.intentId,attemptSha256:plan.attemptSha256,
  generation:plan.generation,releaseJournalMac:plan.releaseJournalMac,
  previousReleaseJournalMac:plan.previousReleaseJournalMac,proofSha256:plan.proofSha256,
  historyDirectory:plan.historyDirectory,sourceFile:plan.sourceFile,sourceSha256:plan.sourceSha256,
  requestSha256:plan.requestSha256,reportsDirectory:plan.reportsDirectory});

export async function pendingExpiredContinuation(page,cfg) {
  const root=join(page,'expired-history');
  if(!await exists(root))return null;
  await directory(root);
  const entries=(await readdir(root)).filter(x=>HASH.test(x));
  need(entries.length<=128,'DATASET_EXPIRY_HISTORY_LIMIT');
  const records=[],byRelease=new Map(),children=new Map(),generations=new Set();
  for(const name of entries) {
    const history=join(root,name);await directory(history);
    const value=await json(join(history,'plan.json'),true);if(!value)continue;
    const plan=validPlan(value,page,cfg),continued=await json(join(history,'continued.json'),true);
    need(plan.attemptSha256===name&&!byRelease.has(plan.releaseJournalMac)&&!generations.has(plan.generation),
      'DATASET_EXPIRY_HISTORY_GENERATION_CONFLICT');
    if(continued)need(continued.schema===SCHEMA&&continued.attemptSha256===name&&
      continued.outcome==='ORIGINAL_EXPIRED_ATTEMPT_ARCHIVED'&&
      continued.releaseJournalMac===plan.releaseJournalMac,'DATASET_EXPIRY_HISTORY_INVALID');
    const record={plan,continued};records.push(record);byRelease.set(plan.releaseJournalMac,record);
    generations.add(plan.generation);
  }
  // The authenticated original SF36 resume event binds the predecessor release.
  // This remains a durable lineage after a later attempt has also been archived.
  for(const {plan} of records) {
    const previous=plan.previousReleaseJournalMac;
    if(previous===null)continue;
    need(previous!==plan.releaseJournalMac&&!children.has(previous),'DATASET_EXPIRY_HISTORY_BRANCH');
    children.set(previous,plan.releaseJournalMac);
    const parent=byRelease.get(previous);
    if(parent)need(parent.continued&&parent.plan.requestSha256===plan.requestSha256&&
      parent.plan.generation!==plan.generation,'DATASET_EXPIRY_HISTORY_PREDECESSOR_INVALID');
    const seen=new Set([plan.releaseJournalMac]);let cursor=previous;
    while(byRelease.has(cursor)) {
      need(!seen.has(cursor),'DATASET_EXPIRY_HISTORY_CYCLE');seen.add(cursor);
      cursor=byRelease.get(cursor).plan.previousReleaseJournalMac;
    }
  }
  let pending=null;
  for(const {plan,continued} of records) {
    if(children.has(plan.releaseJournalMac))continue;
    if(continued) {
      const current=await file(join(page,'attempt.json'),{optional:true,limit:8192});
      if(current!==null&&digest(current)!==plan.attemptSha256) {
        const attempt=parse(current);
        need(attempt.schema==='stellar-forge.sf88.dataset-attempt.v1'&&attempt.index===plan.index&&
          attempt.intentId===plan.intentId&&attempt.configurationSha256===plan.configurationSha256&&
          attempt.capAtomic===cfg.operation.expect.maxAtomic,'DATASET_EXPIRY_NEW_ATTEMPT_CHANGED');
        continue;
      }
    }
    need(pending===null,'DATASET_MULTIPLE_EXPIRED_CONTINUATIONS');
    pending=view(plan,continued?'ARCHIVED_AWAITING_REAPPROVAL':'PREPARED');
  }
  return pending;
}

function worker(action,cfg,selection,environment,signal) {
  need(!signal?.aborted,'OPERATOR_ABORTED');
  need(process.platform!=='win32','WORKSPACE_POSIX_OPERATOR_REQUIRED');
  const env={LANG:'C.UTF-8',LC_ALL:'C.UTF-8'};
  for(const name of KEYS) {
    need(typeof environment[name]==='string'&&environment[name].length<=4096,
      'DATASET_ORIGINAL_OPERATOR_KEYS_REQUIRED');env[name]=environment[name];
  }
  const args=['-I','-B','-u',WORKER,action,'--source',selection.sourceFile,
    '--ledger',cfg.operator.ledger,'--policy',cfg.operator.policy,'--payer',cfg.trustedPayer,
    '--node',process.execPath,'--expected-request-sha',selection.expectedRequestSha256,
    '--reports',selection.reportsDirectory,
    ...(action==='permit'?['--resume-permit-file',selection.resumePermitFile]:[])];
  return new Promise((resolve,reject)=>{
    const child=spawn(cfg.operator.python,args,{env,shell:false,stdio:['ignore','pipe','ignore']});
    const chunks=[];let size=0,done=false;
    const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);
      signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
    const abort=()=>{child.kill('SIGKILL');finish(new InputError('OPERATOR_ABORTED'));};
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(new InputError('DATASET_EXPIRY_LEDGER_TIMEOUT'));},35000);
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    child.once('error',()=>finish(new InputError('DATASET_EXPIRY_LEDGER_START_FAILED')));
    child.stdout.on('data',raw=>{size+=raw.length;if(size>16384){child.kill('SIGKILL');
      finish(new InputError('DATASET_EXPIRY_LEDGER_RESULT_TOO_LARGE'));}else chunks.push(raw);});
    child.once('close',code=>{
      if(done)return;
      try {
        const result=parse(Buffer.concat(chunks));
        if(code!==0||result.schema!=='stellar-forge.sf36.expired-authorization.v1') {
          const reason=/^[A-Z0-9_]{1,120}$/.test(result.code??'')?result.code:'DATASET_EXPIRY_LEDGER_REFUSED';
          return finish(new InputError(reason));
        }
        need(result.outcome==='EXPIRED_AUTHORIZATION_RELEASED'&&result.state==='expired'&&
          result.request_id===cfg.operation.intentId&&result.request_sha256===selection.expectedRequestSha256&&
          result.current_generation===result.generation&&HASH.test(result.release_journal_mac??''),
          'DATASET_EXPIRY_ORIGINAL_RELEASE_REQUIRED');
        finish(null,result);
      }catch(error){finish(new InputError(error?.code??'DATASET_EXPIRY_LEDGER_RESULT_INVALID'));}
    });
  });
}
function validateSelection(selection,expectedAttemptSha256) {
  need(selection&&typeof selection==='object'&&!Array.isArray(selection)&&
    Object.keys(selection).filter(x=>x!=='expectedUnapprovedAttemptSha256').sort().join(',')===
      'expectedRequestSha256,reportsDirectory,resumePermitFile,sourceFile'&&
    (selection.expectedUnapprovedAttemptSha256===undefined||HASH.test(selection.expectedUnapprovedAttemptSha256))&&
    HASH.test(selection.expectedRequestSha256??'')&&HASH.test(expectedAttemptSha256??''),
    'DATASET_EXPIRY_EXACT_REVIEW_REQUIRED');
  for(const name of ['sourceFile','reportsDirectory','resumePermitFile'])absolute(selection[name]);
}
function mutablePaths(page,cfg) {
  need(cfg.responseFile.destination===join(page,'response.json'),'DATASET_EXPIRY_RESPONSE_PATH_CHANGED');
  return {'config.json':join(page,'config.json'),'attempt.json':join(page,'attempt.json'),
    'result.json':join(page,'result.json'),'failure.json':join(page,'failure.json'),
    'evidence.json':join(cfg.evidenceDir,digest(cfg.operation.intentId)+'.json'),
    'response-lock':join(page,'.response.json.x402-download.lock')};
}
async function originalFiles(page,cfg,source) {
  const paths=mutablePaths(page,cfg);
  const partial=source.files.find(x=>x.role==='response-partial');
  if(partial) {
    need(dirname(partial.path)===page&&/^\.x402-response-[a-f0-9-]{36}\.partial$/.test(partial.path.slice(page.length+1)),
      'DATASET_EXPIRY_PARTIAL_PATH_INVALID');
    paths['response-partial']=partial.path;
  }
  const namesByRole={'config.json':'configuration','attempt.json':'attempt','result.json':'result',
    'failure.json':'failure','evidence.json':'evidence','response-lock':'response-lock',
    'response-partial':'response-partial'};
  const files=[];
  for(const [name,path] of Object.entries(paths)) {
    const selected=source.files.find(x=>x.role===namesByRole[name]);
    const raw=await file(path,{optional:true});
    if(raw!==null)need(selected?.path===path&&selected.bytes===raw.length&&selected.sha256===digest(raw),
      'DATASET_EXPIRY_ORIGINAL_FILE_NOT_IN_RELEASE');
    else need(!selected||selected.path===path&&selected.state==='ABSENT',
      'DATASET_EXPIRY_ORIGINAL_FILE_CHANGED');
    files.push({name,path,state:raw===null?'ABSENT':'SAVED',bytes:raw?.length??0,
      sha256:raw===null?null:digest(raw)});
  }
  need(files.find(x=>x.name==='config.json').state==='SAVED'&&
    files.find(x=>x.name==='attempt.json').state==='SAVED','DATASET_EXPIRY_ORIGINAL_ATTEMPT_REQUIRED');
  return files;
}



const EXPIRED_WIRE='stellar-forge.sf88.expired-wire-archive.v1';
const EXPIRED_WIRE_FILES=new Set(['source.json','unsigned-request.json','unsigned-dispatch.json',
  'unsigned-response.json','unsigned-error.json','signing-input.json','signing-result.json',
  'signing-error.json','signed-request.json','signed-dispatch.json','signed-response.json','signed-error.json']);

/** Archive the actual released attempt's complete original wire under its
 * existing Dataset history. The worker's authenticated proof retains every
 * selected byte; the original wire lock stays held across its directory rename. */
async function archiveExpiredWire(page,cfg,plan,source,selection,environment,signal) {
  const wireDirectory=join(cfg.evidenceDir,'wire-'+digest(cfg.operation.intentId));
  const archivedDirectory=join(plan.historyDirectory,'wire');
  const planPath=join(plan.historyDirectory,'wire-plan.json');
  const selected=source.files.filter(item=>item.role.startsWith('wire-'));
  const originalExists=await exists(wireDirectory),archivedExists=await exists(archivedDirectory);
  if(selected.length===0) {
    need(!originalExists&&!archivedExists&&!await exists(planPath),
      'DATASET_EXPIRY_ORIGINAL_WIRE_NOT_IN_RELEASE');
    return;
  }
  need(selected.length<=EXPIRED_WIRE_FILES.size&&
    new Set(selected.map(item=>item.role)).size===selected.length&&selected.every(item=>{
      const name=item.role.slice(5)+'.json';
      return EXPIRED_WIRE_FILES.has(name)&&item.path===join(wireDirectory,name)&&
        (item.state==='ABSENT'&&item.bytes===0&&(item.sha256===undefined||item.sha256===null)||
         HASH.test(item.sha256??'')&&Number.isSafeInteger(item.bytes)&&item.bytes>=1&&item.bytes<=MAX);
    }),'DATASET_EXPIRY_RELEASED_WIRE_SELECTION_INVALID');
  const files=selected.filter(item=>item.state!=='ABSENT').map(item=>({
    name:item.role.slice(5)+'.json',bytes:item.bytes,sha256:item.sha256,
  })).sort((a,b)=>a.name.localeCompare(b.name));
  need(files.some(item=>item.name==='source.json'),'DATASET_EXPIRY_RELEASED_WIRE_SOURCE_REQUIRED');
  const wirePlan={schema:EXPIRED_WIRE,intentId:cfg.operation.intentId,
    attemptSha256:plan.attemptSha256,configurationSha256:plan.configurationSha256,
    sourceSha256:plan.sourceSha256,proofSha256:plan.proofSha256,generation:plan.generation,
    releaseJournalMac:plan.releaseJournalMac,wireDirectory,archivedDirectory,files};
  const saved=await json(planPath,true);
  if(saved)need(canonical(saved)===canonical(wirePlan),'DATASET_EXPIRY_WIRE_ARCHIVE_PLAN_CHANGED');
  else {
    need(originalExists&&!archivedExists,'DATASET_EXPIRY_ORIGINAL_WIRE_UNAVAILABLE');
    const retainedWire=await readAttemptWireCheckpoint({cfg,includeWire:true});
    const wire=retainedWire?.snapshot;
    const originalAttempt=parse(await file(join(plan.historyDirectory,'attempt.json'),{limit:8192}));
    need(wire&&wire.writerActive===false&&wire.intentId===cfg.operation.intentId&&
      wire.configValueSha256===plan.configurationSha256&&
      wire.sourceSha256===files.find(item=>item.name==='source.json').sha256&&
      typeof retainedWire.source?.recordedAt==='string'&&
      Number.isFinite(Date.parse(retainedWire.source.recordedAt))&&
      Date.parse(retainedWire.source.recordedAt)>=Date.parse(originalAttempt.startedAt)&&
      files.every(item=>item.name==='source.json'||
        wire.records[item.name.slice(0,-5)]?.sha256===item.sha256&&
        wire.records[item.name.slice(0,-5)]?.bytes===item.bytes),
      'DATASET_EXPIRY_RELEASED_ORIGINAL_WIRE_CHANGED');
    await writeRecord(planPath,wirePlan);
  }
  need(!(originalExists&&archivedExists)&&(originalExists||archivedExists),
    'DATASET_EXPIRY_WIRE_ARCHIVE_CONFLICT');
  const currentDirectory=originalExists?wireDirectory:archivedDirectory;
  await directory(currentDirectory);
  const held=await wireOwnership(currentDirectory);
  try {
    const present=(await readdir(currentDirectory)).filter(name=>name!=='active.lock').sort();
    need(canonical(present)===canonical(files.map(item=>item.name).sort()),
      'DATASET_EXPIRY_RELEASED_WIRE_CHANGED');
    for(const item of files) {
      const raw=await file(join(currentDirectory,item.name));
      need(raw.length===item.bytes&&digest(raw)===item.sha256,'DATASET_EXPIRY_RELEASED_WIRE_CHANGED');
    }
    const checked=await worker('read',cfg,selection,environment,signal);
    need(checked.source_sha256===plan.sourceSha256&&checked.proof_sha256===plan.proofSha256&&
      checked.generation===plan.generation&&checked.current_generation===plan.generation&&
      checked.release_journal_mac===plan.releaseJournalMac,
      'DATASET_EXPIRY_RELEASED_WIRE_GENERATION_CHANGED');
    need(!signal?.aborted,'OPERATOR_ABORTED');
    if(originalExists) {
      await rename(wireDirectory,archivedDirectory);
      await syncDirectory(dirname(wireDirectory));await syncDirectory(plan.historyDirectory);
    }
    const receiptPath=join(plan.historyDirectory,'wire-archived.json');
    const receipt=await json(receiptPath,true);
    if(receipt)need(receipt.schema===EXPIRED_WIRE&&
      receipt.outcome==='ORIGINAL_EXPIRED_WIRE_DURABLY_ARCHIVED'&&
      receipt.attemptSha256===plan.attemptSha256&&receipt.releaseJournalMac===plan.releaseJournalMac&&
      receipt.planSha256===digest(jsonBytes(wirePlan)),'DATASET_EXPIRY_WIRE_ARCHIVE_RECEIPT_CHANGED');
    else await writeRecord(receiptPath,{schema:EXPIRED_WIRE,
      outcome:'ORIGINAL_EXPIRED_WIRE_DURABLY_ARCHIVED',attemptSha256:plan.attemptSha256,
      releaseJournalMac:plan.releaseJournalMac,planSha256:digest(jsonBytes(wirePlan)),
      archivedAt:new Date().toISOString()});
  }finally{await held.close();}
}

const UNAPPROVED='stellar-forge.sf88.unapproved-expired-successor.v1';
const WIRE_FILES=new Set(['source.json','unsigned-request.json','unsigned-dispatch.json',
  'unsigned-response.json','unsigned-error.json']);
async function wireOwnership(path) {
  const handle=await open(join(path,'active.lock'),constants.O_RDWR|(constants.O_NOFOLLOW??0));
  try {
    const info=await handle.stat(),named=await lstat(join(path,'active.lock'));
    need(info.isFile()&&info.nlink===1&&!(info.mode&0o077)&&!named.isSymbolicLink()&&
      info.dev===named.dev&&info.ino===named.ino&&(!process.getuid||info.uid===process.getuid()),
      'DATASET_EXPIRY_WIRE_LOCK_CHANGED');
    const locked=spawnSync('flock',['--exclusive','--nonblock','--conflict-exit-code','73','3'],
      {stdio:['ignore','pipe','pipe',handle.fd],timeout:10000});
    need(!locked.error&&locked.status===0,locked.status===73?'WIRE_ATTEMPT_ACTIVE':'WIRE_FLOCK_REQUIRED');
    return handle;
  }catch(error){await handle.close();throw error;}
}
function successorPaths(page,cfg,partial) {
  const paths=mutablePaths(page,cfg);
  if(partial!==null) {
    need(dirname(partial)===page&&/^\.x402-response-[a-f0-9-]{36}\.partial$/.test(partial.slice(page.length+1)),
      'DATASET_EXPIRY_PARTIAL_PATH_INVALID');
    paths['response-partial']=partial;
  }
  return paths;
}
function validSuccessor(value,page,cfg,releasePlan,expected) {
  need(value?.schema===UNAPPROVED&&value.attemptSha256===expected&&
    value.parentAttemptSha256===releasePlan.attemptSha256&&
    value.releaseJournalMac===releasePlan.releaseJournalMac&&value.generation===releasePlan.generation&&
    value.intentId===cfg.operation.intentId&&value.configurationSha256===digest(canonical(cfg))&&
    value.historyDirectory===join(releasePlan.historyDirectory,'unapproved',expected)&&
    value.wireDirectory===join(cfg.evidenceDir,'wire-'+digest(cfg.operation.intentId))&&
    HASH.test(value.wireSourceSha256??'')&&Array.isArray(value.wireFiles)&&
    value.wireFiles.length>=1&&value.wireFiles.length<=5&&
    new Set(value.wireFiles.map(x=>x.name)).size===value.wireFiles.length&&
    value.wireFiles.every(x=>WIRE_FILES.has(x.name)&&HASH.test(x.sha256??'')&&
      Number.isSafeInteger(x.bytes)&&x.bytes>=1&&x.bytes<=MAX)&&
    value.wireFiles.some(x=>x.name==='source.json'&&x.sha256===value.wireSourceSha256),
    'DATASET_EXPIRY_UNAPPROVED_HISTORY_INVALID');
  const paths=successorPaths(page,cfg,value.partialPath);
  need(Array.isArray(value.files)&&value.files.length===Object.keys(paths).length&&
    new Set(value.files.map(x=>x.name)).size===value.files.length&&
    value.files.every(x=>paths[x.name]===x.path&&
      (x.state==='ABSENT'&&x.sha256===null&&x.bytes===0||
       x.state==='SAVED'&&HASH.test(x.sha256??'')&&Number.isSafeInteger(x.bytes)&&x.bytes>=0&&x.bytes<=MAX))&&
    ['config.json','attempt.json','result.json'].every(name=>value.files.some(x=>x.name===name&&x.state==='SAVED'))&&
    value.files.find(x=>x.name==='attempt.json').sha256===expected,
    'DATASET_EXPIRY_UNAPPROVED_HISTORY_INVALID');
  return value;
}
async function checkUnsignedFiles(wireDirectory,plan) {
  await directory(wireDirectory);
  const present=(await readdir(wireDirectory)).filter(name=>name!=='active.lock').sort();
  need(canonical(present)===canonical(plan.wireFiles.map(x=>x.name).sort()),
    'DATASET_EXPIRY_UNSIGNED_WIRE_CHANGED');
  for(const selected of plan.wireFiles) {
    const raw=await file(join(wireDirectory,selected.name));
    need(raw.length===selected.bytes&&digest(raw)===selected.sha256,'DATASET_EXPIRY_UNSIGNED_WIRE_CHANGED');
  }
}

/** A fresh review can be interrupted before the original gate reserves again.
 * Retain that exact unsigned successor under its released parent. The original
 * wire lock and authenticated unchanged generation distinguish it from a newly
 * reserved or signed attempt, which must use its own original reconciliation. */
async function archiveUnapprovedSuccessor(page,cfg,releasePlan,selection,environment,signal) {
  const expected=selection.expectedUnapprovedAttemptSha256;
  need(HASH.test(expected??'')&&expected!==releasePlan.attemptSha256,
    'DATASET_EXPIRY_UNAPPROVED_ATTEMPT_REVIEW_REQUIRED');
  const history=join(releasePlan.historyDirectory,'unapproved',expected);
  const wireDirectory=join(cfg.evidenceDir,'wire-'+digest(cfg.operation.intentId));
  let plan=await json(join(history,'plan.json'),true);
  if(plan)validSuccessor(plan,page,cfg,releasePlan,expected);
  else {
    const current=await file(join(page,'attempt.json'),{limit:8192}),attempt=parse(current);
    need(digest(current)===expected&&attempt.schema==='stellar-forge.sf88.dataset-attempt.v1'&&
      attempt.index===releasePlan.index&&attempt.intentId===cfg.operation.intentId&&
      attempt.configurationSha256===digest(canonical(cfg))&&attempt.capAtomic===cfg.operation.expect.maxAtomic,
      'DATASET_EXPIRY_UNAPPROVED_ATTEMPT_CHANGED');
    const result=await json(join(page,'result.json'));
    const summary=result?.summary;
    need(result?.schema==='stellar-forge.sf88.dataset-attempt-result.v1'&&
      summary?.mode==='ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT'&&summary.intentId===cfg.operation.intentId&&
      summary.error?.paymentSent===false&&summary.operatorReservation===null&&summary.status===null&&
      summary.httpStatus===null&&summary.responseFile?.status==='NOT_STARTED'&&
      summary.responseFile.destination===cfg.responseFile.destination,
      'DATASET_EXPIRY_ORIGINAL_UNAPPROVED_RESULT_REQUIRED');
    const retainedWire=await readAttemptWireCheckpoint({cfg,includeWire:true});
    const wire=retainedWire?.snapshot;
    need(wire&&wire.writerActive===false&&wire.signingEntered===false&&
      wire.signedDispatchRecorded===false&&wire.signedResponseRecorded===false&&
      wire.sourceSha256===summary.transportCheckpoint?.sourceSha256&&
      wire.configValueSha256===attempt.configurationSha256&&
      Date.parse(retainedWire.source.recordedAt)>=Date.parse(attempt.startedAt),
      'DATASET_EXPIRY_ORIGINAL_UNSIGNED_WIRE_REQUIRED');
    const partials=(await readdir(page)).filter(x=>/^\.x402-response-[a-f0-9-]{36}\.partial$/.test(x));
    need(partials.length<=1,'DATASET_EXPIRY_PARTIAL_SELECTION_REQUIRED');
    const partialPath=partials.length?join(page,partials[0]):null,files=[];
    for(const [name,path]of Object.entries(successorPaths(page,cfg,partialPath))) {
      const raw=await file(path,{optional:true});
      if(name==='response-partial')need(raw.length===0,'DATASET_EXPIRY_UNSIGNED_PARTIAL_NOT_EMPTY');
      files.push({name,path,state:raw===null?'ABSENT':'SAVED',bytes:raw?.length??0,
        sha256:raw===null?null:digest(raw)});
    }
    const wireFiles=[];
    for(const name of (await readdir(wireDirectory)).filter(x=>x!=='active.lock')) {
      need(WIRE_FILES.has(name),'DATASET_EXPIRY_SIGNED_WIRE_REQUIRES_RECONCILIATION');
      const raw=await file(join(wireDirectory,name));
      need(name==='source.json'?digest(raw)===wire.sourceSha256:
        wire.records[name.slice(0,-5)]?.sha256===digest(raw),'DATASET_EXPIRY_UNSIGNED_WIRE_CHANGED');
      wireFiles.push({name,bytes:raw.length,sha256:digest(raw)});
    }
    plan={schema:UNAPPROVED,attemptSha256:expected,parentAttemptSha256:releasePlan.attemptSha256,
      releaseJournalMac:releasePlan.releaseJournalMac,generation:releasePlan.generation,
      intentId:cfg.operation.intentId,configurationSha256:digest(canonical(cfg)),historyDirectory:history,
      wireDirectory,wireSourceSha256:wire.sourceSha256,wireFiles,partialPath,files,
      originalError:summary.error.code,recordedAt:new Date().toISOString()};
    validSuccessor(plan,page,cfg,releasePlan,expected);
    await directory(join(releasePlan.historyDirectory,'unapproved'),{create:true});
    await directory(history,{create:true});await writeRecord(join(history,'plan.json'),plan);
  }
  const archivedWire=join(history,'wire'),originalExists=await exists(wireDirectory);
  need(!(originalExists&&await exists(archivedWire)),'DATASET_EXPIRY_NEW_WIRE_ALREADY_RECORDED');
  const selectedWire=originalExists?wireDirectory:archivedWire;
  await directory(selectedWire);
  const held=await wireOwnership(selectedWire);
  try {
    await checkUnsignedFiles(selectedWire,plan);
    const checked=await worker('read',cfg,selection,environment,signal);
    need(checked.generation===plan.generation&&checked.current_generation===plan.generation&&
      checked.release_journal_mac===plan.releaseJournalMac,'DATASET_EXPIRY_SUCCESSOR_WAS_RESERVED');
    need(await file(cfg.responseFile.destination,{optional:true})===null,
      'DATASET_EXPIRY_RESPONSE_ALREADY_RETAINED');
    const currentCfg=await file(join(page,'config.json'),{limit:262144});
    need(digest(currentCfg)===plan.files.find(x=>x.name==='config.json').sha256&&
      canonical(parse(currentCfg))===canonical(cfg),'DATASET_EXPIRY_ORIGINAL_CONFIGURATION_CHANGED');
    for(const selected of plan.files) {
      if(selected.state==='ABSENT')continue;
      const target=join(history,selected.name);let raw=await file(target,{optional:true});
      if(raw===null){raw=await file(selected.path);need(raw.length===selected.bytes&&digest(raw)===selected.sha256,
        'DATASET_EXPIRY_UNAPPROVED_SOURCE_CHANGED');await retained(target,raw);}
      need(raw.length===selected.bytes&&digest(raw)===selected.sha256,'DATASET_EXPIRY_UNAPPROVED_HISTORY_CHANGED');
    }
    if(originalExists) {
      need(!signal?.aborted,'OPERATOR_ABORTED');
      await rename(wireDirectory,archivedWire);await syncDirectory(dirname(wireDirectory));await syncDirectory(history);
    }
    const archived=join(history,'archived.json');
    if(!await json(archived,true))await writeRecord(archived,{schema:UNAPPROVED,attemptSha256:expected,
      outcome:'ORIGINAL_UNSIGNED_SUCCESSOR_DURABLY_ARCHIVED',releaseJournalMac:plan.releaseJournalMac,
      originalLedgerCheck:checked,archivedAt:new Date().toISOString()});
    for(const name of ['result.json','failure.json','evidence.json','response-lock','response-partial','attempt.json']) {
      const selected=plan.files.find(x=>x.name===name);if(!selected)continue;
      const raw=await file(selected.path,{optional:true});if(raw===null)continue;
      need(selected.state==='SAVED'&&raw.length===selected.bytes&&digest(raw)===selected.sha256,
        'DATASET_EXPIRY_UNAPPROVED_SOURCE_CHANGED');
      need(!signal?.aborted,'OPERATOR_ABORTED');await unlink(selected.path);await syncDirectory(dirname(selected.path));
    }
    const complete=join(history,'continued.json');
    if(!await json(complete,true))await writeRecord(complete,{schema:UNAPPROVED,attemptSha256:expected,
      outcome:'ORIGINAL_UNAPPROVED_SUCCESSOR_ARCHIVED',releaseJournalMac:plan.releaseJournalMac,
      completedAt:new Date().toISOString()});
  }finally{await held.close();}
}

/** Called only under the existing Dataset run lock, with original operator keys.
 * The worker has already observed and released the old generation. This function
 * archives its original files and supplies a private permit for a fresh review. */
export async function continueExpiredPage(page,cfg,{selection,expectedAttemptSha256,environment,signal}={}) {
  validateSelection(selection,expectedAttemptSha256);await directory(page);
  await directory(selection.reportsDirectory);await directory(dirname(selection.resumePermitFile));
  need(await file(cfg.responseFile.destination,{optional:true})===null,'DATASET_EXPIRY_RESPONSE_ALREADY_RETAINED');
  const sourceRaw=await file(selection.sourceFile,{limit:1048576}),source=parse(sourceRaw);
  need(source.schema===SOURCE&&source.sourceKind==='dataset'&&source.configurationFile===join(page,'config.json')&&
    source.attemptFile===join(page,'attempt.json')&&source.approvedRequest?.request_id===cfg.operation.intentId,
    'DATASET_EXPIRY_ORIGINAL_SOURCE_MISMATCH');
  const history=join(page,'expired-history',expectedAttemptSha256);
  let plan=await json(join(history,'plan.json'),true);
  const checked=await worker('read',cfg,selection,environment,signal);
  need(checked.source_sha256===digest(sourceRaw),'DATASET_EXPIRY_DESCRIPTOR_CHANGED');
  if(plan) {
    validPlan(plan,page,cfg);
    need(plan.sourceFile===selection.sourceFile&&plan.sourceSha256===digest(sourceRaw)&&
      plan.reportsDirectory===selection.reportsDirectory&&plan.requestSha256===selection.expectedRequestSha256&&
      plan.proofSha256===checked.proof_sha256&&plan.generation===checked.generation&&
      plan.releaseJournalMac===checked.release_journal_mac&&
      plan.previousReleaseJournalMac===checked.previous_release_journal_mac,'DATASET_EXPIRY_SELECTION_CHANGED');
    const current=await file(join(page,'attempt.json'),{optional:true,limit:8192});
    if(selection.expectedUnapprovedAttemptSha256!==undefined)
      await archiveUnapprovedSuccessor(page,cfg,plan,selection,environment,signal);
    else need(current===null||digest(current)===expectedAttemptSha256,'DATASET_EXPIRY_NEW_ATTEMPT_ALREADY_RECORDED');
  } else {
    need(selection.expectedUnapprovedAttemptSha256===undefined,'DATASET_EXPIRY_ARCHIVED_PARENT_REQUIRED');
    const files=await originalFiles(page,cfg,source);
    const raw=await file(join(page,'attempt.json'),{limit:8192}),attempt=parse(raw);
    need(digest(raw)===expectedAttemptSha256&&attempt.schema==='stellar-forge.sf88.dataset-attempt.v1'&&
      attempt.intentId===cfg.operation.intentId&&attempt.configurationSha256===digest(canonical(cfg)),
      'DATASET_EXPIRY_ORIGINAL_ATTEMPT_CHANGED');
    plan={schema:SCHEMA,index:attempt.index,intentId:attempt.intentId,
      configurationSha256:attempt.configurationSha256,attemptSha256:expectedAttemptSha256,
      sourceFile:selection.sourceFile,sourceSha256:digest(sourceRaw),reportsDirectory:selection.reportsDirectory,
      requestSha256:selection.expectedRequestSha256,proofSha256:checked.proof_sha256,
      generation:checked.generation,releaseJournalMac:checked.release_journal_mac,
      previousReleaseJournalMac:checked.previous_release_journal_mac,
      historyDirectory:history,files,recordedAt:new Date().toISOString()};
    validPlan(plan,page,cfg);
    await directory(join(page,'expired-history'),{create:true});await directory(history,{create:true});
    await writeRecord(join(history,'plan.json'),plan);
  }
  const currentCfg=await file(join(page,'config.json'),{limit:262144});
  need(digest(currentCfg)===plan.files.find(x=>x.name==='config.json').sha256&&
    canonical(parse(currentCfg))===canonical(cfg),'DATASET_EXPIRY_ORIGINAL_CONFIGURATION_CHANGED');
  for(const selected of plan.files) {
    if(selected.state==='ABSENT')continue;
    const path=join(history,selected.name);
    let raw=await file(path,{optional:true});
    if(raw===null){raw=await file(selected.path);need(raw.length===selected.bytes&&digest(raw)===selected.sha256,
      'DATASET_EXPIRY_ORIGINAL_FILE_CHANGED');await retained(path,raw);}
    need(raw.length===selected.bytes&&digest(raw)===selected.sha256,'DATASET_EXPIRY_HISTORY_CHANGED');
  }
  await archiveExpiredWire(page,cfg,plan,source,selection,environment,signal);
  const archived=join(history,'archived.json');
  if(!await json(archived,true))await writeRecord(archived,{schema:SCHEMA,attemptSha256:expectedAttemptSha256,
    outcome:'ORIGINAL_EXPIRED_BYTES_DURABLY_ARCHIVED',releaseJournalMac:plan.releaseJournalMac,
    archivedAt:new Date().toISOString()});
  const allowed=mutablePaths(page,cfg);
  const partial=plan.files.find(x=>x.name==='response-partial');
  if(partial){need(dirname(partial.path)===page&&/^\.x402-response-[a-f0-9-]{36}\.partial$/.test(partial.path.slice(page.length+1)),
    'DATASET_EXPIRY_PARTIAL_PATH_INVALID');allowed['response-partial']=partial.path;}
  for(const name of ['result.json','failure.json','evidence.json','response-lock','response-partial','attempt.json']) {
    const selected=plan.files.find(x=>x.name===name);if(!selected)continue;
    need(selected.path===allowed[name],'DATASET_EXPIRY_MUTATION_PATH_CHANGED');
    const raw=await file(selected.path,{optional:true});
    if(raw===null)continue;
    need(selected.state==='SAVED'&&raw.length===selected.bytes&&digest(raw)===selected.sha256,
      'DATASET_EXPIRY_ORIGINAL_FILE_CHANGED');
    need(!signal?.aborted,'OPERATOR_ABORTED');
    await unlink(selected.path);await syncDirectory(dirname(selected.path));
  }
  const continued=join(history,'continued.json');
  if(!await json(continued,true))await writeRecord(continued,{schema:SCHEMA,attemptSha256:expectedAttemptSha256,
    outcome:'ORIGINAL_EXPIRED_ATTEMPT_ARCHIVED',releaseJournalMac:plan.releaseJournalMac,
    completedAt:new Date().toISOString()});
  const permitted=await worker('permit',cfg,selection,environment,signal);
  need(permitted.proof_sha256===plan.proofSha256&&permitted.generation===plan.generation&&
    permitted.release_journal_mac===plan.releaseJournalMac&&permitted.resumePermit?.file===selection.resumePermitFile,
    'DATASET_EXPIRY_PERMIT_CHANGED');
  return {...view(plan,'ARCHIVED_AWAITING_REAPPROVAL'),resumePermitFile:selection.resumePermitFile,
    resumePermitExpiresAt:permitted.resumePermit.expiresAt};
}
