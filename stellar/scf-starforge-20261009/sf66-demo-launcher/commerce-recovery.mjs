// MIT. Original commerce state closure -> SF88 journal checkpoints -> SF101 recovery.
import {constants} from 'node:fs';
import {lstat,open,readdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {isDeepStrictEqual as same} from 'node:util';
import {inspectCommerce} from './commerce.mjs';
import {inspectCommerceSetup} from './commerce-setup.mjs';
import {config as readBuyer,execution,need} from '../sf88-operator-buyer-cli/config.mjs';
import {inspectWorkspaceRecovery,snapshotWorkspaceRecovery,verifyWorkspaceRecovery,
  restoreWorkspaceRecovery} from '../sf88-operator-buyer-cli/workspace-recovery.mjs';
import {acquireInitialization} from '../sf88-operator-buyer-cli/initialization.mjs';

export const COMMERCE_RECOVERY_SCHEMA='stellar-forge.commerce-recovery.v1';
const CONFIG='stellar-forge.commerce-recovery-config.v1';
const COLLECTION='stellar-forge.sf88.workspace-recovery.v2';
const SESSION='stellar-forge.commerce-session.v1';
const HASH=/^[a-f0-9]{64}$/;
const hash=raw=>createHash('sha256').update(raw).digest('hex');
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const codeOf=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'COMMERCE_RECOVERY_FAILED';

function canonical(path) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&path!==sep&&!path.includes('\0'),
    'COMMERCE_RECOVERY_CANONICAL_PATH_REQUIRED');
  return path;
}
async function directory(path) {
  canonical(path);const st=await lstat(path);
  need(st.isDirectory()&&!st.isSymbolicLink()&&st.uid===process.getuid()&&(st.mode&0o077)===0&&
    await realpath(path)===path,'COMMERCE_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
  return path;
}
async function present(path) {
  try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function bytes(path,limit=1048576) {
  canonical(path);need(await realpath(path)===path,'COMMERCE_RECOVERY_CANONICAL_PATH_REQUIRED');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=await file.stat();
    need(st.isFile()&&st.nlink===1&&st.uid===process.getuid()&&(st.mode&0o077)===0&&st.size<=limit,
      'COMMERCE_RECOVERY_PRIVATE_FILE_REQUIRED');
    const raw=await file.readFile();need(raw.length<=limit,'COMMERCE_RECOVERY_FILE_LIMIT');return raw;
  } finally {await file.close();}
}
async function json(path) {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await bytes(path)));}
function profileHash(profile) {const {reviewSha256,...value}=profile;return hash(encode(value));}

/** Host configuration is retained outside the state being restored. It names
 * environment references, never password or wallet values. */
export async function readCommerceRecoveryConfig(file) {
  const value=await json(canonical(file));
  need(value&&value.schema===CONFIG&&Object.keys(value).every(key=>
    ['schema','directory','stateRoot','backupDirectory','preparation','include','passEnv','python'].includes(key)),
    'COMMERCE_RECOVERY_CONFIG_INVALID');
  for(const key of ['directory','stateRoot','backupDirectory'])canonical(value[key]);
  need(inside(value.stateRoot,value.directory)&&!inside(value.stateRoot,value.backupDirectory)&&
    !inside(value.backupDirectory,value.stateRoot)&&!inside(value.stateRoot,file),
    'COMMERCE_RECOVERY_CONFIG_LOCATION_INVALID');
  if(value.preparation!==undefined)canonical(value.preparation);
  need(value.include===undefined||Array.isArray(value.include)&&value.include.length<=32,
    'COMMERCE_RECOVERY_INCLUDE_INVALID');
  for(const path of value.include??[])canonical(path);
  need(value.passEnv===undefined||/^[A-Z][A-Z0-9_]{4,63}$/.test(value.passEnv),
    'COMMERCE_RECOVERY_PASSPHRASE_NAME_INVALID');
  if(value.python!==undefined)canonical(value.python);
  await directory(value.backupDirectory);
  return {...value,include:value.include??[],passEnv:value.passEnv??'SF66_BACKUP_PASSPHRASE',
    python:value.python??'/usr/bin/python3',configFile:file};
}

