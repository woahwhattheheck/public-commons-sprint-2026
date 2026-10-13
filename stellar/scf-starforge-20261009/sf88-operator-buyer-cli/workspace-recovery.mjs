// MIT. Original SF88 state closure -> SF101 encryption -> original-path recovery.
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {constants,createWriteStream} from 'node:fs';
import {access,lstat,mkdir,mkdtemp,open,readdir,realpath,rename,rm} from 'node:fs/promises';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {pipeline} from 'node:stream/promises';
import {Transform,Writable} from 'node:stream';
import {config,execution,need,InputError} from './config.mjs';
import {openWorkspace} from './workspace.mjs';
import {openQueue} from './queue.mjs';
import {readObjectRecoveryPlan,inspectObjectSession,acquireObjectRecoveryLease} from './object-session.mjs';

const SCHEMA='stellar-forge.sf88.workspace-recovery.v1';
const COLLECTION='stellar-forge.sf88.workspace-recovery.v2';
const OBJECT='stellar-forge.sf88.object-session-recovery.v1';
const OBJECT_RESTORES='.sf88-object-restorations';
const OBJECT_CAPTURE=Symbol('original-object-capture');
const UNMANAGED='stellar-forge.sf88.unmanaged-state-recovery.v1';
const UNMANAGED_CAPTURE=Symbol('original-unmanaged-state-capture');
const KEY_NAMES=['SF36_CONSENT_KEY_B64','SF36_AUDIT_KEY_B64','SF36_OPERATOR_KEY_B64'];
const CRYPTO=fileURLToPath(new URL('../sf101-merchant-recovery/recover.mjs',import.meta.url));
const LEDGER=fileURLToPath(new URL('./workspace-recovery-ledger.py',import.meta.url));
const MAX_FILES=9500, MAX_BYTES=4*1024**3-16*1024**2, MAX_FILE=2*1024**3;
const json=value=>JSON.stringify(value,null,2)+'\n';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const inside=(root,path)=>root===path||path.startsWith(root+sep);
const error=code=>new InputError(code);

function absolute(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!==sep&&
    !path.includes('\0'),'WORKSPACE_RECOVERY_CANONICAL_PATH_REQUIRED');
  return path;
}
function member(path,{root=false}={}) {
  need(typeof path==='string'&&path.length<=2048&&(root&&path===''||
    !path.includes('\\')&&!path.includes('\0')&&path.split('/').every(p=>p&&p!=='.'&&p!=='..')),
    'WORKSPACE_RECOVERY_MEMBER_INVALID');
  return path;
}
function privateInfo(st) {
  return (st.mode&0o077)===0&&st.uid===process.getuid()&&!st.isSymbolicLink();
}
async function privateDirectory(path) {
  absolute(path);
  const st=await lstat(path);
  need(st.isDirectory()&&privateInfo(st)&&await realpath(path)===path,
    'WORKSPACE_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
  return st;
}
async function regular(path,max=MAX_FILE) {
  need(await realpath(path)===path,'WORKSPACE_RECOVERY_SYMLINK_PARENT');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=await handle.stat();
    need(st.isFile()&&privateInfo(st)&&st.nlink===1&&st.size<=max,
      'WORKSPACE_RECOVERY_PRIVATE_REGULAR_FILE_REQUIRED');
    return {handle,st};
  } catch(e) {await handle.close();throw e;}
}
async function readJson(path,max=12*1024**2) {
  const {handle}=await regular(path,max);
  try {
    const raw=await handle.readFile();
    need(raw.length<=max,'WORKSPACE_RECOVERY_JSON_TOO_LARGE');
    return {raw,value:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw))};
  } finally {await handle.close();}
}
async function existing(path) {
  try {return await lstat(path);}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {await handle.sync();}finally{await handle.close();}
}
async function save(path,value) {
  const handle=await open(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY,0o600);
  try {await handle.writeFile(json(value));await handle.sync();}finally{await handle.close();}
}
function stamp(st) {
  return {dev:st.dev,ino:st.ino,mode:st.mode,size:st.size,mtime:st.mtimeMs,ctime:st.ctimeMs};
}
async function digest(path,destination,signal) {
  need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
  const {handle,st}=await regular(path);
  const hash=createHash('sha256');let size=0;
  const meter=new Transform({transform(chunk,_encoding,cb){size+=chunk.length;hash.update(chunk);cb(null,chunk);}});
  try {
    await pipeline(handle.createReadStream({autoClose:false}),meter,destination?
      createWriteStream(destination,{flags:'wx',mode:0o600}):new Writable({write(_chunk,_encoding,cb){cb();}}),
      {signal});
    need(same(stamp(st),stamp(await handle.stat()))&&size===st.size,
      'WORKSPACE_RECOVERY_SOURCE_CHANGED');
    if(destination) {
      const saved=await open(destination,constants.O_RDONLY|constants.O_NOFOLLOW);
      try {await saved.sync();}finally{await saved.close();}
    }
    return {size,sha256:hash.digest('hex')};
  } finally {await handle.close();}
}
async function checkPython(path) {
  absolute(path);
  need((await lstat(await realpath(path))).isFile(),'WORKSPACE_RECOVERY_PYTHON_REQUIRED');
  await access(path,constants.X_OK);
  return path;
}


/** Standalone zero-cap sessions have native inbox/evidence state but no SF36
 * journal. Keep that absence explicit; never manufacture a managed workspace. */
