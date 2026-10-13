#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Install, inspect and transfer the original dlt runtime. Pipeline ownership
// remains with the complete application receiving programme.
import {readFile,writeFile,mkdir,rename,copyFile,readdir,lstat,readlink,chmod,unlink,open,stat,link} from 'node:fs/promises';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve,join,dirname,relative,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const HERE=dirname(fileURLToPath(import.meta.url));
const COMMIT='2360d229c77f7f64692acc31a4555f4cfcd50ed3';
const REPO='https://github.com/dlt-hub/dlt.git';
const PINS={
 'pyproject.toml':'1fab0023430f142a3fbdacf05290fce2d9409302dc545b05ad11c498a405edcb',
 'uv.lock':'ec26611cedb620e1e7fa5342c39934bb175df16449a868975199e027da8201d4',
 'README.md':'136175c5ffad0b39d70a9ce7b512a601aef62fe3604bcba19f6a81a0988513c9',
 'LICENSE.txt':'3bd68ce12f57c10e265b3d19b3251efa5aa40f780f590bc8bb7b1c83f85854ca'
};
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':
 v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const bytes=v=>Buffer.from(canonical(v)+'\n');
const need=(condition,message)=>{if(!condition)throw Error(message);};
async function exists(p){try{await lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function json(p){return JSON.parse(await readFile(p,'utf8'));}
async function syncDirectory(p){const fd=await open(dirname(p),'r');try{await fd.sync();}finally{await fd.close();}}
async function publishBytes(p,data,{exclusive=false,mode=0o600}={}){
 if(exclusive&&await exists(p)){need((await readFile(p)).equals(data),'Original runtime selection changed: '+p);return;}
 const tmp=p+'.'+process.pid+'.'+Math.random().toString(16).slice(2)+'.partial';
 const fd=await open(tmp,'wx',mode);try{await fd.writeFile(data);await fd.sync();}finally{await fd.close();}
 try{
  if(exclusive){try{await link(tmp,p);}catch(e){if(e.code!=='EEXIST')throw e;need((await readFile(p)).equals(data),'Original runtime selection changed: '+p);}await unlink(tmp);}
  else await rename(tmp,p);
  await syncDirectory(p);
 }catch(e){if(await exists(tmp))await unlink(tmp);throw e;}
}
async function atomic(p,value){await publishBytes(p,bytes(value));}
async function immutable(p,value){await publishBytes(p,bytes(value),{exclusive:true});}
function argumentsOf(args){const out={action:args.shift()};while(args.length){const key=args.shift();need(/^--[a-z][a-z0-9-]*$/.test(key),'Named runtime arguments required.');const value=args.shift();need(value&&!value.startsWith('--'),'Missing '+key);need(!(key.slice(2) in out),'Repeated '+key);out[key.slice(2)]=value;}return out;}
async function processIdentity(pid){try{const source=await readFile('/proc/'+pid+'/stat','utf8');const parts=source.slice(source.lastIndexOf(')')+2).split(' ');return {pid,start:parts[19],boot:(await readFile('/proc/sys/kernel/random/boot_id','utf8')).trim()};}catch(e){if(e.code==='ENOENT')return null;throw e;}}
async function alive(identity){if(!identity)return false;const current=await processIdentity(identity.pid);return current?.start===identity.start&&current?.boot===identity.boot;}
function childEnvironment(root){
 const env={...process.env};
 for(const name of Object.keys(env))if(/^(UV_|PIP_|PYTHON|VIRTUAL_ENV$|CONDA_PREFIX$|GIT_CONFIG_|GIT_WORK_TREE$|GIT_DIR$|DLT_WORKSHARE_OPERATION_LOCK_)/.test(name))delete env[name];
 return {...env,PYTHONNOUSERSITE:'1',PYTHONDONTWRITEBYTECODE:'1',
  UV_PROJECT_ENVIRONMENT:join(root,'environment'),UV_CACHE_DIR:join(root,'uv-cache'),
  UV_PYTHON_DOWNLOADS:'never',UV_NO_PROGRESS:'1',UV_LINK_MODE:'copy',
  GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_SYSTEM:'/dev/null',GIT_TERMINAL_PROMPT:'0',GIT_OPTIONAL_LOCKS:'0',
  RUNTIME__DLTHUB_TELEMETRY:'false',DLT_DATA_DIR:join(root,'inspection-data')};
}
async function execute(root,argv,{cwd=root,env=childEnvironment(root)}={}){
 const current=join(root,'command.json');
 if(await exists(current)){const old=await json(current);need(old.state!=='running'||!await alive(old.process),'The original runtime command is still running.');}
 await mkdir(join(root,'logs'),{recursive:true,mode:0o700});
 const id=Date.now()+'-'+process.pid+'-'+Math.random().toString(16).slice(2);
 const stdoutPath=join(root,'logs',id+'.stdout'),stderrPath=join(root,'logs',id+'.stderr');
 const out=await open(stdoutPath,'wx',0o600),err=await open(stderrPath,'wx',0o600);
 let child,identity,result;
 try{
  child=spawn(argv[0],argv.slice(1),{cwd,env,stdio:['ignore',out.fd,err.fd,...[...LEASES.values()].map(fd=>fd.fd)]});
  const completion=new Promise((resolveDone,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolveDone({code,signal}));});
  completion.catch(()=>{});
  identity=child.pid?await processIdentity(child.pid):null;
  let publicationError=null;
  const running={state:'running',id,argv,cwd,process:identity,startedAt:new Date().toISOString(),stdoutPath,stderrPath};
  OWN_COMMANDS.set(root,running);
  try{await atomic(current,running);}
  catch(error){publicationError=error;}
  // Keep the inherited lease and receive the real child even when writing its
  // process receipt fails after spawn. The command itself stays the original.
  result=await completion;
  OWN_COMMANDS.set(root,{...running,state:'closed',...result,finishedAt:new Date().toISOString()});
  if(publicationError)throw publicationError;
 }finally{await out.close();await err.close();}
 const entry={state:'closed',id,argv,cwd,process:identity,...result,finishedAt:new Date().toISOString(),stdoutPath,stderrPath};
 await atomic(current,entry);await writeFile(join(root,'commands.ndjson'),JSON.stringify(entry)+'\n',{flag:'a',mode:0o600});
 if(result.code!==0)throw Error('Original runtime command exited '+result.code+': '+argv[0]+'; complete log '+stderrPath);
 return await readFile(stdoutPath,'utf8');
}
const LEASES=new Map();
// Only commands started by this process may be attributed to its original job.
const OWN_COMMANDS=new Map();
async function lockedFile(key,path,work){
 need(!LEASES.has(key),'This original operation is already selected by the current process.');
 const lease=await open(path,'a+',0o600);
 const inherited=[...[...LEASES.values()].map(fd=>fd.fd),lease.fd];
 const acquired=spawnSync('flock',['--nonblock',String(2+inherited.length)],{stdio:['ignore','pipe','pipe',...inherited]});
 if(acquired.error||acquired.status!==0){await lease.close();throw acquired.error||Error('The original operation is active: '+path);}
 LEASES.set(key,lease);
 try{return await work();}finally{LEASES.delete(key);await lease.close();}
}
async function locked(root,work){
 await mkdir(root,{recursive:true,mode:0o700});
 return lockedFile(root,join(root,'.runtime.lease'),work);
}
async function sourceManifest(root){
 const src=join(root,'source');
 for(const [name,pin] of Object.entries(PINS))need(hash(await readFile(join(src,name)))===pin,'Original '+name+' differs.');
 const head=(await execute(root,['git','rev-parse','HEAD'],{cwd:src})).trim();need(head===COMMIT,'Original dlt source commit differs.');
 const dirty=await execute(root,['git','diff','--name-only','HEAD','--'],{cwd:src});need(!dirty.trim(),'The selected original source has local changes.');
 const index=await execute(root,['git','ls-files','--stage','-z'],{cwd:src}),files=[];
 for(const row of index.split('\0').filter(Boolean)){
  const split=row.indexOf('\t'),[mode,blob,stage]=row.slice(0,split).split(' '),name=row.slice(split+1);
  need(stage==='0'&&['100644','100755','120000'].includes(mode),'The original checkout has an unresolved or unsupported member.');
  need(name&&name!=='.git'&&!name.startsWith('../')&&!name.startsWith('/'),'Invalid original source path.');
  const p=join(src,name),info=await lstat(p);
  const body=mode==='120000'?Buffer.from(await readlink(p)):await readFile(p);
  need(mode==='120000'?info.isSymbolicLink():info.isFile(),'Original source type differs.');
  const computed=createHash('sha1').update(Buffer.from('blob '+body.length+'\0')).update(body).digest('hex');
  need(computed===blob,'Original Git source byte mismatch: '+name);
  files.push({path:name,mode,gitBlob:blob,bytes:body.length,sha256:hash(body)});
 }
 files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const value={schema:'dlt-workshare.source-manifest.v1',repository:REPO,commit:COMMIT,files};
 await immutable(join(root,'source-manifest.json'),value);return {value,sha256:hash(bytes(value))};
}
async function prepareSource(root){
 const src=join(root,'source');await mkdir(src,{recursive:true,mode:0o700});
 if(!await exists(join(src,'.git')))await execute(root,['git','init','--quiet'],{cwd:src});
 let selected=false;
 try{selected=(await execute(root,['git','rev-parse','HEAD'],{cwd:src})).trim()===COMMIT;}catch{}
 if(!selected){
  await execute(root,['git','-c','core.autocrlf=false','fetch','--depth=1',REPO,COMMIT],{cwd:src});
  await execute(root,['git','-c','core.autocrlf=false','checkout','--detach',COMMIT],{cwd:src});
 }
 return sourceManifest(root);
}
async function inspect(root){
 const envpython=join(root,'environment','bin','python');
 const result=JSON.parse(await execute(root,[envpython,'-P',join(root,'inspect.py'),root]));
 need(result.python.executable===envpython,'The environment executable selection changed.');
 const manifests=await sourceManifest(root);
 const uv=join(root,'bin','uv');
 const uvIdentity={sha256:hash(await readFile(uv)),version:(await execute(root,[uv,'--version'])).trim()};
 const {executable,...pythonIdentity}=result.python;
 const identity={schema:'dlt-workshare.runtime-identity.v1',sourceCommit:COMMIT,sourceManifestSha256:manifests.sha256,
  lockSha256:PINS['uv.lock'],uv:uvIdentity,python:pythonIdentity,duckdb:result.duckdb,distributions:result.identityDistributions};
 const runtimeId=hash(bytes(identity));
 const local={python:result.python,dlt:result.dlt,duckdb:result.duckdb,distributions:result.distributions};
 return {result,identity,runtimeId,local,localSha256:hash(bytes(local)),sourceManifestSha256:manifests.sha256,uv:uvIdentity};
}
async function sync(root,python,offline){
 const uv=join(root,'bin','uv');
 const argv=[uv,'sync','--locked','--no-default-groups','--extra','duckdb','--python',python,'--no-python-downloads'];
 if(offline)argv.push('--offline');
 await execute(root,argv,{cwd:join(root,'source')});
 // Sync is exact; use uv's installed dependency check as part of receiving.
 await execute(root,[uv,'pip','check','--python',join(root,'environment','bin','python')]);
 return inspect(root);
}
async function publishReady(root,observed,origin,portable){
 const expectedFile=join(root,'expected-runtime.json');
 if(await exists(expectedFile)){
  const expected=await json(expectedFile);
  need(expected.runtimeId===observed.runtimeId&&canonical(expected.identity)===canonical(observed.identity),
   'The rebuilt runtime differs from the complete original installed selection.');
 }else await immutable(expectedFile,{runtimeId:observed.runtimeId,identity:observed.identity});
 await atomic(join(root,'installed-manifest.json'),observed.local);
 const value={schema:'dlt-workshare.runtime-ready.v1',state:'ready',version:'1.31.0',sourceCommit:COMMIT,
  python:observed.result.python,source:{path:join(root,'source'),manifestSha256:observed.sourceManifestSha256},
  distributions:observed.result.distributions.map(d=>({name:d.name,version:d.version,files:d.files.length})),
  duckdb:observed.result.duckdb,uv:observed.uv,runtimeId:observed.runtimeId,identitySha256:observed.runtimeId,
  installedManifestSha256:observed.localSha256,origin,...(portable?{portable}:{}),observedAt:new Date().toISOString()};
 await atomic(join(root,'runtime-ready.json'),value);return value;
}
async function install(a){
 need(a.directory&&a.python&&a.uv,'install requires --directory, --python and --uv.');
 const root=resolve(a.directory),python=resolve(a.python),uv=resolve(a.uv);
 return locked(root,async()=>{
  const selection={schema:'dlt-workshare.runtime-selection.v1',repository:REPO,sourceCommit:COMMIT,version:'1.31.0',extra:'duckdb',pythonSeries:'3.12',pins:PINS};
  if(!await exists(join(root,'selection.json'))){
   const original=bytes(selection);
   for(const name of await readdir(root)){
    if(name==='.runtime.lease')continue;
    need(/^selection\.json\.[1-9][0-9]*\.[0-9a-f]*\.partial$/.test(name),'Use a new private runtime directory.');
    const p=join(root,name),entry=await lstat(p);
    need(entry.isFile()&&!entry.isSymbolicLink()&&entry.nlink===1&&entry.uid===process.getuid(),'The unfinished selection is not owned by this original installation.');
    const partial=await readFile(p);
    need(partial.length<=original.length&&original.subarray(0,partial.length).equals(partial),'The unfinished selection belongs to another installation.');
    await unlink(p);
   }
   await syncDirectory(join(root,'selection.json'));
  }
  await immutable(join(root,'selection.json'),selection);
  await mkdir(join(root,'bin'),{recursive:true,mode:0o700});await mkdir(join(root,'uv-cache'),{recursive:true,mode:0o700});
  const target=join(root,'bin','uv');
  if(await exists(target))need(hash(await readFile(target))===hash(await readFile(uv)),'The selected original uv binary changed.');
  else await publishBytes(target,await readFile(uv),{exclusive:true,mode:0o700});
  for(const name of ['runtime.mjs','inspect.py','portable.py']){
   const body=await readFile(join(HERE,name)),destination=join(root,name);
   if(await exists(destination))need((await readFile(destination)).equals(body),'The selected installer source changed.');
   else await publishBytes(destination,body,{exclusive:true});
  }
  await prepareSource(root);
  const observed=await sync(root,python,false);
  return publishReady(root,observed,{kind:'original-install'});
 });
}
async function adoptInstaller(a){
 need(a.directory&&a['previous-sha256']&&a['command-id'],'adopt-installer requires --directory, --previous-sha256 and --command-id.');
 need(/^[a-f0-9]{64}$/.test(a['previous-sha256']),'Select the complete previous installer SHA256.');
 const root=resolve(a.directory);
 need(root!==HERE,'Invoke the successor from the application source directory.');
 return locked(root,async()=>{
  need(!await exists(join(root,'runtime-ready.json')),'A ready runtime cannot adopt a failed-install correction.');
  const selection=await json(join(root,'selection.json'));
  need(selection.sourceCommit===COMMIT&&canonical(selection.pins)===canonical(PINS),'The original selected source changed.');
  const command=await json(join(root,'command.json'));
  need(command.state==='closed'&&command.id===a['command-id']&&command.code!==0,'Select the exact closed failed installation command.');
  need(!await alive(command.process),'The original failed command is still alive.');
  for(const name of ['inspect.py','portable.py'])
   need((await readFile(join(root,name))).equals(await readFile(join(HERE,name))),'Companion source differs; select its complete reviewed successor separately.');
  const successor=await readFile(join(HERE,'runtime.mjs')),next=hash(successor),prior=a['previous-sha256'];
  need(next!==prior,'The selected installer is unchanged.');
  const target=join(root,'runtime.mjs'),current=await readFile(target),currentHash=hash(current);
  need(currentHash===prior||currentHash===next,'The installed helper differs from both selected versions.');
  const history=join(root,'installer-revisions');
  await mkdir(history,{recursive:true,mode:0o700});
  const oldFile=join(history,prior+'.mjs'),newFile=join(history,next+'.mjs');
  const recordFile=join(history,prior+'-'+next+'.json');
  const identity={schema:'dlt-workshare.installer-adoption.v1',sourceCommit:COMMIT,previousSha256:prior,
   successorSha256:next,command,companions:['inspect.py','portable.py']};
  if(currentHash===prior)await publishBytes(oldFile,current,{exclusive:true});
  else need(await exists(recordFile),'The installed successor has no original adoption record.');
  need(hash(await readFile(oldFile))===prior,'The complete original installer is missing or changed.');
  await publishBytes(newFile,successor,{exclusive:true});
  if(await exists(recordFile)){
   const saved=await json(recordFile),{state,adoptedAt,...retained}=saved;
   need(canonical(retained)===canonical(identity),'The original installer adoption selection changed.');
   need(['prepared','adopted'].includes(state),'The original installer adoption state differs.');
   if(state==='adopted'){need(currentHash===next,'The adopted installer changed.');return saved;}
  }else await immutable(recordFile,{...identity,state:'prepared'});
  await publishBytes(target,successor);
  const receipt={...identity,state:'adopted',adoptedAt:new Date().toISOString()};
  await atomic(recordFile,receipt);
  return receipt;
 });
}
async function adoptHelpers(a){
 need(a.directory&&a['previous-manifest']&&a['command-id']&&a['runtime-id'],'adopt-helpers requires --directory, --previous-manifest, --command-id and --runtime-id.');
 const root=resolve(a.directory),names=['inspect.py','portable.py','runtime.mjs'];
 need(root!==HERE,'Invoke the successor from the application source directory.');
 return locked(root,async()=>{
  const ready=await json(join(root,'runtime-ready.json')),expected=await json(join(root,'expected-runtime.json'));
  need(ready.state==='ready'&&ready.runtimeId===a['runtime-id']&&expected.runtimeId===ready.runtimeId,'Select the same complete ready runtime.');
  need(!await exists(join(root,'portable-result.json')),'The original runtime already has a published portable export.');
  const command=await json(join(root,'command.json'));
  need(command.state==='closed'&&command.id===a['command-id']&&command.code!==0&&!await alive(command.process),'Select the exact closed failed portable command.');
  need(command.argv[0]===ready.python.executable&&command.argv[1]==='-P'&&command.argv[2]===join(root,'portable.py')&&command.argv[3]==='pack','The failure is not the original portable export.');
  const outputAt=command.argv.indexOf('--output'),output=outputAt>=0?command.argv[outputAt+1]:null;
  need(output&&!await exists(output+'.selection.json'),'The original export already has a frozen member selection.');
  const prior=await json(resolve(a['previous-manifest']));
  need(canonical(Object.keys(prior).sort())===canonical(names),'Select all three previous helper hashes.');
  const files=[];
  for(const name of names){
   need(/^[a-f0-9]{64}$/.test(prior[name]),'Select the complete previous helper SHA256.');
   const successor=await readFile(join(HERE,name)),current=await readFile(join(root,name));
   const next=hash(successor),currentHash=hash(current);
   need(currentHash===prior[name]||currentHash===next,'The installed helper differs from the selected versions: '+name);
   files.push({name,previousSha256:prior[name],successorSha256:next,currentHash,current,successor});
  }
  const identity={schema:'dlt-workshare.portable-helper-adoption.v1',runtimeId:ready.runtimeId,command,
   files:files.map(({name,previousSha256,successorSha256})=>({name,previousSha256,successorSha256}))};
  const history=join(root,'installer-revisions',hash(bytes(identity)));
  await mkdir(history,{recursive:true,mode:0o700});
  const recordFile=join(history,'adoption.json');
  for(const f of files){
   const oldFile=join(history,f.name+'.previous'),newFile=join(history,f.name+'.successor');
   if(f.currentHash===f.previousSha256)await publishBytes(oldFile,f.current,{exclusive:true});
   else need(await exists(recordFile),'The installed successor has no original adoption record.');
   need(hash(await readFile(oldFile))===f.previousSha256,'The original helper is missing or changed.');
   await publishBytes(newFile,f.successor,{exclusive:true});
  }
  if(await exists(recordFile)){
   const saved=await json(recordFile),{state,adoptedAt,...retained}=saved;
   need(canonical(retained)===canonical(identity)&&['prepared','adopted'].includes(state),'The helper adoption selection changed.');
   if(state==='adopted'){need(files.every(f=>f.currentHash===f.successorSha256),'The adopted helper changed.');return saved;}
  }else await immutable(recordFile,{...identity,state:'prepared'});
  for(const f of files)await publishBytes(join(root,f.name),f.successor);
  const receipt={...identity,state:'adopted',adoptedAt:new Date().toISOString()};
  await atomic(recordFile,receipt);return receipt;
 });
}
async function verify(a){
 need(a.directory,'verify requires --directory.');const root=resolve(a.directory);
 return locked(root,async()=>{
  const expected=await json(join(root,'runtime-ready.json')),observed=await inspect(root);
  need(expected.state==='ready'&&expected.runtimeId===observed.runtimeId,'The selected runtime identity changed.');
  need(expected.installedManifestSha256===observed.localSha256,'The complete local installed selection changed.');
  return {...expected,verifiedAt:new Date().toISOString()};
 });
}
async function runSelected(a){
 need(a.directory&&a.cwd&&a['argv-json']&&a['operation-lock'],'run requires --directory, --cwd, --argv-json and --operation-lock.');
 const root=resolve(a.directory),cwd=resolve(a.cwd),argv=JSON.parse(a['argv-json']);
 const operationLock=resolve(a['operation-lock']),job=dirname(operationLock);
 need(Array.isArray(argv)&&argv.length>=2&&argv.every(value=>typeof value==='string'&&value.length&&!value.includes('\0')),'Select the complete original worker argument array.');
 need((await stat(job)).isDirectory(),'Prepare the original job directory before launching its runtime.');
 need(operationLock===join(job,'lifetime.lock'),'Select the original job lifetime.lock.');
 const directoryAt=argv.indexOf('--directory');
 need(directoryAt>=0&&resolve(argv[directoryAt+1]||'')===job,'The worker must select the same original operation directory.');
 return lockedFile(operationLock,operationLock,async()=>{
  const id=Date.now()+'-'+process.pid+'-'+Math.random().toString(16).slice(2);
  const receipt=join(job,'runtime-run.json'),history=join(job,'runtime-runs');
  await mkdir(history,{recursive:true,mode:0o700});
  let record={schema:'dlt-workshare.runtime-run-record.v1',state:'running',id,
   stage:'verification',operationLock,runtimeDirectory:root,argv,cwd,
   process:await processIdentity(process.pid),startedAt:new Date().toISOString(),
   commandFile:join(root,'command.json')};
  async function retain(){await atomic(join(history,id+'.json'),record);await atomic(receipt,record);}
  await retain();
  try{
   const result=await locked(root,async()=>{
    const ready=await json(join(root,'runtime-ready.json')),observed=await inspect(root);
    need(ready.state==='ready'&&ready.runtimeId===observed.runtimeId&&ready.installedManifestSha256===observed.localSha256,'The complete selected worker runtime changed.');
    need(argv[0]===ready.python.executable,'Invoke the exact environment Python executable, preserving its selected symlink.');
    const childFd=3+[...LEASES.keys()].indexOf(operationLock);
    need(childFd>=3,'The original job lease was not inherited.');
    record={...record,stage:'worker',runtimeId:ready.runtimeId,operationLockFd:childFd};
    await retain();
    const env={...childEnvironment(root),DLT_WORKSHARE_OPERATION_LOCK_FD:String(childFd),
     DLT_WORKSHARE_OPERATION_LOCK_PATH:operationLock};
    const stdout=await execute(root,argv,{cwd,env});
    const command=OWN_COMMANDS.get(root);
    need(command?.state==='closed'&&canonical(command.argv)===canonical(argv),'The original worker command did not close.');
    return {schema:'dlt-workshare.runtime-run.v1',runtimeId:ready.runtimeId,
     python:ready.python,stdout,command};
   });
   record={...record,state:'closed',outcome:'completed',command:result.command,finishedAt:new Date().toISOString()};
   await retain();return {...result,operation:record};
  }catch(error){
   record={...record,state:'closed',outcome:'failed',error:String(error.stack||error),finishedAt:new Date().toISOString()};
   if(OWN_COMMANDS.has(root))record.command=OWN_COMMANDS.get(root);
   await retain();throw error;
  }
 });
}
async function pack(a){
 need(a.directory&&a.output,'pack requires --directory and --output.');const root=resolve(a.directory);
 return locked(root,async()=>{
  const ready=await json(join(root,'runtime-ready.json')),observed=await inspect(root);
  need(ready.runtimeId===observed.runtimeId&&ready.installedManifestSha256===observed.localSha256,'Verify the original runtime before transfer.');
  const portable=JSON.parse(await execute(root,[ready.python.executable,'-P',join(root,'portable.py'),'pack','--root',root,'--output',resolve(a.output)]));
  await atomic(join(root,'portable-result.json'),{runtimeId:ready.runtimeId,...portable});
  await atomic(join(root,'runtime-ready.json'),{...ready,portable});return {runtimeId:ready.runtimeId,...portable};
 });
}
async function receive(a){
 need(a.bundle&&a.sha256&&a.directory&&a.python,'receive requires --bundle, --sha256, --directory and --python.');
 need(/^[a-f0-9]{64}$/.test(a.sha256),'Select the original complete archive SHA256.');
 const root=resolve(a.directory),parent=dirname(root),python=resolve(a.python);
 // Unpack once to the original new receiving root, then rebuild with no network.
 const transfer=join(parent,'.'+root.split(sep).at(-1)+'-runtime-transfer');
 return locked(transfer,async()=>{
  const received=JSON.parse(await execute(transfer,[python,'-P',join(HERE,'portable.py'),'unpack','--bundle',resolve(a.bundle),'--sha256',a.sha256,'--directory',root]));
  return locked(root,async()=>{
   const selection=await json(join(root,'selection.json'));need(selection.sourceCommit===COMMIT&&canonical(selection.pins)===canonical(PINS),'The selected runtime source differs.');
   const expected=await json(join(root,'expected-runtime.json'));
   const observed=await sync(root,python,true);
   need(expected.runtimeId===observed.runtimeId,'Offline receiving changed the original runtime.');
   const portable={path:resolve(a.bundle),sha256:a.sha256,bytes:received.bytes,format:'tar.gz',
    manifestSha256:received.manifestSha256,members:received.members};
   need(Number.isSafeInteger(portable.bytes)&&portable.bytes>0&&/^[a-f0-9]{64}$/.test(portable.manifestSha256)&&Number.isSafeInteger(portable.members),'The complete received archive descriptor is missing.');
   await atomic(join(root,'portable-result.json'),{runtimeId:observed.runtimeId,...portable});
   return publishReady(root,observed,{kind:'offline-receiving',archiveSha256:a.sha256,transfer:received},portable);
  });
 });
}
const a=argumentsOf(process.argv.slice(2));need(['install','verify','pack','receive','run','adopt-installer','adopt-helpers'].includes(a.action),'Use install, verify, pack, receive, run, adopt-installer or adopt-helpers.');
need(process.platform==='linux','This original installation selection is Linux.');
const actions={install,verify,pack,receive,run:runSelected,'adopt-installer':adoptInstaller,'adopt-helpers':adoptHelpers};
actions[a.action](a).then(value=>process.stdout.write(JSON.stringify(value,null,2)+'\n')).catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