/** Inspect through the original session and operator readers. An explicit
 * preparation includes its retained packets and earlier original sessions. */
export async function reviewCommerceRecovery(options) {
  const root=await directory(options.stateRoot),target=await directory(options.directory);
  const selected=new Set(),missing=new Set(),operators=new Set(),sessions=new Map(),configs=new Map(),runtime=new Map();
  const requireInside=path=>{
    canonical(path);need(inside(root,path),'COMMERCE_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');return path;
  };
  async function include(path,{optional=false,application=false}={}) {
    if(path===undefined||path===null)return;
    canonical(path);
    if(application&&!inside(root,path)) {runtime.set(path,{path,retained:false,kind:'APPLICATION_RUNTIME'});return;}
    requireInside(path);
    if(await present(path))selected.add(path);
    else {need(optional,'COMMERCE_RECOVERY_DEPENDENCY_MISSING');missing.add(path);}
  }
  async function configuration(path,expected) {
    requireInside(path);
    if(configs.has(path))return;
    const raw=await bytes(path,65536),sha256=hash(raw);
    need(expected===undefined||sha256===expected,'COMMERCE_RECOVERY_CONFIGURATION_CHANGED');
    const cfg=await readBuyer(path),{owner,op,download}=execution(cfg),operator=dirname(owner.ledger);
    need(owner.ledger===join(operator,'reservations.sqlite')&&owner.policy===join(operator,'policy.json'),
      'COMMERCE_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
    requireInside(operator);operators.add(operator);
    configs.set(path,{path,sha256,intentId:op.intentId,operator});
    await include(path);await include(op.bodyFile);await include(op.ticketFile);
    await include(download?.destination,{optional:true});await include(cfg.evidenceDir,{optional:true});
  }
  async function session(path) {
    if(sessions.has(path))return;
    requireInside(path);
    const original=await inspectCommerce(path),raw=await bytes(join(path,'session.json')),saved=JSON.parse(raw);
    need(saved.schema===SESSION&&saved.directory===path,'COMMERCE_RECOVERY_SESSION_CHANGED');
    const item={directory:path,sessionSha256:hash(raw),queueRoot:saved.queueRoot,python:null,
      buyers:original.buyers.map(job=>({id:job.id,intentId:job.operation.intentId,state:job.state,
        configSha256:job.configSha256,sourceConfigSha256:job.sourceConfigSha256,
        bodySha256:job.bodySha256,bodyBytes:job.bodyBytes,attemptId:job.attempt?.id??null,
        transaction:job.outcome?.settlement?.transaction??job.outcome?.transaction??null}))};
    sessions.set(path,item);await include(path);
    await include(saved.seller.availabilityDirectory,{optional:true});
    await include(saved.seller.handlers,{application:true});
    if(saved.seller.python) {
      const declaration=await json(saved.seller.python);
      await include(declaration.application,{application:true});
    }
    if(saved.seller.upstreams) {
      const upstream=await json(saved.seller.upstreams);
      for(const binding of Object.values(upstream.bindings??{}))
        await include(binding.idempotency?.stateDir,{optional:true});
    }
    for(const job of original.buyers) {
      const file=join(saved.queueRoot,'jobs',job.id,'execution.json');
      await configuration(file,job.configSha256);
      const {owner}=execution(await readBuyer(file));item.python??=owner.python;
      await include(job.evidencePath,{optional:true});
      await include(job.outcome?.responseFile?.partialPath,{optional:true});
      await include(job.rpcRecovery?.responseFile?.path,{optional:true});
      await include(job.rpcRecovery?.responseFile?.partialPath,{optional:true});
      const entry=saved.buyers.find(value=>value.intentId===job.operation.intentId);
      if(entry?.signerConfig)await include(entry.signerConfig);
      if(entry?.paidFile) {
        await include(entry.paidFile.handoff);
        // The original whole/ranged-file writer owns its response and sidecars.
        await include(dirname(entry.paidFile.destination),{optional:true});
      }
      if(entry?.config&&inside(root,entry.config)&&await present(entry.config))
        await configuration(entry.config,job.sourceConfigSha256);
    }
    need(item.python,'COMMERCE_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
  }
  await session(target);
  if(options.preparation) {
    requireInside(options.preparation);
    await inspectCommerceSetup(options.preparation);
    await include(options.preparation);
  }
  need(options.include===undefined||Array.isArray(options.include)&&options.include.length<=32,
    'COMMERCE_RECOVERY_INCLUDE_INVALID');
  for(const path of options.include??[])await include(path);
  // An included original preparation can contain earlier sessions/operators.
  // Discover those native identities before any database is treated as a file.
  const scanned=new Set();let count=0;
  async function scan(path,depth=0) {
    if(scanned.has(path))return;scanned.add(path);
    need(++count<=9500&&depth<=15,'COMMERCE_RECOVERY_FILE_LIMIT');
    const st=await lstat(path);need(!st.isSymbolicLink(),'COMMERCE_RECOVERY_CANONICAL_PATH_REQUIRED');
    if(!st.isDirectory())return;
    await directory(path);
    const names=await readdir(path,{withFileTypes:true});
    if(names.some(x=>x.name==='workspace.json'&&x.isFile())) {
      const value=await json(join(path,'workspace.json'));
      if(value.schema==='stellar-forge.sf88.operator-workspace.v1') {
        need(value.directory===path,'COMMERCE_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');operators.add(path);
      }
    }
    if(names.some(x=>x.name==='session.json'&&x.isFile())) {
      const value=await json(join(path,'session.json'));
      if(value.schema===SESSION)await session(path);
    }
    for(const item of names)if(item.isDirectory())await scan(join(path,item.name),depth+1);
    else need(!item.isSymbolicLink(),'COMMERCE_RECOVERY_CANONICAL_PATH_REQUIRED');
  }
  for(const path of selected)await scan(path);
  need(operators.size>0&&operators.size<=64,'COMMERCE_RECOVERY_OPERATOR_LIMIT');
  need(sessions.size<=64,'COMMERCE_RECOVERY_SESSION_LIMIT');
  const operatorList=[...operators].sort(),paths=[...selected].sort().filter((path,_index,all)=>
    !all.some(other=>other!==path&&inside(other,path)));
  const nativeOptions={directory:operatorList[0],operators:operatorList.slice(1),stateRoot:root,
    include:paths,optionalInclude:[...missing].sort()};
  const native=await inspectWorkspaceRecovery(nativeOptions);
  const profile={schema:COMMERCE_RECOVERY_SCHEMA,directory:target,stateRoot:root,
    preparation:options.preparation??null,include:[...(options.include??[])].sort(),
    sessions:[...sessions.values()].sort((a,b)=>a.directory.localeCompare(b.directory)),
    configurations:[...configs.values()].sort((a,b)=>a.path.localeCompare(b.path)),
    operators:operatorList,selected:native.selected,missing:native.missing,parentDirectories:native.parentDirectories,
    runtime:[...native.runtime,...runtime.values()],restoreMode:'ORIGINAL_CANONICAL_STATE_ROOT',
    walletEnvironmentExported:false};
  profile.reviewSha256=profileHash(profile);
  return {profile,native,nativeOptions};
}

/** All discovered original session leases are held until encrypted publication.
 * The existing engine additionally locks/checkpoints each original SF36 ledger. */
export async function snapshotCommerceRecovery(options,context={}) {
  need(options.quiesced===true,'WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
  need(HASH.test(options.expectedReviewSha256??''),'COMMERCE_RECOVERY_REVIEW_REQUIRED');
  const original=await reviewCommerceRecovery(options),leases=[];
  try {
    for(const item of original.profile.sessions)leases.push(await acquireInitialization(item.directory,
      {python:item.python,resume:true}));
    const current=await reviewCommerceRecovery(options);
    need(current.profile.reviewSha256===options.expectedReviewSha256&&
      original.profile.reviewSha256===current.profile.reviewSha256,'COMMERCE_RECOVERY_REVIEW_CHANGED');
    return await snapshotWorkspaceRecovery({...current.nativeOptions,output:options.output,
      passEnv:options.passEnv,quiesced:true},{...context,prepareSnapshot:async()=>current.profile});
  } finally {for(const lease of leases.reverse())await lease.close();}
}

async function inspectSnapshot({record,map},options) {
  const p=record.application;
  need(record.schema===COLLECTION&&p?.schema===COMMERCE_RECOVERY_SCHEMA&&HASH.test(p.reviewSha256??'')&&
    profileHash(p)===p.reviewSha256&&p.stateRoot===record.plan.stateRoot&&
    p.stateRoot===options.stateRoot&&p.directory===options.directory&&
    Array.isArray(p.sessions)&&p.sessions.length>0&&p.sessions.length<=64&&
    Array.isArray(p.configurations)&&p.configurations.length<=4096&&Array.isArray(p.operators)&&p.operators.length<=64,
    'COMMERCE_RECOVERY_APPLICATION_RECORD_INVALID');
  need(same([...p.operators].sort(),[record.plan,...record.plan.operators].map(x=>x.directory).sort()),
    'COMMERCE_RECOVERY_ORIGINAL_OPERATOR_REQUIRED');
  const check=path=>{canonical(path);need(inside(p.stateRoot,path),'COMMERCE_RECOVERY_DEPENDENCY_OUTSIDE_ROOT');return map(path);};
  const identities=new Set();
  for(const item of p.sessions) {
    need(!identities.has(item.directory)&&HASH.test(item.sessionSha256)&&Array.isArray(item.buyers)&&
      item.buyers.length<=64,'COMMERCE_RECOVERY_SESSION_CHANGED');identities.add(item.directory);
    const raw=await bytes(check(join(item.directory,'session.json')));
    need(hash(raw)===item.sessionSha256,'COMMERCE_RECOVERY_SESSION_CHANGED');
    const saved=JSON.parse(raw);
    need(saved.schema===SESSION&&saved.directory===item.directory&&saved.queueRoot===item.queueRoot&&
      item.queueRoot===join(item.directory,'inbox'),'COMMERCE_RECOVERY_SESSION_CHANGED');
    for(const job of item.buyers) {
      need(HASH.test(job.id)&&HASH.test(job.configSha256),'COMMERCE_RECOVERY_REQUEST_CHANGED');
      const request=await json(check(join(item.queueRoot,'jobs',job.id,'request.json')));
      need(request.operation?.intentId===job.intentId&&request.configSha256===job.configSha256&&
        request.bodySha256===job.bodySha256&&request.bodyBytes===job.bodyBytes,
        'COMMERCE_RECOVERY_REQUEST_CHANGED');
      need(hash(await bytes(check(join(item.queueRoot,'jobs',job.id,'execution.json')),65536))===job.configSha256,
        'COMMERCE_RECOVERY_CONFIGURATION_CHANGED');
    }
  }
  need(identities.has(p.directory),'COMMERCE_RECOVERY_SESSION_CHANGED');
  for(const item of p.configurations) {
    need(p.operators.includes(item.operator)&&HASH.test(item.sha256),'COMMERCE_RECOVERY_CONFIGURATION_CHANGED');
    need(hash(await bytes(check(item.path),65536))===item.sha256,'COMMERCE_RECOVERY_CONFIGURATION_CHANGED');
  }
}
export async function verifyCommerceRecovery(options,context={}) {
  canonical(options.directory);canonical(options.stateRoot);
  return verifyWorkspaceRecovery(options,{...context,inspectSnapshot:value=>inspectSnapshot(value,options)});
}
export async function restoreCommerceRecovery(options,context={}) {
  canonical(options.directory);canonical(options.stateRoot);
  const result=await restoreWorkspaceRecovery(options,{...context,inspectSnapshot:value=>inspectSnapshot(value,options)});
  const commerceReopenErrors=[];
  for(const item of result.application.sessions) {
    try {
      const current=await inspectCommerce(item.directory);
      need(current.buyers.length===item.buyers.length&&current.buyers.every(job=>{
        const saved=item.buyers.find(x=>x.intentId===job.operation.intentId);
        return saved&&same([saved.state,saved.configSha256,saved.bodySha256,saved.bodyBytes,saved.attemptId],
          [job.state,job.configSha256,job.bodySha256,job.bodyBytes,job.attempt?.id??null]);
      }),'COMMERCE_RECOVERY_REOPEN_CHANGED');
    } catch(error){commerceReopenErrors.push({directory:item.directory,code:codeOf(error)});}
  }
  return {...result,commerceReopenErrors,executionStarted:false};
}