function objectCheckpoint(report) {
  return {outcome:'ORIGINAL_ZERO_CAP_OBJECT_STATE',sessionId:report.sessionId,
    status:report.progressStatus??report.status,configurationSha256:report.configurationSha256,
    sessionSha256:report.sessionSha256,objectSha256:report.objectSha256,
    bytes:report.bytes,chunkCount:report.chunkCount,completeChunks:report.completeChunks,
    attemptedChunks:report.attemptedChunks,downloadedBytes:report.downloadedBytes,
    capAllocatedAtomic:report.capAllocatedAtomic,chunks:report.chunks};
}
function objectDefinitionBinding(native) {
  const d=native.definition;
  return {sessionId:d.sessionId,directory:d.directory,definitionSha256:native.definitionSha256,
    configurationsSha256:native.configurationsSha256,configurationSha256:d.configurationSha256,
    sourceIntentId:d.config.operation.intentId,sourceUrl:d.config.operation.url,
    deliveryMode:d.deliveryMode,bytes:d.bytes,chunkCount:d.chunkCount,
    expectedSnapshot:d.expectedSnapshot,expectedSha256:d.expectedSha256,limits:d.limits};
}
function freeObject(definition) {
  need(definition.workspace===null&&definition.limits.maxTotalAtomic==='0'&&
    definition.limits.maxAtomic==='0'&&definition.limits.plannedMaxAtomic==='0',
    'OBJECT_RECOVERY_STANDALONE_ZERO_CAP_REQUIRED');
}
async function noObjectLedger(plan,map=path=>path) {
  for(const path of [plan.absentLedger.path,plan.absentLedger.path+'-wal',plan.absentLedger.path+'-shm'])
    need(!(await existing(map(path))),'OBJECT_RECOVERY_LEDGER_PRESENT_USE_WORKSPACE_BACKUP');
}
function objectReview(plan) {
  const {reviewSha256,...value}=plan;
  return sha(Buffer.from(json(value)));
}
function objectLeasePaths(plan,lease) {
  if(!lease)return [];
  need(/^[1-9][0-9]{0,99}$/.test(lease.generation??'')&&
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(lease.nonce??'')&&
    /^[a-f0-9]{64}$/.test(lease.claimSha256??''),'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
  const prefix=relative(plan.stateRoot,join(plan.directory,'leases')).split(sep).join('/');
  return [prefix+'/'+lease.generation+'.json',prefix+'/'+lease.generation+'-'+lease.nonce+'.released.json'];
}
async function readCaptureLease(directory) {
  const report=await inspectObjectSession(directory,{maxChunks:MAX_FILES,maxBytes:MAX_BYTES}),lock=report.lock;
  need(lock?.kind==='BACKUP'&&lock.pid===process.pid&&lock.state==='ACTIVE',
    'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
  const {raw,value}=await readJson(join(directory,'leases',lock.generation+'.json'),4096);
  need(value.schema==='stellar-forge.sf88.object-session-lock.v1'&&value.kind==='BACKUP'&&
    value.pid===process.pid&&value.generation===lock.generation&&value.host===lock.host&&
    value.startedAt===lock.startedAt,'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
  return {generation:value.generation,nonce:value.nonce,claimSha256:sha(raw)};
}
async function objectSourceFiles(plan,{storageRoot=plan.stateRoot,signal,captureLease}={}) {
  const excluded=new Set(objectLeasePaths(plan,captureLease));
  if(storageRoot===plan.stateRoot) {
    const rows=await inventory(plan),result=[];
    for(const row of rows) {
      if(row.path===''||excluded.has(row.path))continue;
      result.push(row.kind==='directory'?{path:row.path,kind:'directory'}:
        {path:row.path,kind:'file',...await digest(join(storageRoot,row.path),undefined,signal)});
    }
    return result;
  }
  const result=[],selected=new Set(plan.sourceFiles.map(row=>row.path)),parents=new Set();
  for(const path of selected) {
    const components=path.split('/');
    while(components.length>1){components.pop();parents.add(components.join('/'));}
  }
  for(const path of plan.parentDirectories)parents.add(relative(plan.stateRoot,path).split(sep).join('/'));
  // Preserve every original lease record. Only this capture's new claim and
  // sealed release are additional members, checked separately below.
  for(const row of await stagedFiles(storageRoot,signal)) {
    if(row.path===''||excluded.has(row.path))continue;
    if(selected.has(row.path))result.push(row);
    else need(row.kind==='directory'&&parents.has(row.path),'OBJECT_RECOVERY_UNSELECTED_CAPTURE_MEMBER');
  }
  return result.sort((a,b)=>a.path.localeCompare(b.path));
}
async function inspectStandaloneObject({directory,stateRoot,include=[]},{signal,captureLease}={}) {
  need(process.platform!=='win32','WORKSPACE_POSIX_OPERATOR_REQUIRED');
  absolute(directory);await privateDirectory(stateRoot);
  need(inside(stateRoot,directory)&&directory!==stateRoot,'OBJECT_RECOVERY_SESSION_OUTSIDE_ROOT');
  need(Array.isArray(include)&&include.length<=64,'WORKSPACE_RECOVERY_ROOT_LIST_INVALID');
  const native=await readObjectRecoveryPlan(directory),definition=native.definition;
  freeObject(definition);
  const {owner,op}=execution(definition.config);
  const requireInside=path=>{
    absolute(path);need(inside(stateRoot,path),'WORKSPACE_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');return path;
  };
  requireInside(owner.ledger);requireInside(owner.policy);requireInside(definition.config.signerModule);
  requireInside(definition.config.evidenceDir);
  const plan={schema:OBJECT,stateRoot,directory,objectSession:objectDefinitionBinding(native),
    absentLedger:{path:owner.ledger,state:'ABSENT'},policy:owner.policy,signer:definition.config.signerModule,
    evidence:definition.config.evidenceDir,include:[...new Set(include)].sort(),inboxes:[],
    selected:[],missing:[owner.ledger,owner.ledger+'-wal',owner.ledger+'-shm'].sort(),
    parentDirectories:[dirname(owner.ledger)],network:op.expect.network,payer:definition.config.trustedPayer??null,
    runtime:[{path:owner.python,retained:false}],walletEnvironmentExported:false,
    restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT'};
  await noObjectLedger(plan);
  const report=await inspectObjectSession(directory,{signal,maxChunks:MAX_FILES,maxBytes:MAX_BYTES});
  need(!report.lock||captureLease&&report.lock.kind==='BACKUP'&&report.lock.pid===process.pid&&
    report.lock.state==='ACTIVE'&&report.lock.generation===captureLease.generation,
    'OBJECT_RECOVERY_STOP_OR_RECOVER_ORIGINAL_WRITER');
  if(captureLease) {
    const path=objectLeasePaths(plan,captureLease)[0];
    need((await digest(join(stateRoot,path),undefined,signal)).sha256===captureLease.claimSha256,
      'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
  }
  need(report.capAllocatedAtomic==='0'&&report.chunks.every(chunk=>chunk.operatorReservation==null&&
    (chunk.nativeBuyerStatus===undefined||chunk.nativeBuyerStatus==='NO_PAYMENT_REQUIRED')),
    'OBJECT_RECOVERY_ZERO_CAP_HISTORY_REQUIRED');
  const selected=new Set([directory,owner.policy,definition.config.signerModule,definition.config.evidenceDir]);
  for(const assembly of native.assemblies) {
    const path=requireInside(assembly.destination),file=await digest(path,undefined,signal);
    need(file.size===assembly.bytes&&file.sha256===assembly.sha256,'OBJECT_RECOVERY_ASSEMBLY_CHANGED');
    selected.add(path);
  }
  for(const path of plan.include){requireInside(path);selected.add(path);}
  const history=join(stateRoot,OBJECT_RESTORES);
  if(await existing(history)){await privateDirectory(history);selected.add(history);}
  const queue=await openQueue(join(directory,'inbox')),jobs=await queue.list();
  need(jobs.length===definition.chunkCount&&jobs.every(job=>job.state!=='REVIEW_REQUIRED'),
    'OBJECT_RECOVERY_INBOX_INVALID');
  for(const job of jobs) {
    const cfg=await config(join(queue.root,'jobs',job.id,'execution.json')),current=execution(cfg);
    need(['actor','service','ledger','policy','python'].every(key=>current.owner[key]===owner[key])&&
      cfg.signerModule===definition.config.signerModule&&cfg.evidenceDir===definition.config.evidenceDir&&
      cfg.trustedPayer===definition.config.trustedPayer&&current.op.expect.maxAtomic==='0',
      'OBJECT_RECOVERY_INBOX_USES_DIFFERENT_OPERATOR');
    for(const name of ['signer','policy']) {
      const dependency=job.dependencies[name],path=requireInside(dependency.path);
      const observed=await digest(path,undefined,signal);
      need(observed.sha256===dependency.sha256&&observed.size===dependency.bytes,
        'WORKSPACE_RECOVERY_ORIGINAL_DEPENDENCY_CHANGED');selected.add(path);
    }
    const partial=job.outcome?.responseFile?.partialPath;
    if(partial&&await existing(requireInside(partial)))selected.add(partial);
  }
  plan.inboxes=[{root:queue.root,jobs:jobs.map(job=>({id:job.id,intentId:job.operation.intentId,
    state:job.state,configSha256:job.configSha256,attemptId:job.attempt?.id??null}))}];
  plan.assemblies=native.assemblies.map(({destination,bytes,sha256,chunkManifestSha256})=>
    ({destination,bytes,sha256,chunkManifestSha256}));
  plan.checkpoint=objectCheckpoint(report);
  plan.selected=[...selected].sort().filter((path,_index,all)=>!all.some(other=>other!==path&&inside(other,path)));
  for(const path of plan.selected) {
    const info=await lstat(path);
    if(info.isDirectory())await privateDirectory(path);
    else {const file=await regular(path);await file.handle.close();}
  }
  for(const path of plan.parentDirectories)await privateDirectory(path);
  plan.sourceFiles=await objectSourceFiles(plan,{signal,captureLease});
  need(Buffer.byteLength(json(plan))<=4*1024**2,'OBJECT_RECOVERY_REVIEW_TOO_LARGE');
  await noObjectLedger(plan);
  need(same(objectDefinitionBinding(await readObjectRecoveryPlan(directory)),plan.objectSession)&&
    same(objectCheckpoint(await inspectObjectSession(directory,{signal,maxChunks:MAX_FILES,maxBytes:MAX_BYTES})),plan.checkpoint),
    'WORKSPACE_RECOVERY_SOURCE_CHANGED');
  return {...plan,reviewSha256:objectReview(plan)};
}

function validateObjectRecord(record) {
  const p=record.plan;
  need(p.schema===OBJECT&&object(p.objectSession)&&object(p.absentLedger)&&p.absentLedger.state==='ABSENT'&&
    p.restoreMode==='ORIGINAL_CANONICAL_STATE_ROOT'&&p.walletEnvironmentExported===false&&
    Array.isArray(p.sourceFiles)&&p.sourceFiles.length<=MAX_FILES&&Array.isArray(p.selected)&&
    Array.isArray(p.parentDirectories)&&Array.isArray(p.missing)&&Array.isArray(p.assemblies)&&
    record.checkpoints===undefined&&p.operators===undefined&&p.checkpoint?.outcome==='ORIGINAL_ZERO_CAP_OBJECT_STATE'&&
    same(record.checkpoint,p.checkpoint)&&object(p.objectSession.limits)&&
    ['maxAtomic','maxTotalAtomic','plannedMaxAtomic'].every(key=>p.objectSession.limits[key]==='0')&&
    /^[a-f0-9]{64}$/.test(p.reviewSha256??'')&&objectReview(p)===p.reviewSha256,
    'OBJECT_RECOVERY_RECORD_INVALID');
  absolute(p.directory);
  need(inside(p.stateRoot,p.directory)&&p.directory!==p.stateRoot&&
    p.objectSession.directory===p.directory,'OBJECT_RECOVERY_RECORD_INVALID');
  for(const path of [p.absentLedger.path,p.policy,p.signer,p.evidence,...p.selected,...p.parentDirectories,
    ...p.missing,...p.assemblies.map(item=>item.destination)]) {
    absolute(path);need(inside(p.stateRoot,path),'OBJECT_RECOVERY_RECORD_PATH_INVALID');
  }
  need(same(p.missing,[p.absentLedger.path,p.absentLedger.path+'-wal',p.absentLedger.path+'-shm'].sort()),
    'OBJECT_RECOVERY_RECORD_INVALID');
  need(record.application?.schema==='stellar-forge.sf88.object-session-capture.v1'&&
    same(record.application.objectSession,p.objectSession),'OBJECT_RECOVERY_RECORD_INVALID');
  objectLeasePaths(p,record.application.snapshotLease);
  need(object(record.application.snapshotLease),'OBJECT_RECOVERY_RECORD_INVALID');
  const paths=new Set();
  for(const row of p.sourceFiles) {
    member(row.path,{root:row.kind==='directory'});
    need(!paths.has(row.path)&&['file','directory'].includes(row.kind),'OBJECT_RECOVERY_RECORD_INVALID');
    paths.add(row.path);
    if(row.kind==='file')need(Number.isSafeInteger(row.size)&&row.size>=0&&row.size<=MAX_FILE&&
      /^[a-f0-9]{64}$/.test(row.sha256??''),'OBJECT_RECOVERY_RECORD_INVALID');
  }
}
async function inspectObjectCapture({staged,record,map,signal}) {
  const p=record.plan,native=await readObjectRecoveryPlan(p.directory,{storageDirectory:map(p.directory)});
  freeObject(native.definition);
  need(same(objectDefinitionBinding(native),p.objectSession),'OBJECT_RECOVERY_ORIGINAL_SESSION_CHANGED');
  const {owner}=execution(native.definition.config);
  need(owner.ledger===p.absentLedger.path&&owner.policy===p.policy&&native.definition.config.signerModule===p.signer&&
    native.definition.config.evidenceDir===p.evidence,'OBJECT_RECOVERY_ORIGINAL_BINDING_INVALID');
  await noObjectLedger(p,map);
  const lease=record.application.snapshotLease,[claimPath,releasePath]=objectLeasePaths(p,lease);
  need(same(p.sourceFiles,await objectSourceFiles(p,{storageRoot:staged,signal,captureLease:lease})),
    'OBJECT_RECOVERY_ORIGINAL_STATE_CHANGED');
  const claim=await readJson(join(staged,claimPath),4096),release=(await readJson(join(staged,releasePath),4096)).value;
  need(sha(claim.raw)===lease.claimSha256&&claim.value.schema==='stellar-forge.sf88.object-session-lock.v1'&&
    claim.value.kind==='BACKUP'&&claim.value.generation===lease.generation&&claim.value.nonce===lease.nonce&&
    release.schema==='stellar-forge.sf88.object-session-lock-release.v1'&&release.generation===lease.generation&&
    release.nonce===lease.nonce&&release.reason==='RECOVERY_SNAPSHOT_COMPLETED'&&
    Number.isFinite(Date.parse(release.releasedAt)),'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
  const leasePrefix=relative(p.stateRoot,join(p.directory,'leases')).split(sep).join('/')+'/';
  const generations=p.sourceFiles.filter(row=>row.kind==='file'&&row.path.startsWith(leasePrefix))
    .map(row=>row.path.slice(leasePrefix.length)).filter(name=>/^[1-9][0-9]{0,99}\.json$/.test(name))
    .map(name=>BigInt(name.slice(0,-5)));
  const last=generations.reduce((max,value)=>value>max?value:max,0n);
  need(BigInt(lease.generation)===last+1n,'OBJECT_RECOVERY_CAPTURE_LEASE_CHANGED');
  for(const assembly of p.assemblies) {
    const file=await digest(map(assembly.destination),undefined,signal);
    need(file.size===assembly.bytes&&file.sha256===assembly.sha256,'OBJECT_RECOVERY_ASSEMBLY_CHANGED');
  }
}
function objectRestoreMarker(record,recordSha256) {
  return {schema:'stellar-forge.sf88.object-session-restoration.v1',recordSha256,
    stateRoot:record.plan.stateRoot,objectSession:record.plan.objectSession,
    reviewSha256:record.plan.reviewSha256,executionStarted:false};
}
async function reopenedObject(record,{signal}={}) {
  await noObjectLedger(record.plan);
  const native=await readObjectRecoveryPlan(record.plan.directory);
  need(same(objectDefinitionBinding(native),record.plan.objectSession),'OBJECT_RECOVERY_ORIGINAL_SESSION_CHANGED');
  const report=await inspectObjectSession(record.plan.directory,{signal,maxBytes:MAX_BYTES,maxChunks:MAX_FILES});
  need(report.capAllocatedAtomic==='0','OBJECT_RECOVERY_ZERO_CAP_HISTORY_REQUIRED');
  return {...objectCheckpoint(report),status:report.status,
    ...(report.progressStatus===undefined?{}:{progressStatus:report.progressStatus}),writer:report.lock??null};
}
async function existingObjectRestore(opened,context) {
  const target=opened.record.plan.stateRoot,marker=join(target,OBJECT_RESTORES,opened.recordSha256+'.json');
  const value=(await readJson(marker,131072)).value;
  need(same(value,objectRestoreMarker(opened.record,opened.recordSha256)),
    'OBJECT_RECOVERY_RESTORE_SELECTION_CHANGED');
  const restored={status:'OBJECT_SESSION_STATE_RESTORED',...result(opened.record,opened.recordSha256),
    executionStarted:false,originalStateRetained:true,reused:true,
    nativeReopenErrors:[],publicationSyncError:null,cleanupErrors:[]};
  try {restored.current=await reopenedObject(opened.record,context);}
  catch(failure){restored.nativeReopenErrors.push({directory:opened.record.plan.directory,
    code:/^[A-Z0-9_]{1,120}$/.test(failure?.code??'')?failure.code:'OBJECT_RECOVERY_REOPEN_FAILED'});}
  return restored;
}

/** Review the complete original zero-cap session, including native outcome files. */
export async function inspectObjectSessionRecovery(options,context={}) {
  return inspectStandaloneObject(options,{signal:context.signal});
}
export async function snapshotObjectSessionRecovery(options,context={}) {
  need(options?.quiesced===true,'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
  need(/^[a-f0-9]{64}$/.test(options.expectedReviewSha256??''),'OBJECT_RECOVERY_EXACT_REVIEW_REQUIRED');
  need(context.prepareSnapshot===undefined&&context.inspectSnapshot===undefined,'OBJECT_RECOVERY_CAPTURE_HOOK_RESERVED');
  const output=absolute(options.output);
  if(await existing(output)) {
    const verified=await verifyObjectSessionRecovery({bundle:output,passEnv:options.passEnv},context);
    need(verified.reviewSha256===options.expectedReviewSha256&&verified.directory===options.directory&&
      verified.stateRoot===options.stateRoot,'OBJECT_RECOVERY_RESTORE_SELECTION_CHANGED');
    return {...verified,status:'OBJECT_SESSION_BACKUP_CREATED',bundle:output,reused:true};
  }
  const before=await inspectStandaloneObject(options,{signal:context.signal});
  need(before.reviewSha256===options.expectedReviewSha256,'OBJECT_RECOVERY_REVIEW_CHANGED');
  const release=await acquireObjectRecoveryLease(options.directory);let published,failure;
  try {
    const captureLease=await readCaptureLease(options.directory);
    const captured=await inspectStandaloneObject(options,{signal:context.signal,captureLease});
    need(captured.reviewSha256===options.expectedReviewSha256,'OBJECT_RECOVERY_REVIEW_CHANGED');
    published=await snapshotWorkspaceRecovery({...options,[OBJECT_CAPTURE]:captureLease},
      {...context,prepareSnapshot:async({staged,stateRoot,plan})=>{
        await release.sealSnapshot(join(staged,relative(stateRoot,plan.directory)));
        return {schema:'stellar-forge.sf88.object-session-capture.v1',objectSession:plan.objectSession,snapshotLease:captureLease};
      }});
  } catch(error){failure=error;}
  try {await release();}
  catch(error) {
    if(published)published.leaseReleaseErrors=[{directory:options.directory,
      code:/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'OBJECT_RECOVERY_LEASE_RELEASE_FAILED'}];
    else if(!failure)failure=error;
  }
  if(failure)throw failure;
  return published;
}
export async function verifyObjectSessionRecovery(options,context={}) {
  const opened=await openBackup({...options,_objectOnly:true},context);
  try {return {status:'OBJECT_SESSION_BACKUP_VERIFIED',...result(opened.record,opened.recordSha256)};}
  finally {await rm(opened.temporary,{recursive:true,force:true});}
}
export async function restoreObjectSessionRecovery(options,context={}) {
  return restoreWorkspaceRecovery({...options,_objectOnly:true},context);
}

/** Preserve existing application files that have no managed Buyer ledger.
 * The calling application validates its own complete original authority. This
 * path never initializes an operator, wallet, inbox, or payment journal. */
export async function inspectUnmanagedStateRecovery({directory,stateRoot,include=[],optionalInclude=[],absentLedgers=[],runtime=[]}={}) {
  need(process.platform!=='win32','WORKSPACE_POSIX_OPERATOR_REQUIRED');
  absolute(directory);await privateDirectory(stateRoot);await privateDirectory(directory);
  need(inside(stateRoot,directory)&&directory!==stateRoot,'WORKSPACE_RECOVERY_WORKSPACE_OUTSIDE_ROOT');
  need(Array.isArray(include)&&include.length<=64&&Array.isArray(optionalInclude)&&optionalInclude.length<=MAX_FILES&&
    Array.isArray(absentLedgers)&&absentLedgers.length<=64&&Array.isArray(runtime)&&runtime.length<=64,
    'WORKSPACE_RECOVERY_ROOT_LIST_INVALID');
  const selected=new Set([directory]),missing=new Set(),parentDirectories=new Set();
  const checked=path=>{absolute(path);need(inside(stateRoot,path),'WORKSPACE_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');return path;};
  for(const ledger of absentLedgers) {
    checked(ledger);need(ledger.endsWith('/reservations.sqlite'),'WORKSPACE_RECOVERY_ABSENT_LEDGER_INVALID');
    for(const path of [ledger,ledger+'-wal',ledger+'-shm']) {
      need(!(await existing(path)),'WORKSPACE_RECOVERY_LEDGER_PRESENT_USE_MANAGED_BACKUP');missing.add(path);
    }
  }
  for(const [paths,optional]of [[include,false],[optionalInclude,true]])for(const path of paths) {
    checked(path);const st=await existing(path);
    if(st) {
      if(st.isDirectory())await privateDirectory(path);else {const f=await regular(path);await f.handle.close();}
      selected.add(path);
    }else {
      need(optional,'WORKSPACE_RECOVERY_DEPENDENCY_MISSING');missing.add(path);
      if(await existing(dirname(path))){await privateDirectory(dirname(path));parentDirectories.add(dirname(path));}
    }
  }
  need(runtime.every(path=>typeof path==='string'&&path.length>0&&path.length<=4096&&!path.includes('\0')),
    'WORKSPACE_RECOVERY_RUNTIME_INVALID');
  const ledgers=[...new Set(absentLedgers)].sort();
  const plan={schema:UNMANAGED,stateRoot,directory,inboxes:[],include:[...new Set(include)].sort(),
    optionalInclude:[...new Set(optionalInclude)].sort(),absentLedgers:ledgers,
    selected:[...selected].sort().filter((path,_i,all)=>!all.some(other=>other!==path&&inside(other,path))),
    missing:[...missing].sort(),parentDirectories:[...parentDirectories].sort(),
    runtime:[...new Set(runtime)].sort().map(path=>({path,retained:false})),
    checkpoint:{outcome:'ORIGINAL_UNMANAGED_STATE',absentLedgers:ledgers},
    walletEnvironmentExported:false,restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT'};
  await inventory(plan);return plan;
}
export async function snapshotUnmanagedStateRecovery(options,context={}) {
  need(typeof context.prepareSnapshot==='function','WORKSPACE_RECOVERY_APPLICATION_VALIDATOR_REQUIRED');
  return snapshotWorkspaceRecovery({...options,[UNMANAGED_CAPTURE]:true},context);
}
function validateUnmanagedRecord(record) {
  const p=record.plan;
  need(p.schema===UNMANAGED&&record.checkpoints===undefined&&p.operators===undefined&&
    p.inboxes.length===0&&Array.isArray(p.selected)&&Array.isArray(p.include)&&Array.isArray(p.optionalInclude)&&
    Array.isArray(p.missing)&&Array.isArray(p.parentDirectories)&&Array.isArray(p.absentLedgers)&&
    p.absentLedgers.length<=64&&p.selected.length<=65&&p.include.length<=64&&
    p.optionalInclude.length<=MAX_FILES&&p.missing.length<=MAX_FILES+192&&
    p.restoreMode==='ORIGINAL_CANONICAL_STATE_ROOT'&&p.walletEnvironmentExported===false&&
    object(record.application)&&Buffer.byteLength(JSON.stringify(record.application))<=1024*1024&&
    same(record.checkpoint,{outcome:'ORIGINAL_UNMANAGED_STATE',absentLedgers:p.absentLedgers})&&
    same(p.checkpoint,record.checkpoint),'WORKSPACE_RECOVERY_UNMANAGED_RECORD_INVALID');
  absolute(p.directory);need(inside(p.stateRoot,p.directory)&&p.directory!==p.stateRoot,'WORKSPACE_RECOVERY_RECORD_PATH_INVALID');
  for(const path of [...p.selected,...p.include,...p.optionalInclude,...p.missing,...p.parentDirectories,...p.absentLedgers]){
    absolute(path);need(inside(p.stateRoot,path),'WORKSPACE_RECOVERY_RECORD_PATH_INVALID');
  }
  need(new Set(p.absentLedgers).size===p.absentLedgers.length,'WORKSPACE_RECOVERY_UNMANAGED_RECORD_INVALID');
  for(const path of p.absentLedgers)need(path.endsWith('/reservations.sqlite')&&
    [path,path+'-wal',path+'-shm'].every(value=>p.missing.includes(value)),'WORKSPACE_RECOVERY_ABSENT_LEDGER_INVALID');
  need(record.files.every(row=>row.kind!=='file'||!/(^|\/)reservations\.sqlite(?:-wal|-shm)?$/.test(row.path)),
    'WORKSPACE_RECOVERY_LEDGER_PRESENT_USE_MANAGED_BACKUP');
}
async function inspectUnmanagedCapture({record,map}) {
  for(const path of record.plan.missing)need(!(await existing(map(path))),'WORKSPACE_RECOVERY_SOURCE_CHANGED');
}

/** Read the actual original workspace and inboxes; do not load wallet custody. */
export async function inspectWorkspaceRecovery({directory,stateRoot,inboxes=[],include=[],operators,optionalInclude=[]}={}) {
  if(operators!==undefined) {
    need(Array.isArray(operators)&&operators.length<=63&&operators.every(path=>typeof path==='string'),
      'WORKSPACE_RECOVERY_OPERATOR_LIST_INVALID');
    const paths=[directory,...operators];
    need(new Set(paths).size===paths.length,'WORKSPACE_RECOVERY_DUPLICATE_OPERATOR');
    const plans=[];
    for(const path of paths)plans.push(await inspectWorkspaceRecovery({directory:path,stateRoot,
      ...(path===directory?{inboxes,include,optionalInclude}:{})}));
    const union=key=>[...new Set(plans.flatMap(plan=>plan[key]))].sort();
    const selected=union('selected').filter((path,_i,all)=>!all.some(other=>other!==path&&inside(other,path)));
    return {...plans[0],schema:COLLECTION,operators:plans.slice(1),selected,
      missing:union('missing'),parentDirectories:union('parentDirectories'),
      runtime:[...new Set(plans.flatMap(plan=>plan.runtime.map(item=>item.path)))].sort()
        .map(path=>({path,retained:false}))};
  }
  need(process.platform!=='win32','WORKSPACE_POSIX_OPERATOR_REQUIRED');
  absolute(directory);await privateDirectory(stateRoot);
  need(inside(stateRoot,directory),'WORKSPACE_RECOVERY_WORKSPACE_OUTSIDE_ROOT');
  need(Array.isArray(inboxes)&&Array.isArray(include)&&Array.isArray(optionalInclude)&&
    inboxes.length<=64&&include.length<=64&&optionalInclude.length<=MAX_FILES,
    'WORKSPACE_RECOVERY_ROOT_LIST_INVALID');
  const workspace=await openWorkspace(['--dir',directory]);
  const {owner}=execution(workspace.config);
  const originalLedger=await regular(owner.ledger);await originalLedger.handle.close();
  const selected=new Set([directory]),missing=new Set(),parentDirectories=new Set(),summaries=[];
  const requireInside=path=>{
    absolute(path);need(inside(stateRoot,path),'WORKSPACE_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
    return path;
  };
  async function dependency(path,{optional=false}={}) {
    if(path===undefined||path===null)return;
    requireInside(path);
    if(await existing(path))selected.add(path);
    else {
      need(optional,'WORKSPACE_RECOVERY_DEPENDENCY_MISSING');missing.add(path);
      const parent=dirname(path);
      if(await existing(parent)) {
        await privateDirectory(parent);parentDirectories.add(parent);
      }
    }
  }
  async function configuration(cfg) {
    const current=execution(cfg);
    need(['actor','service','ledger','policy','python'].every(k=>current.owner[k]===owner[k])&&
      cfg.signerModule===workspace.config.signerModule&&cfg.evidenceDir===workspace.config.evidenceDir&&
      cfg.trustedPayer===workspace.config.trustedPayer,'WORKSPACE_RECOVERY_INBOX_USES_DIFFERENT_OPERATOR');
    await dependency(current.op.bodyFile);
    await dependency(current.op.ticketFile);
    await dependency(current.download?.destination,{optional:true});
  }
  await configuration(workspace.config);
  if(typeof workspace.manifest.sourceConfig==='string'&&inside(stateRoot,workspace.manifest.sourceConfig))
    await dependency(workspace.manifest.sourceConfig,{optional:true});
  for(const root of [...new Set(inboxes)].sort()) {
    requireInside(root);
    const queue=await openQueue(root),jobs=await queue.list();selected.add(root);
    need(jobs.length<=MAX_FILES,'WORKSPACE_RECOVERY_INBOX_TOO_LARGE');
    for(const job of jobs) {
      need(job.state!=='REVIEW_REQUIRED','WORKSPACE_RECOVERY_INBOX_INVALID');
      await configuration(await config(join(root,'jobs',job.id,'execution.json')));
      await dependency(job.outcome?.responseFile?.partialPath,{optional:true});
      const dependencies=job.dependencies;
      for(const name of ['signer','policy']) {
        const observed=await digest(dependencies[name].path);
        need(observed.sha256===dependencies[name].sha256&&observed.size===dependencies[name].bytes,
          'WORKSPACE_RECOVERY_ORIGINAL_DEPENDENCY_CHANGED');
      }
    }
    summaries.push({root,jobs:jobs.map(job=>({id:job.id,intentId:job.operation.intentId,state:job.state,
      configSha256:job.configSha256,attemptId:job.attempt?.id??null,
      finality:job.finalization?.lastFinalized?.result?.receipt_ref??
        job.finalization?.result?.receipt_ref??null}))});
  }
  for(const path of include)await dependency(path);
  for(const path of optionalInclude)await dependency(path,{optional:true});
  const paths=[...selected].sort().filter((path,_i,all)=>!all.some(other=>other!==path&&inside(other,path)));
  for(const path of paths) {
    const st=await lstat(path);
    if(st.isDirectory())await privateDirectory(path);
    else {const {handle}=await regular(path);await handle.close();}
  }
  const runtime=[owner.python,workspace.manifest.sourceCli,workspace.manifest.signer.signerProvider]
    .filter(path=>typeof path==='string');
  return {schema:SCHEMA,stateRoot,directory,inboxes:summaries,include:[...new Set(include)].sort(),
    selected:paths,missing:[...missing].sort(),parentDirectories:[...parentDirectories].sort(),
    network:workspace.manifest.network,payer:workspace.manifest.payer,
    walletEnvironment:workspace.manifest.signer.secretEnv??null,
    ledger:owner.ledger,policy:owner.policy,keys:join(directory,'operator-keys.json'),python:owner.python,
    runtime:runtime.map(path=>({path,retained:false})),
    walletEnvironmentExported:false,restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT',
    ...(optionalInclude.length?{optionalInclude:[...new Set(optionalInclude)].sort()}:{})};
}

const originalOperators=plan=>[OBJECT,UNMANAGED].includes(plan.schema)?[]:[plan,...(plan.operators??[])];
async function inventory(plan) {
  const ledgers=new Set(originalOperators(plan).map(operator=>operator.ledger));
  const excluded=new Set([...ledgers].flatMap(path=>[path+'-wal',path+'-shm']));
  const entries=new Map();let total=0;
  async function walk(path,depth=0) {
    if(excluded.has(path))return;
    const rel=relative(plan.stateRoot,path).split(sep).join('/');
    member(rel,{root:true});
    const st=await lstat(path);
    need(privateInfo(st)&&(st.isFile()||st.isDirectory())&&depth<=15,
      'WORKSPACE_RECOVERY_UNSAFE_SOURCE');
    need(entries.size<MAX_FILES,'WORKSPACE_RECOVERY_FILE_LIMIT');
    if(st.isDirectory()) {
      need(await realpath(path)===path,'WORKSPACE_RECOVERY_SYMLINK_PARENT');
      entries.set(rel,{path:rel,kind:'directory',stamp:stamp(st)});
      for(const name of (await readdir(path)).sort())await walk(join(path,name),depth+1);
    } else {
      need(st.nlink===1&&st.size<=MAX_FILE,'WORKSPACE_RECOVERY_UNSAFE_SOURCE');
      total+=st.size;need(total<=MAX_BYTES,'WORKSPACE_RECOVERY_SIZE_LIMIT');
      if(plan.schema===COLLECTION&&path.endsWith('/reservations.sqlite'))need(ledgers.has(path),
        'WORKSPACE_RECOVERY_UNSELECTED_OPERATOR_LEDGER');
      if([OBJECT,UNMANAGED].includes(plan.schema)&&/\/reservations\.sqlite(?:-wal|-shm)?$/.test(path))
        need(false,'OBJECT_RECOVERY_LEDGER_PRESENT_USE_WORKSPACE_BACKUP');
      entries.set(rel,{path:rel,kind:ledgers.has(path)?'ledger':'file',
        ...(ledgers.has(path)?{identity:{dev:st.dev,ino:st.ino}}:{stamp:stamp(st)})});
    }
  }
  for(const path of plan.selected)await walk(path);
  for(const path of plan.parentDirectories) {
    const rel=relative(plan.stateRoot,path).split(sep).join('/');
    if(!entries.has(rel))entries.set(rel,{path:rel,kind:'directory',stamp:stamp(await privateDirectory(path))});
  }
  for(const path of plan.missing)need(!(await existing(path)),'WORKSPACE_RECOVERY_SOURCE_CHANGED');
  return [...entries.values()].sort((a,b)=>a.path.localeCompare(b.path));
}

async function startLedger(mode,{python,database,policy,keys,destination,signal}) {
  need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
  await checkPython(python);
  const stored=(await readJson(keys,16384)).value;
  need(stored.schema==='stellar-forge.sf88.operator-workspace.v1'&&object(stored.keys)&&
    Object.keys(stored.keys).length===3&&KEY_NAMES.every(k=>typeof stored.keys[k]==='string'),
    'WORKSPACE_RECOVERY_KEYS_INVALID');
  let identity;
  if(mode==='snapshot') {
    const original=await regular(database);
    identity={dev:original.st.dev,ino:original.st.ino};await original.handle.close();
  }
  need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
  const child=spawn(python,['-I','-B',LEDGER,mode,database,policy,...(destination?[destination]:[])],
    {shell:false,env:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8'},stdio:['pipe','pipe','ignore']});
  let output='',first=false,closed=false,failure,resolveReady,rejectReady,resolveDone,rejectDone;
  const ready=new Promise((accept,reject)=>{resolveReady=accept;rejectReady=reject;});
  const done=new Promise((accept,reject)=>{resolveDone=accept;rejectDone=reject;});
  done.catch(()=>{});
  const fail=()=>{
    failure=error('WORKSPACE_RECOVERY_LEDGER_FAILED');
    rejectReady(failure);
  };
  const timer=setTimeout(()=>{child.kill('SIGKILL');fail();},180000);
  const abort=()=>{child.kill('SIGKILL');fail();};
  signal?.addEventListener('abort',abort,{once:true});
  child.once('error',fail);child.stdin.once('error',fail);
  child.stdout.on('data',chunk=>{
    output+=chunk;
    if(output.length>65536){child.kill('SIGKILL');fail();return;}
    const end=output.indexOf('\n');
    if(end<0||first)return;
    first=true;
    try {
      const value=JSON.parse(output.slice(0,end));
      need(value.status===(mode==='snapshot'?'CAPTURE_LOCKED':'LEDGER_VERIFIED')&&
        value.checkpoint?.outcome==='JOURNAL_CONSISTENT','WORKSPACE_RECOVERY_LEDGER_FAILED');
      resolveReady(value.checkpoint);
    } catch{child.kill('SIGKILL');fail();}
  });
  child.once('close',code=>{
    closed=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
    if(code===0&&first&&!failure)resolveDone();
    else {fail();rejectDone(failure);}
  });
  child.stdin.write(JSON.stringify({keys:stored.keys,...(identity?{identity}:{})})+'\n');
  if(mode==='verify')child.stdin.end();
  try {
    const checkpoint=await ready;
    if(mode==='verify')await done;
    return {checkpoint,
      async release(){need(!closed,'WORKSPACE_RECOVERY_LEDGER_LOCK_LOST');child.stdin.end('release\n');await done;},
      async stop(){if(!closed)child.kill('SIGKILL');await done.catch(()=>{});}};
  } catch(e){if(!closed)child.kill('SIGKILL');await done.catch(()=>{});throw e;}
}

async function cryptography(args,passEnv,environment,signal) {
  need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
  need(typeof passEnv==='string'&&/^[A-Z][A-Z0-9_]{4,63}$/.test(passEnv),
    'WORKSPACE_RECOVERY_PASSPHRASE_NAME_INVALID');
  need(passEnv!=='STELLAR_SECRET'&&!KEY_NAMES.includes(passEnv),
    'WORKSPACE_RECOVERY_SEPARATE_PASSPHRASE_REQUIRED');
  const passphrase=environment[passEnv];
  need(typeof passphrase==='string'&&Buffer.byteLength(passphrase)>=16&&
    Buffer.byteLength(passphrase)<=65536,'WORKSPACE_RECOVERY_PASSPHRASE_REQUIRED');
  return await new Promise((accept,reject)=>{
    const child=spawn(process.execPath,[CRYPTO,...args,'--pass-env',passEnv],
      {shell:false,env:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8',[passEnv]:passphrase},
        stdio:['ignore','pipe','ignore']});
    let output='',settled=false,failure=null;
    const finish=(problem,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      problem?reject(problem):accept(result);
    };
    const terminate=code=>{
      failure??=error(code);
      // Keep the original capture directory and its caller's lease alive until
      // this exact crypto process has actually closed.
      child.kill('SIGKILL');
    };
    const abort=()=>terminate('WORKSPACE_RECOVERY_INTERRUPTED');
    const timer=setTimeout(()=>terminate('WORKSPACE_RECOVERY_ARCHIVE_TIMEOUT'),1800000);
    child.once('error',()=>{
      failure??=error('WORKSPACE_RECOVERY_ARCHIVE_START_FAILED');
      if(child.pid===undefined)finish(failure);
      else child.kill('SIGKILL');
    });
    child.stdout.on('data',chunk=>{
      if(failure)return;
      if(output.length+chunk.length>65536)return terminate('WORKSPACE_RECOVERY_ARCHIVE_RESULT_INVALID');
      output+=chunk;
    });
    child.once('close',code=>{
      if(failure)return finish(failure);
      if(code!==0)return finish(error('WORKSPACE_RECOVERY_ARCHIVE_FAILED'));
      try {finish(null,JSON.parse(output));}catch{finish(error('WORKSPACE_RECOVERY_ARCHIVE_RESULT_INVALID'));}
    });
    signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted)abort();
  });
}
async function stagedFiles(root,signal) {
  const files=[];let total=0;
  async function walk(path,rel='') {
    need(files.length<MAX_FILES,'WORKSPACE_RECOVERY_FILE_LIMIT');
    const st=await lstat(path);
    need(privateInfo(st)&&!st.isSymbolicLink(),'WORKSPACE_RECOVERY_STAGED_FILE_INVALID');
    if(st.isDirectory()) {
      files.push({path:rel,kind:'directory'});
      for(const name of (await readdir(path)).sort())await walk(join(path,name),rel?rel+'/'+name:name);
    } else {
      const observed=await digest(path,undefined,signal);total+=observed.size;
      need(total<=MAX_BYTES,'WORKSPACE_RECOVERY_SIZE_LIMIT');
      files.push({path:rel,kind:'file',...observed});
    }
  }
  await walk(root);
  return files.sort((a,b)=>a.path.localeCompare(b.path));
}
function result(record,recordSha256) {
  if(record.schema===UNMANAGED)return {schema:UNMANAGED,recordSha256,createdAt:record.createdAt,
    stateRoot:record.plan.stateRoot,directory:record.plan.directory,checkpoint:record.checkpoint,
    absentLedgers:record.plan.absentLedgers,application:record.application,
    files:record.files.filter(file=>file.kind==='file').length,
    bytes:record.files.reduce((count,file)=>count+(file.size??0),0),runtime:record.plan.runtime,
    walletEnvironmentExported:false,restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT'};
  if(record.schema===OBJECT)return {schema:OBJECT,recordSha256,createdAt:record.createdAt,
    stateRoot:record.plan.stateRoot,directory:record.plan.directory,reviewSha256:record.plan.reviewSha256,
    objectSession:record.plan.objectSession,checkpoint:record.checkpoint,absentLedger:record.plan.absentLedger,
    files:record.files.filter(file=>file.kind==='file').length,
    bytes:record.files.reduce((count,file)=>count+(file.size??0),0),runtime:record.plan.runtime,
    walletEnvironmentExported:false,restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT'};
  return {schema:record.schema,recordSha256,createdAt:record.createdAt,stateRoot:record.plan.stateRoot,
    directory:record.plan.directory,network:record.plan.network,payer:record.plan.payer,
    files:record.files.filter(f=>f.kind==='file').length,
    bytes:record.files.reduce((n,f)=>n+(f.size??0),0),checkpoint:record.checkpoint,
    inboxes:record.plan.inboxes.map(i=>({root:i.root,jobs:i.jobs.length})),
    runtime:record.plan.runtime,walletEnvironmentExported:false,
    ...(record.schema===COLLECTION?{operators:originalOperators(record.plan).map(operator=>({
      directory:operator.directory,ledger:operator.ledger,network:operator.network,payer:operator.payer,
      checkpoint:record.checkpoints.find(item=>item.directory===operator.directory).checkpoint})),
      ...(record.application?{application:record.application}:{})}: {})};
}

/** The caller stops original writers first; the database lock and full source
 * comparison additionally reject a capture that changes under this operation. */
export async function snapshotWorkspaceRecovery(options,{environment=process.env,signal,
  prepareSnapshot,onProgress=()=>{}}={}) {
  need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
  need(options.quiesced===true,'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
  const inspectPlan=()=>options[OBJECT_CAPTURE]?
    inspectStandaloneObject(options,{signal,captureLease:options[OBJECT_CAPTURE]}):options[UNMANAGED_CAPTURE]?
      inspectUnmanagedStateRecovery(options):inspectWorkspaceRecovery(options);
  const plan=await inspectPlan();
  need(originalOperators(plan).every(operator=>(options.passEnv??'SF88_BACKUP_PASSPHRASE')!==operator.walletEnvironment),
    'WORKSPACE_RECOVERY_SEPARATE_PASSPHRASE_REQUIRED');
  const output=absolute(options.output);
  need(!inside(plan.stateRoot,output)&&!inside(output,plan.stateRoot),
    'WORKSPACE_RECOVERY_ARCHIVE_OVERLAPS_STATE');
  need(!(await existing(output)),'WORKSPACE_RECOVERY_ARCHIVE_EXISTS');
  need(await realpath(dirname(output))===dirname(output),'WORKSPACE_RECOVERY_OUTPUT_PARENT_INVALID');
  const temporary=await mkdtemp(join(dirname(output),'.sf88-capture-'));
  const staged=join(temporary,'state');await mkdir(staged,{mode:0o700});
  const holders=[],checkpoints=[];let outputPlaceholder;
  try {
    for(const operator of originalOperators(plan).sort((a,b)=>a.ledger.localeCompare(b.ledger))) {
      const database=join(staged,relative(plan.stateRoot,operator.ledger));
      await mkdir(dirname(database),{recursive:true,mode:0o700});
      const holder=await startLedger('snapshot',{python:operator.python,database:operator.ledger,
        policy:operator.policy,keys:operator.keys,destination:database,signal});
      holders.push(holder);checkpoints.push({directory:operator.directory,ledger:operator.ledger,checkpoint:holder.checkpoint});
      onProgress({stage:'LEDGER_CAPTURED',directory:operator.directory,checkpoint:holder.checkpoint});
    }
    const before=await inventory(plan);
    for(const entry of before) {
      const destination=join(staged,entry.path);
      if(entry.kind==='directory')await mkdir(destination,{recursive:true,mode:0o700});
      else if(entry.kind!=='ledger') {
        await mkdir(dirname(destination),{recursive:true,mode:0o700});
        const source=join(plan.stateRoot,entry.path);
        need(same(entry.stamp,stamp(await lstat(source))),'WORKSPACE_RECOVERY_SOURCE_CHANGED');
        await digest(source,destination,signal);
      }
    }
    need(same(before,await inventory(plan)),'WORKSPACE_RECOVERY_SOURCE_CHANGED');
    need(same(plan,await inspectPlan()),'WORKSPACE_RECOVERY_SOURCE_CHANGED');
    for(const holder of holders)await holder.release();holders.length=0;
    for(const operator of originalOperators(plan)) {
      const verified=await startLedger('verify',{python:operator.python,
        database:join(staged,relative(plan.stateRoot,operator.ledger)),
        policy:join(staged,relative(plan.stateRoot,operator.policy)),
        keys:join(staged,relative(plan.stateRoot,operator.keys)),signal});
      need(same(checkpoints.find(item=>item.directory===operator.directory).checkpoint,verified.checkpoint),
        'WORKSPACE_RECOVERY_CHECKPOINT_MISMATCH');
    }
    let application;
    if(prepareSnapshot!==undefined) {
      need([COLLECTION,OBJECT,UNMANAGED].includes(plan.schema)&&typeof prepareSnapshot==='function','WORKSPACE_RECOVERY_CAPTURE_HOOK_INVALID');
      application=await prepareSnapshot({staged,stateRoot:plan.stateRoot,plan});
      need(object(application)&&Buffer.byteLength(JSON.stringify(application))<=1024*1024,
        'WORKSPACE_RECOVERY_APPLICATION_RECORD_INVALID');
    }
    const files=await stagedFiles(staged,signal);
    for(const entry of [...files].reverse())if(entry.kind==='directory')await syncDirectory(join(staged,entry.path));
    const checkpoint=[OBJECT,UNMANAGED].includes(plan.schema)?plan.checkpoint:checkpoints.find(item=>item.directory===plan.directory).checkpoint;
    const record={schema:plan.schema,createdAt:new Date().toISOString(),plan,checkpoint,files,
      ...(plan.schema===COLLECTION?{checkpoints,...(application?{application}:{})}:[OBJECT,UNMANAGED].includes(plan.schema)?{application}:{})};
    onProgress({stage:'ENCRYPTING',operators:checkpoints.length,files:files.length});
    const recordPath=join(temporary,'record.json');await save(recordPath,record);
    const planPath=join(temporary,'plan.json');
    await save(planPath,{schema:'stellar-forge.merchant-recovery-plan.v1',
      roots:[{name:'state',path:staged},{name:'record',path:recordPath}]});
    const encryptedPath=join(temporary,'encrypted');
    const encrypted=await cryptography(['snapshot','--plan',planPath,'--out',encryptedPath,'--quiesced'],
      options.passEnv??'SF88_BACKUP_PASSPHRASE',environment,signal);
    need(encrypted.status==='SNAPSHOT_CREATED','WORKSPACE_RECOVERY_ARCHIVE_RESULT_INVALID');
    need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
    await mkdir(output,{mode:0o700});outputPlaceholder=await lstat(output);
    await rename(encryptedPath,output);outputPlaceholder=null;await syncDirectory(dirname(output));
    return {status:plan.schema===OBJECT?'OBJECT_SESSION_BACKUP_CREATED':plan.schema===UNMANAGED?'UNMANAGED_STATE_BACKUP_CREATED':'BUYER_STATE_BACKUP_CREATED',bundle:output,
      ...result(record,sha(Buffer.from(json(record))))};
  } finally {
    for(const holder of holders)await holder.stop();
    if(outputPlaceholder) {
      const current=await existing(output);
      if(current?.ino===outputPlaceholder.ino&&current?.dev===outputPlaceholder.dev&&
        (await readdir(output)).length===0)await rm(output,{recursive:true});
    }
    await rm(temporary,{recursive:true,force:true});
  }
}

function validateRecord(record) {
  need(object(record)&&[SCHEMA,COLLECTION,OBJECT,UNMANAGED].includes(record.schema)&&object(record.plan)&&record.plan.schema===record.schema&&
    Array.isArray(record.files)&&record.files.length<=MAX_FILES&&Array.isArray(record.plan.inboxes)&&
    Array.isArray(record.plan.runtime)&&(record.schema===OBJECT?record.checkpoint?.outcome==='ORIGINAL_ZERO_CAP_OBJECT_STATE':
      record.schema===UNMANAGED?record.checkpoint?.outcome==='ORIGINAL_UNMANAGED_STATE':record.checkpoint?.outcome==='JOURNAL_CONSISTENT'),
    'WORKSPACE_RECOVERY_RECORD_INVALID');
  const p=record.plan;absolute(p.stateRoot);
  if(record.schema===OBJECT)validateObjectRecord(record);
  if(record.schema===UNMANAGED)validateUnmanagedRecord(record);
  if(record.schema===COLLECTION)need(Array.isArray(p.operators)&&p.operators.length<=63&&
    Array.isArray(record.checkpoints)&&record.checkpoints.length===p.operators.length+1&&
    (record.application===undefined||object(record.application)&&
      Buffer.byteLength(JSON.stringify(record.application))<=1024*1024),'WORKSPACE_RECOVERY_RECORD_INVALID');
  else if(![OBJECT,UNMANAGED].includes(record.schema))need(p.operators===undefined&&record.checkpoints===undefined&&record.application===undefined,
    'WORKSPACE_RECOVERY_RECORD_INVALID');
  const operatorNames=new Set();
  for(const operator of originalOperators(p)) {
    need(!operatorNames.has(operator.directory)&&Array.isArray(operator.inboxes)&&
      (operator===p||operator.schema===SCHEMA&&operator.operators===undefined&&operator.stateRoot===p.stateRoot),
      'WORKSPACE_RECOVERY_RECORD_INVALID');
    operatorNames.add(operator.directory);
    for(const path of [operator.directory,operator.ledger,operator.policy,operator.keys,...operator.inboxes.map(i=>i.root)]) {
      absolute(path);need(inside(p.stateRoot,path),'WORKSPACE_RECOVERY_RECORD_PATH_INVALID');
    }
    need(operator.ledger===join(operator.directory,'reservations.sqlite')&&operator.policy===join(operator.directory,'policy.json')&&
      operator.keys===join(operator.directory,'operator-keys.json'),'WORKSPACE_RECOVERY_RECORD_PATH_INVALID');
    if(record.schema===COLLECTION) {
      const matches=record.checkpoints.filter(item=>object(item)&&item.directory===operator.directory);
      need(matches.length===1&&matches[0].ledger===operator.ledger&&matches[0].checkpoint?.outcome==='JOURNAL_CONSISTENT',
        'WORKSPACE_RECOVERY_RECORD_INVALID');
    }
  }
  if(record.schema===COLLECTION)need(same(record.checkpoint,record.checkpoints.find(item=>item.directory===p.directory).checkpoint),
    'WORKSPACE_RECOVERY_RECORD_INVALID');
  const names=new Set();let bytes=0;
  for(const f of record.files) {
    member(f.path,{root:f.kind==='directory'});
    need(!names.has(f.path)&&['file','directory'].includes(f.kind),'WORKSPACE_RECOVERY_RECORD_INVALID');
    names.add(f.path);
    if(f.kind==='file') {
      need(Number.isSafeInteger(f.size)&&f.size>=0&&f.size<=MAX_FILE&&
        /^[a-f0-9]{64}$/.test(f.sha256??''),'WORKSPACE_RECOVERY_RECORD_INVALID');
      bytes+=f.size;
    }
  }
  need(bytes<=MAX_BYTES&&record.files.some(f=>f.path===''&&f.kind==='directory'),
    'WORKSPACE_RECOVERY_RECORD_INVALID');
  return record;
}
async function openBackup(options,{environment=process.env,signal,inspectSnapshot,onProgress=()=>{}}={}) {
  need(!signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
  const bundle=absolute(options.bundle);await privateDirectory(bundle);
  const temporary=await mkdtemp(join(tmpdir(),'.sf88-open-'));
  const extracted=join(temporary,'contents');
  try {
    await cryptography(['restore','--bundle',bundle,'--out',extracted],
      options.passEnv??'SF88_BACKUP_PASSPHRASE',environment,signal);
    const {raw,value}=await readJson(join(extracted,'record'));
    const record=validateRecord(value),recordSha256=sha(raw),staged=join(extracted,'state');
    if(options._objectOnly)need(record.schema===OBJECT,'OBJECT_RECOVERY_BUNDLE_REQUIRED');
    if(options.expected!==undefined)need(options.expected===recordSha256,
      'WORKSPACE_RECOVERY_SELECTED_BACKUP_CHANGED');
    need(same(record.files,await stagedFiles(staged,signal)),'WORKSPACE_RECOVERY_CONTENT_MISMATCH');
    const map=path=>join(staged,relative(record.plan.stateRoot,path));
    for(const operator of originalOperators(record.plan)) {
      const original=await openWorkspace(['--dir',operator.directory],
        {accounting:true,storageDirectory:map(operator.directory)});
      const cfg=original.config;
      const {owner,op}=execution(cfg);
      need(op.expect.network===operator.network&&cfg.trustedPayer===operator.payer&&
        owner.ledger===operator.ledger&&owner.policy===operator.policy,
        'WORKSPACE_RECOVERY_ORIGINAL_BINDING_INVALID');
      const checked=await startLedger('verify',{python:options.python??'/usr/bin/python3',
        database:map(operator.ledger),policy:map(operator.policy),keys:map(operator.keys),signal});
      const expected=record.schema===COLLECTION?record.checkpoints.find(item=>item.directory===operator.directory).checkpoint:record.checkpoint;
      need(same(expected,checked.checkpoint),'WORKSPACE_RECOVERY_CHECKPOINT_MISMATCH');
      onProgress({stage:'LEDGER_VERIFIED',directory:operator.directory,checkpoint:checked.checkpoint});
    }
    if(record.schema===OBJECT)await inspectObjectCapture({staged,record,map,signal});
    if(record.schema===UNMANAGED){need(typeof inspectSnapshot==='function','WORKSPACE_RECOVERY_APPLICATION_VALIDATOR_REQUIRED');await inspectUnmanagedCapture({record,map});}
    if(inspectSnapshot!==undefined) {
      need(typeof inspectSnapshot==='function','WORKSPACE_RECOVERY_CAPTURE_HOOK_INVALID');
      await inspectSnapshot({staged,record,map});
    }
    return {temporary,staged,record,recordSha256};
  } catch(e){await rm(temporary,{recursive:true,force:true});throw e;}
}
export async function verifyWorkspaceRecovery(options,context) {
  const opened=await openBackup(options,context);
  try {return {status:opened.record.schema===OBJECT?'OBJECT_SESSION_BACKUP_VERIFIED':opened.record.schema===UNMANAGED?'UNMANAGED_STATE_BACKUP_VERIFIED':'BUYER_STATE_BACKUP_VERIFIED',...result(opened.record,opened.recordSha256)};}
  finally {await rm(opened.temporary,{recursive:true,force:true});}
}
async function copyState(from,to,files,signal) {
  for(const file of files) {
    const target=join(to,file.path);
    if(file.kind==='directory')await mkdir(target,{recursive:true,mode:0o700});
    else {
      await mkdir(dirname(target),{recursive:true,mode:0o700});
      const observed=await digest(join(from,file.path),target,signal);
      need(observed.sha256===file.sha256&&observed.size===file.size,'WORKSPACE_RECOVERY_CONTENT_MISMATCH');
    }
  }
  for(const file of [...files].reverse())if(file.kind==='directory')await syncDirectory(join(to,file.path));
}
/** Publish a complete authenticated state directory. Existing populated state
 * is never replaced or merged. Original request/config/key bytes are unchanged. */
export async function restoreWorkspaceRecovery(options,context) {
  const opened=await openBackup(options,context);
  let adjacent,published;
  try {
    const {record}=opened,target=record.plan.stateRoot,parent=dirname(target);
    need(!inside(target,absolute(options.bundle))&&!inside(absolute(options.bundle),target),
      'WORKSPACE_RECOVERY_ARCHIVE_OVERLAPS_STATE');
    need(await realpath(parent)===parent,'WORKSPACE_RECOVERY_RESTORE_PARENT_REQUIRED');
    const old=await existing(target);
    if(old) {
      await privateDirectory(target);
      if(record.schema===OBJECT&&(await readdir(target)).length) {
        published=await existingObjectRestore(opened,context);return published;
      }
      need((await readdir(target)).length===0,'WORKSPACE_RECOVERY_TARGET_NOT_EMPTY');
    }
    let staged=opened.staged;
    if((await lstat(staged)).dev!==(await lstat(parent)).dev) {
      adjacent=await mkdtemp(join(parent,'.sf88-restore-'));
      await copyState(staged,adjacent,record.files,context?.signal);staged=adjacent;
    }
    if(record.schema===OBJECT) {
      const history=join(staged,OBJECT_RESTORES);await mkdir(history,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
      await privateDirectory(history);
      const marker=join(history,opened.recordSha256+'.json'),value=objectRestoreMarker(record,opened.recordSha256);
      if(await existing(marker))need(same((await readJson(marker,131072)).value,value),'OBJECT_RECOVERY_RESTORE_SELECTION_CHANGED');
      else await save(marker,value);
      await syncDirectory(history);await syncDirectory(staged);
    }
    need(!context?.signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
    // Reserving an empty private destination permits an interrupted publication
    // to restart. POSIX rename refuses a concurrently populated directory.
    await mkdir(target,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await privateDirectory(target);
    need((await readdir(target)).length===0,'WORKSPACE_RECOVERY_TARGET_NOT_EMPTY');
    await rename(staged,target);
    const collection=[COLLECTION,OBJECT,UNMANAGED].includes(record.schema);
    const diagnostic=failure=>/^[A-Z0-9_]{1,120}$/.test(failure?.code??'')?failure.code:'WORKSPACE_RECOVERY_REOPEN_FAILED';
    published={status:record.schema===OBJECT?'OBJECT_SESSION_STATE_RESTORED':record.schema===UNMANAGED?'UNMANAGED_STATE_RESTORED':'BUYER_STATE_RESTORED',...result(record,opened.recordSha256),
      executionStarted:false,originalStateRetained:true,
      ...(collection?{nativeReopenErrors:[],publicationSyncError:null,cleanupErrors:[]}: {})};
    try {await syncDirectory(parent);}catch(failure) {
      if(!collection)throw failure;published.publicationSyncError=diagnostic(failure);
    }
    // Reopen every original operator. Preserve the published collection result
    // if a local runtime check fails after the complete target became visible.
    for(const operator of originalOperators(record.plan)) {
      try {await openWorkspace(['--dir',operator.directory],{accounting:true});}
      catch(failure) {if(!collection)throw failure;
        published.nativeReopenErrors.push({directory:operator.directory,code:diagnostic(failure)});}
    }
    for(const inbox of originalOperators(record.plan).flatMap(operator=>operator.inboxes)) {
      try {
        const jobs=await (await openQueue(inbox.root)).list();
        need(jobs.length===inbox.jobs.length&&jobs.every(j=>j.state!=='REVIEW_REQUIRED'),
          'WORKSPACE_RECOVERY_REOPEN_FAILED');
      } catch(failure) {if(!collection)throw failure;
        published.nativeReopenErrors.push({directory:inbox.root,code:diagnostic(failure)});}
    }
    if(record.schema===OBJECT) {
      try {published.current=await reopenedObject(record,context);}
      catch(failure){published.nativeReopenErrors.push({directory:record.plan.directory,code:diagnostic(failure)});}
    }
    return published;
  } finally {
    for(const path of [adjacent,opened.temporary].filter(Boolean)) {
      try {await rm(path,{recursive:true,force:true});}
      catch(failure) {
        if(![COLLECTION,OBJECT,UNMANAGED].includes(published?.schema))throw failure;
        published.cleanupErrors.push({directory:path,code:/^[A-Z0-9_]{1,120}$/.test(failure?.code??'')?
          failure.code:'WORKSPACE_RECOVERY_CLEANUP_FAILED'});
      }
    }
  }
}

export async function workspaceRecoveryCommand(command,args,context) {
  const opt={inboxes:[],include:[]};
  const names={'--dir':'directory','--state-root':'stateRoot','--inbox':'inboxes','--include':'include','--operator':'operators',
    '--out':'output','--bundle':'bundle','--pass-env':'passEnv','--python':'python','--expect':'expected'};
  for(let i=0;i<args.length;i++) {
    const flag=args[i];
    if(flag==='--quiesced'){need(!opt.quiesced,'WORKSPACE_RECOVERY_ARGUMENT_INVALID');opt.quiesced=true;continue;}
    need(Object.hasOwn(names,flag)&&typeof args[i+1]==='string'&&args[i+1].length>0,
      'WORKSPACE_RECOVERY_ARGUMENT_INVALID');
    const key=names[flag],value=args[++i];
    if(key==='operators')opt.operators??=[];
    if(Array.isArray(opt[key]))opt[key].push(value);
    else {need(opt[key]===undefined,'WORKSPACE_RECOVERY_ARGUMENT_INVALID');opt[key]=value;}
  }
  const allowed={
    '--inspect-workspace-backup':['directory','stateRoot','inboxes','include','operators'],
    '--backup-workspace':['directory','stateRoot','inboxes','include','operators','output','passEnv','quiesced'],
    '--verify-workspace-backup':['bundle','passEnv','python','expected','inboxes','include'],
    '--restore-workspace':['bundle','passEnv','python','expected','inboxes','include'],
  }[command];
  need(allowed&&Object.keys(opt).every(k=>allowed.includes(k)),'WORKSPACE_RECOVERY_ARGUMENT_INVALID');
  if(command==='--inspect-workspace-backup')return inspectWorkspaceRecovery(opt);
  if(command==='--backup-workspace')return snapshotWorkspaceRecovery(opt,context);
  need(opt.inboxes.length===0&&opt.include.length===0,'WORKSPACE_RECOVERY_ARGUMENT_INVALID');
  if(command==='--verify-workspace-backup')return verifyWorkspaceRecovery(opt,context);
  return restoreWorkspaceRecovery(opt,context);
}
