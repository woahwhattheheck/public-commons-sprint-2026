// MIT. The original Object Buyer application over the original SF88 recovery engine.
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {config,execution,need} from '../config.mjs';
import {openWorkspace} from '../workspace.mjs';
import {readObjectRecoveryPlan,acquireObjectRecoveryLease,inspectObjectSession,
  accountObjectSession} from '../object-session.mjs';
import {inspectWorkspaceRecovery,snapshotWorkspaceRecovery,verifyWorkspaceRecovery,
  restoreWorkspaceRecovery} from '../workspace-recovery.mjs';
import {acquireRunbookMetadataLease} from '../../buyer-runbook/runbook.mjs';

const SCHEMA='stellar-forge.sf88.object-workspace-recovery.v1';
const COLLECTION='stellar-forge.sf88.workspace-recovery.v2';
const HASH=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const hash=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:
  /^[A-Z0-9_]{1,120}$/.test(error?.message??'')?error.message:'OBJECT_RECOVERY_FAILED';
function canonical(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!==sep&&!path.includes('\0'),
    'OBJECT_RECOVERY_CANONICAL_PATH_REQUIRED');return path;
}
async function privateDirectory(path) {
  canonical(path);const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&
    (info.mode&0o077)===0&&await realpath(path)===path,'OBJECT_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
}
async function present(path) {
  try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function bytes(path,limit=1048576) {
  canonical(path);need(await realpath(path)===path,'OBJECT_RECOVERY_CANONICAL_PATH_REQUIRED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await file.stat({bigint:true}),info=await file.stat();
    need(info.isFile()&&info.nlink===1&&info.uid===process.getuid()&&(info.mode&0o077)===0&&info.size<=limit,
      'OBJECT_RECOVERY_PRIVATE_FILE_REQUIRED');
    const raw=await file.readFile(),after=await file.stat({bigint:true});
    need(raw.length<=limit&&['dev','ino','size','mtimeNs','ctimeNs'].every(key=>before[key]===after[key]),
      'OBJECT_RECOVERY_SOURCE_CHANGED');return raw;
  } finally {await file.close();}
}
async function json(path) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path)));}
async function publish(path,value) {
  const temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
  try {
    await file.writeFile(encode(value));await file.sync();await file.close();
    await link(temporary,path);
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  } finally {await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
function profileDigest(profile) {const {reviewSha256,...value}=profile;return hash(encode(value));}
function sessionRecord(id,path,plan) {
  const definition=plan.definition;
  return {id,directory:path,sessionId:definition.sessionId,definitionSha256:plan.definitionSha256,
    configurationsSha256:plan.configurationsSha256,configurationSha256:definition.configurationSha256,
    deliveryMode:definition.deliveryMode,bytes:definition.bytes,chunkCount:definition.chunkCount,
    expectedSnapshot:definition.expectedSnapshot,expectedSha256:definition.expectedSha256,
    workspace:definition.workspace,assemblies:plan.assemblies.map(({destination,bytes,sha256})=>({destination,bytes,sha256}))};
}
async function retain(directory,kind,result,extra={}) {
  const root=join(directory,'recovery');
  await mkdir(root,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});await privateDirectory(root);
  const id=randomUUID(),path=join(root,id+'.json');
  await publish(path,{schema:SCHEMA,id,kind,directory,observedAt:new Date().toISOString(),
    status:result.status,bundle:result.bundle,recordSha256:result.recordSha256,stateRoot:result.stateRoot,
    createdAt:result.createdAt,files:result.files,bytes:result.bytes,
    sessions:result.application?.sessions.length??0,operators:result.operators?.length??0,...extra});
  return path;
}

/** The existing browser supplies its current receiving products and trusted profile. */
export function createObjectWorkspaceRecovery({directory,profilePath,profileSha256:startupProfileSha256,products,receiving}) {
  async function inspect({stateRoot}={}) {
    await privateDirectory(stateRoot);await privateDirectory(directory);
    const selected=new Set(),missing=new Set(),operators=new Set(),configurations=new Map(),sessions=[];
    const requireInside=path=>{canonical(path);need(inside(stateRoot,path),'OBJECT_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');return path;};
    async function include(path,optional=false) {
      if(path===null||path===undefined)return;
      requireInside(path);
      if(await present(path))selected.add(path);
      else {need(optional,'OBJECT_RECOVERY_DEPENDENCY_MISSING');missing.add(path);}
    }
    await include(directory);await include(profilePath);
    let profileSha256=null;if(profilePath)profileSha256=hash(await bytes(profilePath,262144));
    need(profileSha256===startupProfileSha256,'OBJECT_RECOVERY_PROFILE_CHANGED_REOPEN_WORKSPACE');
    const settingsReference=join(directory,'received','operator-settings.json');
    const settingsFile=await present(settingsReference)?(await json(settingsReference)).path:null;
    await include(settingsFile);
    const settingsSha256=settingsFile?hash(await bytes(settingsFile,65536)):null;
    const received=await receiving.state();
    need(settingsFile===received.settingsFile,'OBJECT_RECOVERY_PRESET_REFERENCE_CHANGED_REOPEN_WORKSPACE');
    need(received.sources.every(source=>!source.error),'OBJECT_RECOVERY_RECEIVED_FILES_INVALID');
    async function original(source,path=null) {
      const {owner,op,download}=execution(source),operator=dirname(owner.ledger);
      need(owner.ledger===join(operator,'reservations.sqlite')&&owner.policy===join(operator,'policy.json'),
        'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');requireInside(operator);
      const native=await openWorkspace(['--dir',operator]),current=execution(native.config);
      need(['actor','service','python','policy','ledger'].every(key=>owner[key]===current.owner[key])&&
        source.signerModule===native.config.signerModule&&source.evidenceDir===native.config.evidenceDir&&
        source.trustedPayer===native.config.trustedPayer,'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
      operators.add(operator);await include(operator);await include(op.bodyFile);await include(op.ticketFile);
      await include(source.evidenceDir,true);await include(download?.destination,true);
      if(path) {
        await include(path);const digest=hash(await bytes(path,65536));
        configurations.set(path,{path,sha256:digest,operator});
      }
      return operator;
    }
    const choices=await products();
    need(choices.length<=128&&choices.every(product=>!product.error),'OBJECT_RECOVERY_PRODUCTS_INVALID');
    for(const product of choices) {
      await include(product.descriptionFile);await original(await config(product.configFile),product.configFile);
    }
    const sessionsRoot=join(directory,'sessions');
    for(const entry of (await readdir(sessionsRoot,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))) {
      need(entry.isDirectory()&&!entry.isSymbolicLink()&&ID.test(entry.name),'OBJECT_RECOVERY_SESSION_INVALID');
      need(sessions.length<512,'OBJECT_RECOVERY_SESSION_LIMIT');
      const path=join(sessionsRoot,entry.name),plan=await readObjectRecoveryPlan(path);
      const operator=await original(plan.definition.config);
      need(plan.definition.workspace===null||plan.definition.workspace===operator,'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
      for(const record of plan.assemblies)await include(record.destination,true);
      sessions.push(sessionRecord(entry.name,path,plan));
    }
    // Prepared native generations can exist before a download is initialized.
    // Inspect only the original intake namespace, never user file contents.
    const generations=join(directory,'received','products');
    for(const id of (await readdir(generations)).filter(name=>HASH.test(name))) {
      const parent=join(generations,id);await privateDirectory(parent);
      for(const name of (await readdir(parent)).filter(name=>/^operator-[1-9][0-9]*$/.test(name))) {
        const path=join(parent,name),manifest=join(path,'workspace.json');
        await privateDirectory(path);
        if(await present(manifest)) {
          const value=await json(manifest);
          need(value.schema==='stellar-forge.sf88.operator-workspace.v1'&&value.directory===path,
            'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');operators.add(path);
        }
      }
    }
    need(operators.size>0&&operators.size<=64,'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
    const operatorList=[...operators].sort(),paths=[...selected].sort();
    const nativeOptions={directory:operatorList[0],operators:operatorList.slice(1),stateRoot,
      include:paths.filter(path=>!paths.some(other=>other!==path&&inside(other,path))),optionalInclude:[...missing].sort()};
    const native=await inspectWorkspaceRecovery(nativeOptions);
    const profile={schema:SCHEMA,directory,stateRoot,profilePath:profilePath??null,profileSha256,
      settingsFile,settingsSha256,sessions,operators:operatorList,
      received:received.sources.map(({id,descriptionSha256,catalogSha256})=>({id,descriptionSha256,catalogSha256}))
        .sort((a,b)=>a.id.localeCompare(b.id)),
      products:choices.map(({id,objectId,descriptionFile,configFile,workspace})=>({id,objectId,descriptionFile,configFile,workspace}))
        .sort((a,b)=>a.id.localeCompare(b.id)),
      configurations:[...configurations.values()].sort((a,b)=>a.path.localeCompare(b.path)),
      selected:native.selected,missing:native.missing,runtime:native.runtime,
      restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT',walletEnvironmentExported:false};
    profile.reviewSha256=profileDigest(profile);
    return {profile,native,nativeOptions};
  }
  async function snapshot(options,context={}) {
    need(options.quiesced===true,'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
    need(HASH.test(options.expectedReviewSha256??''),'OBJECT_RECOVERY_REVIEW_REQUIRED');
    const leases=[],leaseReleaseErrors=[];
    try {
      for(const path of [directory,join(directory,'received')])
        leases.push({path,release:await acquireRunbookMetadataLease(path)});
      const initial=await inspect(options);
      for(const session of initial.profile.sessions)
        leases.push({path:session.directory,release:await acquireObjectRecoveryLease(session.directory)});
      const current=await inspect(options);
      need(initial.profile.reviewSha256===current.profile.reviewSha256&&
        current.profile.reviewSha256===options.expectedReviewSha256,'OBJECT_RECOVERY_REVIEW_CHANGED');
      const created=await snapshotWorkspaceRecovery({...current.nativeOptions,output:options.output,
        passEnv:options.passEnv,quiesced:true},{...context,prepareSnapshot:async({staged,stateRoot})=>{
          for(const lease of leases)await lease.release.sealSnapshot(join(staged,relative(stateRoot,lease.path)));
          return current.profile;
        }});
      let selectionRecord=null,selectionRecordError=null;
      try {selectionRecord=await retain(directory,'SNAPSHOT',created,{reviewSha256:current.profile.reviewSha256});}
      catch(error){selectionRecordError=codeOf(error);}
      return {...created,selectionRecord,selectionRecordError,leaseReleaseErrors};
    } finally {for(const lease of leases.reverse())try{await lease.release();}
      catch(error){leaseReleaseErrors.push({directory:lease.path,code:codeOf(error)});}}
  }
  async function history() {
    const root=join(directory,'recovery'),records=[];if(!await present(root))return records;
    await privateDirectory(root);
    const names=(await readdir(root)).filter(name=>/^[a-f0-9-]{36}\.json$/.test(name));
    for(const name of names) {
      try {const value=await json(join(root,name));
        need(value.schema===SCHEMA&&value.directory===directory&&value.id===name.slice(0,-5),'OBJECT_RECOVERY_HISTORY_CHANGED');
        records.push(value);
      } catch(error){records.push({id:name.slice(0,-5),error:codeOf(error)});}
    }
    return records.sort((a,b)=>(b.observedAt??'').localeCompare(a.observedAt??'')).slice(0,100);
  }
  async function verify(options,context={}) {
    const result=await verifyObjectWorkspaceRecovery(options,context);
    let selectionRecord=null,selectionRecordError=null;
    try {selectionRecord=await retain(directory,'VERIFY',result);}
    catch(error){selectionRecordError=codeOf(error);}
    return {...result,selectionRecord,selectionRecordError};
  }
  return {inspect,snapshot,verify,history};
}

async function inspectSnapshot({record,map}) {
  const profile=record.application;
  need(record.schema===COLLECTION&&profile?.schema===SCHEMA&&profile.stateRoot===record.plan.stateRoot&&
    HASH.test(profile.reviewSha256??'')&&profileDigest(profile)===profile.reviewSha256&&
    Array.isArray(profile.sessions)&&profile.sessions.length<=512&&Array.isArray(profile.operators)&&
    profile.operators.length>0&&profile.operators.length<=64&&Array.isArray(profile.configurations)&&
    profile.configurations.length<=128,'OBJECT_RECOVERY_APPLICATION_RECORD_INVALID');
  const within=path=>{canonical(path);need(inside(profile.stateRoot,path),'OBJECT_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');};
  for(const path of [profile.directory,...profile.operators])within(path);
  need(same([...profile.operators].sort(),[record.plan,...record.plan.operators].map(item=>item.directory).sort()),
    'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
  for(const [path,digest] of [[profile.profilePath,profile.profileSha256],[profile.settingsFile,profile.settingsSha256]])
    if(path!==null){within(path);need(HASH.test(digest)&&hash(await bytes(map(path)))===digest,'OBJECT_RECOVERY_SOURCE_CHANGED');}
  const ids=new Set();
  for(const saved of profile.sessions) {
    need(ID.test(saved.id)&&!ids.has(saved.id)&&saved.directory===join(profile.directory,'sessions',saved.id),
      'OBJECT_RECOVERY_SESSION_INVALID');ids.add(saved.id);within(saved.directory);
    const plan=await readObjectRecoveryPlan(saved.directory,{storageDirectory:map(saved.directory)});
    need(same(sessionRecord(saved.id,saved.directory,plan),saved),'OBJECT_RECOVERY_SESSION_CHANGED');
    need(profile.operators.includes(dirname(execution(plan.definition.config).owner.ledger)),
      'OBJECT_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
  }
  for(const item of profile.configurations) {
    within(item.path);need(HASH.test(item.sha256)&&profile.operators.includes(item.operator)&&
      hash(await bytes(map(item.path),65536))===item.sha256,'OBJECT_RECOVERY_CONFIGURATION_CHANGED');
  }
}
export async function verifyObjectWorkspaceRecovery(options,context={}) {
  const result=await verifyWorkspaceRecovery(options,{...context,inspectSnapshot});
  return {...result,bundle:canonical(options.bundle)};
}
export async function restoreObjectWorkspaceRecovery(options,context={}) {
  const result=await restoreWorkspaceRecovery(options,{...context,inspectSnapshot});
  const {openObjectWorkspace}=await import('./model.mjs');
  let model,reopened=null,reopenError=result.nativeReopenErrors?.length?'OBJECT_RECOVERY_NATIVE_REOPEN_FAILED':null;
  try {
    model=await openObjectWorkspace({stateDirectory:result.application.directory,profilePath:result.application.profilePath});
    const state=await model.view(),receiving=await model.receivingState();
    need(state.sessions.length===result.application.sessions.length,'OBJECT_RECOVERY_REOPEN_FAILED');
    const current=await model.inspectRecovery({stateRoot:result.stateRoot});
    for(const field of ['products','received','operators','configurations','profilePath','profileSha256','settingsFile','settingsSha256'])
      need(same(current.profile[field],result.application[field]),'OBJECT_RECOVERY_REOPEN_IDENTITY_CHANGED');
    const products=await model.products();
    need(products.every(product=>!product.error)&&products.length===result.application.products.length,
      'OBJECT_RECOVERY_PRODUCTS_INVALID');
    for(const saved of result.application.sessions) {
      // Accounting remains available even when an optional delivered file was
      // already missing at capture. The original reader checks native jobs.
      const record=await accountObjectSession(saved.directory,{offset:0,limit:1});
      need(record.sessionId===saved.sessionId&&record.configurationSha256===saved.configurationSha256&&
        record.range.total===saved.chunkCount,'OBJECT_RECOVERY_REOPEN_FAILED');
      const state=await inspectObjectSession(saved.directory);
      need(!state.lock,'OBJECT_RECOVERY_CAPTURE_LEASE_NOT_RELEASED');
    }
    reopened={directory:result.application.directory,sessions:state.sessions.length,
      receivedSources:receiving.sources.length,products:products.length,
      urlCommand:['buyer-object-workspace','--state',result.application.directory,
        ...(result.application.profilePath?['--profile',result.application.profilePath]:[])]};
  } catch(error){reopenError??=codeOf(error);}
  finally {try{await model?.close();}catch(error){reopenError??=codeOf(error);}}
  const restored={...result,bundle:canonical(options.bundle),reopened,reopenError,executionStarted:false};
  let selectionRecord=null,selectionRecordError=null;
  try {selectionRecord=await retain(result.application.directory,'RESTORE',restored);}
  catch(error){selectionRecordError=codeOf(error);}
  return {...restored,selectionRecord,selectionRecordError};
}
