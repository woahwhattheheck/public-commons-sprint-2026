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

const SCHEMA='stellar-forge.sf88.workspace-recovery.v1';
const COLLECTION='stellar-forge.sf88.workspace-recovery.v2';
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

const originalOperators=plan=>[plan,...(plan.operators??[])];
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
    let output='',settled=false;
    const finish=(problem,result)=>{
      if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);
      problem?reject(problem):accept(result);
    };
    const abort=()=>{child.kill('SIGKILL');};
    signal?.addEventListener('abort',abort,{once:true});
    const timer=setTimeout(()=>{child.kill('SIGKILL');finish(error('WORKSPACE_RECOVERY_ARCHIVE_TIMEOUT'));},1800000);
    child.once('error',()=>finish(error('WORKSPACE_RECOVERY_ARCHIVE_START_FAILED')));
    child.stdout.on('data',chunk=>{
      output+=chunk;
      if(output.length>65536){child.kill('SIGKILL');finish(error('WORKSPACE_RECOVERY_ARCHIVE_RESULT_INVALID'));}
    });
    child.once('close',code=>{
      if(code!==0)return finish(error('WORKSPACE_RECOVERY_ARCHIVE_FAILED'));
      try {finish(null,JSON.parse(output));}catch{finish(error('WORKSPACE_RECOVERY_ARCHIVE_RESULT_INVALID'));}
    });
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
  const plan=await inspectWorkspaceRecovery(options);
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
    need(same(plan,await inspectWorkspaceRecovery(options)),'WORKSPACE_RECOVERY_SOURCE_CHANGED');
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
      need(plan.schema===COLLECTION&&typeof prepareSnapshot==='function','WORKSPACE_RECOVERY_CAPTURE_HOOK_INVALID');
      application=await prepareSnapshot({staged,stateRoot:plan.stateRoot,plan});
      need(object(application)&&Buffer.byteLength(JSON.stringify(application))<=1024*1024,
        'WORKSPACE_RECOVERY_APPLICATION_RECORD_INVALID');
    }
    const files=await stagedFiles(staged,signal);
    for(const entry of [...files].reverse())if(entry.kind==='directory')await syncDirectory(join(staged,entry.path));
    const checkpoint=checkpoints.find(item=>item.directory===plan.directory).checkpoint;
    const record={schema:plan.schema,createdAt:new Date().toISOString(),plan,checkpoint,files,
      ...(plan.schema===COLLECTION?{checkpoints,...(application?{application}:{})}:{})};
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
    return {status:'BUYER_STATE_BACKUP_CREATED',bundle:output,
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
  need(object(record)&&[SCHEMA,COLLECTION].includes(record.schema)&&object(record.plan)&&record.plan.schema===record.schema&&
    Array.isArray(record.files)&&record.files.length<=MAX_FILES&&Array.isArray(record.plan.inboxes)&&
    Array.isArray(record.plan.runtime)&&record.checkpoint?.outcome==='JOURNAL_CONSISTENT',
    'WORKSPACE_RECOVERY_RECORD_INVALID');
  const p=record.plan;absolute(p.stateRoot);
  if(record.schema===COLLECTION)need(Array.isArray(p.operators)&&p.operators.length<=63&&
    Array.isArray(record.checkpoints)&&record.checkpoints.length===p.operators.length+1&&
    (record.application===undefined||object(record.application)&&
      Buffer.byteLength(JSON.stringify(record.application))<=1024*1024),'WORKSPACE_RECOVERY_RECORD_INVALID');
  else need(p.operators===undefined&&record.checkpoints===undefined&&record.application===undefined,
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
    if(inspectSnapshot!==undefined) {
      need(typeof inspectSnapshot==='function','WORKSPACE_RECOVERY_CAPTURE_HOOK_INVALID');
      await inspectSnapshot({staged,record,map});
    }
    return {temporary,staged,record,recordSha256};
  } catch(e){await rm(temporary,{recursive:true,force:true});throw e;}
}
export async function verifyWorkspaceRecovery(options,context) {
  const opened=await openBackup(options,context);
  try {return {status:'BUYER_STATE_BACKUP_VERIFIED',...result(opened.record,opened.recordSha256)};}
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
      need((await readdir(target)).length===0,'WORKSPACE_RECOVERY_TARGET_NOT_EMPTY');
    }
    let staged=opened.staged;
    if((await lstat(staged)).dev!==(await lstat(parent)).dev) {
      adjacent=await mkdtemp(join(parent,'.sf88-restore-'));
      await copyState(staged,adjacent,record.files,context?.signal);staged=adjacent;
    }
    need(!context?.signal?.aborted,'WORKSPACE_RECOVERY_INTERRUPTED');
    // Reserving an empty private destination permits an interrupted publication
    // to restart. POSIX rename refuses a concurrently populated directory.
    await mkdir(target,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    await privateDirectory(target);
    need((await readdir(target)).length===0,'WORKSPACE_RECOVERY_TARGET_NOT_EMPTY');
    await rename(staged,target);
    const collection=record.schema===COLLECTION;
    const diagnostic=failure=>/^[A-Z0-9_]{1,120}$/.test(failure?.code??'')?failure.code:'WORKSPACE_RECOVERY_REOPEN_FAILED';
    published={status:'BUYER_STATE_RESTORED',...result(record,opened.recordSha256),
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
    return published;
  } finally {
    for(const path of [adjacent,opened.temporary].filter(Boolean)) {
      try {await rm(path,{recursive:true,force:true});}
      catch(failure) {
        if(published?.schema!==COLLECTION)throw failure;
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
