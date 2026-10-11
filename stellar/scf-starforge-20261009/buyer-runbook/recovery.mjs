// MIT. One acquisition workspace, all original operators, original SF88 recovery.
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath,mkdir,link,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {config as nativeConfig,execution,need} from '../sf88-operator-buyer-cli/config.mjs';
import {openWorkspace} from '../sf88-operator-buyer-cli/workspace.mjs';
import {inspectWorkspaceRecovery,snapshotWorkspaceRecovery,verifyWorkspaceRecovery,
  restoreWorkspaceRecovery} from '../sf88-operator-buyer-cli/workspace-recovery.mjs';
import {readPlan,runbookPlanDigest,acquireExecutionLease,acquireRunbookMetadataLease,
  inspectRunbook} from './runbook.mjs';
import {inspectAcquisitionWorkspace} from './accounting.mjs';

const SCHEMA='stellar-forge.buyer-runbook-recovery.v1';
const WORKSPACE='stellar-forge.buyer-runbook-workspace.v1';
const COLLECTION='stellar-forge.sf88.workspace-recovery.v2';
const HASH=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(value).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'RUNBOOK_RECOVERY_FAILED';
function canonical(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!==sep&&!path.includes('\0'),
    'RUNBOOK_RECOVERY_CANONICAL_PATH_REQUIRED');return path;
}
async function privateDirectory(path) {
  canonical(path);const info=await lstat(path);
  need(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&
    (info.mode&0o077)===0&&await realpath(path)===path,'RUNBOOK_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
async function bytes(path,limit=8*1024*1024) {
  need(await realpath(path)===path,'RUNBOOK_RECOVERY_CANONICAL_PATH_REQUIRED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {const info=await file.stat();need(info.isFile()&&info.nlink===1&&info.uid===process.getuid()&&
    (info.mode&0o077)===0&&info.size<=limit,'RUNBOOK_RECOVERY_PRIVATE_FILE_REQUIRED');
    const raw=await file.readFile();need(raw.length<=limit,'RUNBOOK_RECOVERY_FILE_LIMIT');return raw;
  } finally {await file.close();}
}
async function json(path) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path)));}
async function present(path) {try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function sync(path) {const file=await open(path,'r');try{await file.sync();}finally{await file.close();}}
async function publish(path,value) {
  const temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
  try {await file.writeFile(encode(value));await file.sync();await file.close();await link(temporary,path);await sync(dirname(path));}
  finally {await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
function profileDigest(profile) {const {reviewSha256,...value}=profile;return hash(encode(value));}

/** The original workspace model supplies its own registered runs and intake. */
export function createRunbookRecovery({directory,configsDirectory,state,resolveRun,intake}) {
  async function inspect({stateRoot}={}) {
    await privateDirectory(stateRoot);await privateDirectory(directory);await privateDirectory(configsDirectory);
    const selected=new Set(),optionalPaths=new Set(),operators=new Set(),configurations=new Map(),runs=[];
    const requireInside=path=>{canonical(path);need(inside(stateRoot,path),'RUNBOOK_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');return path;};
    const include=async(path,optional=false)=>{
      if(path===undefined||path===null)return;
      requireInside(path);
      if(await present(path))selected.add(path);
      else {need(optional,'RUNBOOK_RECOVERY_DEPENDENCY_MISSING');optionalPaths.add(path);}
    };
    await include(directory);await include(configsDirectory);
    const current=await state();need(current.errors.length===0,'RUNBOOK_RECOVERY_WORKSPACE_ITEMS_INVALID');
    async function originalConfiguration(path,expected) {
      requireInside(path);const raw=await bytes(path,65536),digest=hash(raw);
      need(expected===undefined||expected===digest,'RUNBOOK_RECOVERY_CONFIGURATION_CHANGED');
      if(configurations.has(path)){need(configurations.get(path).sha256===digest,'RUNBOOK_RECOVERY_CONFIGURATION_CHANGED');return;}
      const cfg=await nativeConfig(path),{owner,op,download}=execution(cfg),operator=dirname(owner.ledger);
      need(owner.ledger===join(operator,'reservations.sqlite')&&owner.policy===join(operator,'policy.json'),
        'RUNBOOK_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
      requireInside(operator);
      const original=await openWorkspace(['--dir',operator]),other=execution(original.config);
      need(['actor','service','python','policy','ledger'].every(name=>owner[name]===other.owner[name])&&
        cfg.signerModule===original.config.signerModule&&cfg.trustedPayer===original.config.trustedPayer&&
        cfg.evidenceDir===original.config.evidenceDir,'RUNBOOK_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
      operators.add(operator);configurations.set(path,{path,sha256:digest,intentId:op.intentId,operator});
      await include(path);await include(op.bodyFile);await include(op.ticketFile);
      await include(download?.destination,true);await include(cfg.evidenceDir,true);
    }
    for(const source of current.configurations.filter(item=>item.valid))
      await originalConfiguration(join(configsDirectory,source.name));
    for(const item of current.acquisitions.sort((a,b)=>a.id.localeCompare(b.id))) {
      const path=await resolveRun(item.id);requireInside(path);await include(path);
      const run=await inspectRunbook(path),plan=run.plan;
      for(const row of run.operations) {
        const config=join(path,row.config.path);await originalConfiguration(config,row.config.sha256);
        const operator=configurations.get(config).operator;
        await inspectAcquisitionWorkspace(plan,row,operator);
        if(row.sourceConfig)await originalConfiguration(row.sourceConfig.path,row.sourceConfig.sha256);
        await include(row.result?.summary?.responseFile?.partialPath,true);
      }
      runs.push({id:item.id,directory:path,planId:plan.id,planSha256:runbookPlanDigest(plan),
        operations:run.operations.map(row=>({id:row.id,intentId:row.intentId,configSha256:row.config.sha256,
          state:row.state,startedAt:row.started?.at??null,receipt:row.accounting?.finalized?.receipt??null}))});
    }
    const intakeState=await intake.state();
    need(intakeState.errors.length===0,'RUNBOOK_RECOVERY_RECEIVED_REQUESTS_INVALID');
    if(intakeState.settingsFile)await include(intakeState.settingsFile);
    // Include complete and interrupted native operator generations, even before
    // their request was added to a run. Other ledgers never become generic files.
    const seen=new Set();let entries=0;
    async function scan(path,depth=0) {
      need(++entries<=9500&&depth<=15,'RUNBOOK_RECOVERY_FILE_LIMIT');
      if(seen.has(path))return;seen.add(path);
      const info=await lstat(path);need(!info.isSymbolicLink(),'RUNBOOK_RECOVERY_CANONICAL_PATH_REQUIRED');
      if(!info.isDirectory())return;
      await privateDirectory(path);
      for(const entry of await readdir(path,{withFileTypes:true})) {
        if(entry.name==='workspace.json'&&entry.isFile()) {
          const value=await json(join(path,entry.name));
          if(value.schema==='stellar-forge.sf88.operator-workspace.v1') {
            need(value.directory===path,'RUNBOOK_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');operators.add(path);
          }
        }
        if(entry.isDirectory())await scan(join(path,entry.name),depth+1);
        else need(!entry.isSymbolicLink(),'RUNBOOK_RECOVERY_CANONICAL_PATH_REQUIRED');
      }
    }
    for(const path of [...selected])await scan(path);
    need(operators.size>0&&operators.size<=64,'RUNBOOK_RECOVERY_OPERATOR_LIMIT');
    const operatorList=[...operators].sort();
    const includes=[...selected].sort().filter((path,_i,all)=>!all.some(other=>other!==path&&inside(other,path)));
    const nativeOptions={directory:operatorList[0],operators:operatorList.slice(1),stateRoot,
      include:includes,optionalInclude:[...optionalPaths].sort()};
    const native=await inspectWorkspaceRecovery(nativeOptions);
    const profile={schema:SCHEMA,directory,configsDirectory,stateRoot,
      workspaceSha256:hash(await bytes(join(directory,'workspace.json'))),
      runs,requests:intakeState.requests.map(item=>({id:item.id,handoffSha256:item.handoffSha256,
        operatorDirectory:item.prepared?.operatorDirectory??null,
        configSha256:item.prepared?.configSha256??null})).sort((a,b)=>a.id.localeCompare(b.id)),
      configurations:[...configurations.values()].sort((a,b)=>a.path.localeCompare(b.path)),
      operators:operatorList,selected:native.selected,missing:native.missing,
      parentDirectories:native.parentDirectories,runtime:native.runtime,
      restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT',walletEnvironmentExported:false};
    profile.reviewSha256=profileDigest(profile);
    return {profile,native,nativeOptions};
  }
  async function snapshot(options,context={}) {
    need(options.quiesced===true,'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
    need(HASH.test(options.expectedReviewSha256??''),'RUNBOOK_RECOVERY_REVIEW_REQUIRED');
    const leases=[],leaseErrors=[];
    try {
      for(const path of [directory,join(directory,'drafts'),join(directory,'handoffs')])
        leases.push({path,release:await acquireRunbookMetadataLease(path)});
      const initial=await inspect(options);
      for(const run of [...initial.profile.runs].sort((a,b)=>a.directory.localeCompare(b.directory)))
        leases.push({path:run.directory,release:await acquireExecutionLease(run.directory)});
      const current=await inspect(options);
      need(current.profile.reviewSha256===options.expectedReviewSha256&&
        initial.profile.reviewSha256===current.profile.reviewSha256,'RUNBOOK_RECOVERY_REVIEW_CHANGED');
      const created=await snapshotWorkspaceRecovery({...current.nativeOptions,output:options.output,
        passEnv:options.passEnv,quiesced:true},{...context,
        prepareSnapshot:async({staged,stateRoot})=>{
          for(const lease of leases)await lease.release.sealSnapshot(join(staged,relative(stateRoot,lease.path)));
          return current.profile;
        }});
      let retained=null,retentionError=null;
      // Selection records contain paths and checkpoint metadata, written only
      // after publication. Never turn a created archive into a blind retry.
      try {
        const history=join(directory,'recovery');await mkdir(history,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        await privateDirectory(history);retained=join(history,created.recordSha256+'.json');
        await publish(retained,{schema:SCHEMA,status:created.status,bundle:created.bundle,
          recordSha256:created.recordSha256,reviewSha256:current.profile.reviewSha256,
          stateRoot:created.stateRoot,createdAt:created.createdAt,files:created.files,bytes:created.bytes,
          operators:created.operators,directory});
      } catch(error){retentionError=codeOf(error);}
      return {...created,selectionRecord:retained,selectionRecordError:retentionError,leaseReleaseErrors:leaseErrors};
    } finally {for(const lease of leases.reverse())try{await lease.release();}
      catch(error){leaseErrors.push({directory:lease.path,code:codeOf(error)});}}
  }
  async function history() {
    const root=join(directory,'recovery'),records=[];
    if(!await present(root))return records;
    await privateDirectory(root);
    for(const name of (await readdir(root)).sort().reverse().filter(name=>/^[a-f0-9]{64}\.json$/.test(name)).slice(0,100)) {
      try {const value=await json(join(root,name));need(value.schema===SCHEMA&&value.directory===directory&&
        value.recordSha256===name.slice(0,-5),'RUNBOOK_RECOVERY_SELECTION_CHANGED');records.push(value);}
      catch(error){records.push({recordSha256:name.slice(0,-5),error:codeOf(error)});}
    }
    return records.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''));
  }
  return {inspect,snapshot,history};
}

async function inspectSnapshot({record,map}) {
  const profile=record.application;
  need(record.schema===COLLECTION&&profile?.schema===SCHEMA&&profile.stateRoot===record.plan.stateRoot&&
    HASH.test(profile.reviewSha256??'')&&profileDigest(profile)===profile.reviewSha256&&
    Array.isArray(profile.runs)&&profile.runs.length<=512&&Array.isArray(profile.configurations)&&
    profile.configurations.length<=4096&&Array.isArray(profile.operators)&&profile.operators.length<=64,
    'RUNBOOK_RECOVERY_APPLICATION_RECORD_INVALID');
  const root=profile.stateRoot;
  for(const path of [profile.directory,profile.configsDirectory,...profile.operators]) {
    canonical(path);need(inside(root,path),'RUNBOOK_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
  }
  need(hash(await bytes(map(join(profile.directory,'workspace.json'))))===profile.workspaceSha256,
    'RUNBOOK_RECOVERY_WORKSPACE_IDENTITY_CHANGED');
  const workspace=await json(map(join(profile.directory,'workspace.json')));
  need(workspace.schema===WORKSPACE&&workspace.directory===profile.directory&&
    workspace.configsDirectory===profile.configsDirectory,'RUNBOOK_RECOVERY_WORKSPACE_IDENTITY_CHANGED');
  need(same([...profile.operators].sort(),[record.plan,...record.plan.operators].map(item=>item.directory).sort()),
    'RUNBOOK_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
  for(const run of profile.runs) {
    canonical(run.directory);need(inside(root,run.directory),'RUNBOOK_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');
    const plan=await readPlan(run.directory,{storageDirectory:map(run.directory)});
    need(plan.id===run.planId&&runbookPlanDigest(plan)===run.planSha256,'RUNBOOK_RECOVERY_RUN_CHANGED');
    need(same(plan.operations.map(row=>({id:row.id,intentId:row.intentId,configSha256:row.config.sha256})),
      run.operations.map(({id,intentId,configSha256})=>({id,intentId,configSha256}))), 'RUNBOOK_RECOVERY_RUN_CHANGED');
  }
  for(const entry of profile.configurations) {
    canonical(entry.path);need(inside(root,entry.path)&&profile.operators.includes(entry.operator)&&HASH.test(entry.sha256),
      'RUNBOOK_RECOVERY_CONFIGURATION_CHANGED');
    need(hash(await bytes(map(entry.path),65536))===entry.sha256,'RUNBOOK_RECOVERY_CONFIGURATION_CHANGED');
  }
}
export async function verifyRunbookRecovery(options,context={}) {
  const result=await verifyWorkspaceRecovery(options,{...context,inspectSnapshot});
  return {...result,bundle:canonical(options.bundle)};
}
export async function restoreRunbookRecovery(options,context={}) {
  const restored=await restoreWorkspaceRecovery(options,{...context,inspectSnapshot});
  const {openRunbookWorkspace}=await import('./workspace-model.mjs');
  let model,reopened=null,reopenError=restored.nativeReopenErrors?.length?'RUNBOOK_RECOVERY_NATIVE_REOPEN_FAILED':null;
  try {
    model=await openRunbookWorkspace({directory:restored.application.directory});
    const state=await model.state();need(state.errors.length===0,'RUNBOOK_RECOVERY_REOPEN_FAILED');
    for(const run of restored.application.runs) {
      const current=await model.run(run.id);
      need(runbookPlanDigest(current.state.plan)===run.planSha256&&!current.state.executionLock,
        'RUNBOOK_RECOVERY_REOPEN_FAILED');
    }
    reopened={directory:model.directory,acquisitions:state.acquisitions.length,
      requests:state.intake.requests.length,configurations:state.configurations.filter(item=>item.valid).length};
  } catch(error){reopenError??=codeOf(error);}
  finally {try{await model?.close();}catch(error){reopenError??=codeOf(error);}}
  return {...restored,bundle:canonical(options.bundle),reopened,reopenError,executionStarted:false};
}
