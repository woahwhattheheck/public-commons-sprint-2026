// SPDX-License-Identifier: MIT
// Compose the original complete runtime, installer and portable receiver.
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access,open,readFile,mkdir,lstat,realpath,link,unlink,copyFile} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,relative,delimiter} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {inspectOriginalSource,WORKBENCH_ROOT,ORIGINAL_MANIFEST_SHA256} from './managed.mjs';

const PRODUCT=dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.replication-workbench-preparation.v1';
const ORIGINAL_MANIFEST_SHA=ORIGINAL_MANIFEST_SHA256;
const ENGINE_BYTES=121317497,ENGINE_SHA='e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
const equal=(a,b)=>canonical(a)===canonical(b);
const fail=(code,message,details={})=>Object.assign(new Error(message),{code,details});
const need=(v,code,message,details)=>{if(!v)throw fail(code,message,details);};
const now=()=>new Date().toISOString();
const inside=(root,path)=>{const r=relative(root,path);return !r||!isAbsolute(r)&&r!=='..'&&!r.startsWith('../');};
async function present(path){try{await lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
async function directory(path){
  path=resolve(path);const parent=dirname(path);if(parent!==path)await directory(parent);
  try{await mkdir(path,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
  const s=await lstat(path);need(s.isDirectory()&&!s.isSymbolicLink()&&await realpath(path)===path,'PREPARE_DIRECTORY','Use ordinary canonical directories.');
  return path;
}
async function privateRoot(path){
  need(typeof path==='string'&&isAbsolute(path),'PREPARE_DIRECTORY','Select an absolute private preparation directory.');
  path=await directory(path);const s=await lstat(path);
  need(!(s.mode&0o077)&&(!process.getuid||s.uid===process.getuid()),'PREPARE_PRIVATE','Use an owned private preparation directory.');
  need(!inside(WORKBENCH_ROOT,path)&&!inside(path,WORKBENCH_ROOT),'PREPARE_SOURCE_LAYOUT','Keep preparation outside the selected source tree and its ancestors.');
  return path;
}
async function identity(path){
  path=resolve(path);need(await realpath(path)===path,'PREPARE_FILE','Use a canonical ordinary file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const before=await fd.stat();need(before.isFile(),'PREPARE_FILE','Use an ordinary complete file.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let offset=0;
    while(offset<before.size){const r=await fd.read(buffer,0,Math.min(buffer.length,before.size-offset),offset);need(r.bytesRead>0,'PREPARE_EOF','The original complete file ended early.');hash.update(buffer.subarray(0,r.bytesRead));offset+=r.bytesRead;}
    const after=await fd.stat();need(['dev','ino','size','mtimeMs','ctimeMs'].every(k=>before[k]===after[k]),'PREPARE_FILE_CHANGED','The selected original file changed while reading.');
    return{path,bytes:offset,sha256:hash.digest('hex')};
  }finally{await fd.close();}
}
async function verify(file){const actual=await identity(file.path);need(actual.sha256===file.sha256&&actual.bytes===file.bytes,'PREPARE_IDENTITY','The original selected file differs.',{path:file.path});return actual;}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function syncParent(path){const fd=await open(dirname(path),'r');try{await fd.sync();}finally{await fd.close();}}
async function immutable(path,value){
  await directory(dirname(path));const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(await present(path)){need(equal(await json(path),value),'PREPARE_RECORD_CHANGED','Preserve the original selected request/result.',{path});await syncParent(path);return identity(path);}
  const temporary=path+'.pending-'+randomUUID(),fd=await open(temporary,'wx',0o600);
  try{await fd.writeFile(bytes);await fd.sync();}finally{await fd.close();}
  try{await link(temporary,path);}catch(e){if(e.code!=='EEXIST')throw e;need(equal(await json(path),value),'PREPARE_RECORD_CHANGED','The original publication differs.',{path});}
  finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
  await syncParent(path);return identity(path);
}
async function executable(value,fallback){
  const chosen=value??fallback;need(typeof chosen==='string'&&chosen,'PREPARE_EXECUTABLE','Select the original executable.');
  const paths=isAbsolute(chosen)?[chosen]:chosen.includes('/')?[resolve(chosen)]:(process.env.PATH??'').split(delimiter).filter(Boolean).map(p=>join(p,chosen));
  for(const path of paths)try{await access(path,constants.X_OK);const actual=await realpath(path);const s=await lstat(actual);if(s.isFile())return actual;}catch(e){if(!['ENOENT','EACCES','ENOTDIR'].includes(e.code))throw e;}
  throw fail('PREPARE_EXECUTABLE','The selected executable is unavailable.',{selected:chosen});
}
async function lock(root){
  const path=join(root,'.runtime','preparation.lock');await directory(dirname(path));
  const fd=await open(path,constants.O_CREAT|constants.O_RDWR|constants.O_NOFOLLOW,0o600);
  try{const s=await fd.stat();need(s.isFile()&&s.nlink===1&&(!process.getuid||s.uid===process.getuid()),'PREPARE_LOCK','Use the original ordinary operation lock.');
    await new Promise((yes,no)=>{
      const child=spawn('flock',['--exclusive','--nonblock','3'],{stdio:['ignore','ignore','pipe',fd.fd],shell:false});
      let message='';child.stderr.on('data',b=>{message=(message+b.toString()).slice(-4096);});
      child.once('error',no);child.once('close',(code,signal)=>code===0&&!signal?yes():no(fail('PREPARE_BUSY','The original preparation is still owned.',{code,signal,message})));
    });return fd;
  }catch(e){await fd.close();throw e;}
}

class Preparation{
  constructor(root,fd,request){this.root=root;this.fd=fd;this.request=request;this.control=join(root,'.runtime');}
  async command(name,command,args,{reuse=true}={}){
    const selected={command,args,cwd:WORKBENCH_ROOT,node:this.request.node,sourceManifestSha256:ORIGINAL_MANIFEST_SHA,transfer:this.request.transfer};
    const home=join(this.control,'commands',name),success=join(home,'SUCCESS.json');
    await directory(home);await immutable(join(home,'SELECTION.json'),selected);
    if(reuse&&await present(success)){const saved=await json(success);need(equal(saved.selection,selected)&&saved.exitCode===0&&!saved.signal,'PREPARE_COMMAND_SELECTION','The original completed command differs.');await verify(saved.stdout);await verify(saved.stderr);return json(saved.stdout.path);}
    // A completed child result can precede publication of SUCCESS.json.
    if(reuse){const {readdir}=await import('node:fs/promises');for(const entry of (await readdir(home)).filter(x=>/^attempt-[a-f0-9-]+$/.test(x)).sort()){
      const path=join(home,entry,'RESULT.json');if(!await present(path))continue;const saved=await json(path);
      if(saved.exitCode===0&&!saved.signal&&!saved.observationError&&equal(saved.selection,selected)){
        await verify(saved.stdout);await verify(saved.stderr);await immutable(success,saved);return json(saved.stdout.path);
      }
    }}
    const attempt=join(home,'attempt-'+randomUUID());await directory(attempt);
    await immutable(join(attempt,'REQUEST.json'),{selection:selected,requestedAt:now()});
    const stdoutPath=join(attempt,'stdout.json'),stderrPath=join(attempt,'stderr.log');
    const stdout=await open(stdoutPath,'wx',0o600);let stderr;
    try{stderr=await open(stderrPath,'wx',0o600);}catch(error){await stdout.close();throw error;}
    let result,observationError=null,spawned=false;
    try{
      const child=spawn(command,args,{cwd:WORKBENCH_ROOT,shell:false,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1',CODEX_PRIMARY_RUNTIME_PYTHON:this.request.python,PATH:dirname(process.execPath)+delimiter+(process.env.PATH??'')},
        stdio:['ignore',stdout.fd,stderr.fd,this.fd.fd]});
      const closed=new Promise((yes,no)=>{child.once('error',no);child.once('close',(exitCode,signal)=>yes({exitCode,signal}));});closed.catch(()=>{});
      try{await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no);});spawned=true;
        await immutable(join(attempt,'STARTED.json'),{selection:selected,pid:child.pid,startedAt:now()});
      }catch(error){observationError={code:error.code??'PREPARE_OBSERVATION',message:error.message};}
      // A record failure after spawn never releases the caller's lock or log FDs
      // before this exact acquired child closes. Inner original locks own npm/build.
      try{result=await closed;}catch(error){if(!observationError)observationError={code:error.code??'PREPARE_SPAWN',message:error.message};result={exitCode:null,signal:null};}
      await stdout.sync();await stderr.sync();
    }finally{await stdout.close();await stderr.close();}
    const record={selection:selected,spawned,...result,observationError,endedAt:now(),stdout:await identity(stdoutPath),stderr:await identity(stderrPath)};
    await immutable(join(attempt,'RESULT.json'),record);
    need(spawned&&result.exitCode===0&&!result.signal&&!observationError,'ORIGINAL_PREPARATION_COMMAND','The original command did not finish with a retained successful result.',{attempt,exitCode:result.exitCode,signal:result.signal,observationError});
    const stat=record.stdout;need(stat.bytes<=32*1024*1024,'PREPARE_RESULT_SIZE','Retain the complete original response within its declared bound.');
    const response=await json(stdoutPath);
    if(reuse)await immutable(success,record);
    return response;
  }

  transfer(operation,name,options,{reuse=true}={}){
    const args=['-B',join(PRODUCT,'preparation-transfer.py'),operation,'--manifest',join(PRODUCT,'original-source.json'),'--manifest-sha256',ORIGINAL_MANIFEST_SHA];
    for(const [key,value]of Object.entries(options))if(value)args.push('--'+key,value);
    return this.command(name,this.request.python,args,{reuse});
  }
  async install(name,applicationDirectory,runtimeDirectory,archive){
    await inspectOriginalSource({directory:applicationDirectory});
    const args=['-B',join(applicationDirectory,'native/install.py'),'--directory',runtimeDirectory];
    if(archive)args.push('--archive',archive);
    const observed=await this.command(name+'-install',this.request.python,args);
    need(observed.state==='ready'&&observed.receipt===join(runtimeDirectory,'runtime-ready.json'),
      'PREPARE_RUNTIME','The original native installer did not retain its exact ready result.');
    const runtimeReadyFile=observed.receipt,ready=await identity(runtimeReadyFile);
    const bound={applicationDirectory,runtimeDirectory,runtimeReadyFile,ready,runtime:await json(runtimeReadyFile)};
    await this.verifyBound(bound);return bound;
  }
  async verifyBound(bound){
    await inspectOriginalSource({directory:bound.applicationDirectory});
    await verify(bound.ready);
    need(bound.runtimeReadyFile===bound.ready.path&&bound.runtimeReadyFile===join(bound.runtimeDirectory,'runtime-ready.json'),
      'PREPARE_BINDING','Preserve the original runtime directory and ready receipt.');
    const {readRuntime}=await import(pathToFileURL(join(bound.applicationDirectory,'native/runtime.mjs')).href);
    const observed=readRuntime(bound.runtimeReadyFile);
    need(equal(observed,bound.runtime)&&observed.archive.bytes===ENGINE_BYTES&&observed.archive.sha256===ENGINE_SHA,
      'PREPARE_RUNTIME_CHANGED','The selected original Sling runtime changed.');
    return bound;
  }
  async inspectResult(result){
    need(result.schema===SCHEMA&&result.state==='READY'&&result.source.manifestSha256===ORIGINAL_MANIFEST_SHA&&
      result.directory===this.root,'PREPARE_RESULT_SELECTION','Select this exact completed preparation.');
    await verify(result.request);
    need(equal(await json(result.request.path),this.request),'PREPARE_REQUEST_CHANGED','The completed preparation selects another request.');
    await this.verifyBound(result.primary);await this.verifyBound(result.receiving);await verify(result.portable);
    await this.transfer('inspect','inspect-complete-transfer',{archive:result.portable.path},{reuse:false});
    return result;
  }
  async complete(){
    const resultPath=join(this.control,'PREPARED.json'),candidatePath=join(this.control,'CANDIDATE.json');
    if(await present(resultPath)||await present(candidatePath)){
      const result=await this.inspectResult(await json(await present(candidatePath)?candidatePath:resultPath));
      await immutable(resultPath,result);return result;
    }
    let primary,portable;
    if(this.request.mode==='prepare'){
      const applicationDirectory=join(this.root,'primary','application');
      await this.transfer('source','primary-source',{source:WORKBENCH_ROOT,output:applicationDirectory});
      await inspectOriginalSource({directory:applicationDirectory});
      primary=await this.install('primary',applicationDirectory,join(this.root,'primary','runtime'),this.request.archive?.path);
      const output=join(this.root,'replication-workbench-transfer.tar.gz');
      await this.transfer('pack','complete-transfer',{source:applicationDirectory,engine:primary.runtime.archive.path,output});
      portable=await identity(output);
    }else{
      await verify(this.request.archive);portable=this.request.archive;
      await this.transfer('receive','primary-receive',{archive:portable.path,output:join(this.root,'primary')});
      primary=await this.install('primary',join(this.root,'primary','application'),join(this.root,'primary-runtime'),
        join(this.root,'primary','sling_linux_amd64.tar.gz'));
    }
    await this.transfer('receive','independent-receive',{archive:portable.path,output:join(this.root,'receiving')});
    const receiving=await this.install('receiving',join(this.root,'receiving','application'),join(this.root,'receiving-runtime'),
      join(this.root,'receiving','sling_linux_amd64.tar.gz'));
    need(primary.applicationDirectory!==receiving.applicationDirectory&&primary.runtimeDirectory!==receiving.runtimeDirectory&&
      primary.runtime.executable.path!==receiving.runtime.executable.path,'PREPARE_INDEPENDENT_RECEIVING','Use independent original installation paths.');
    const source=await inspectOriginalSource({directory:primary.applicationDirectory});
    const result={schema:SCHEMA,state:'READY',directory:this.root,completedAt:now(),request:await identity(join(this.control,'REQUEST.json')),
      primary,receiving,portable,source:{manifestSha256:source.manifestSha256,files:source.files,bytes:source.bytes},
      resultPath,next:{applicationDirectory:primary.applicationDirectory,runtimeReadyFile:primary.runtimeReadyFile}};
    await this.inspectResult(result);
    await immutable(candidatePath,result);await immutable(resultPath,result);return result;
  }
}
function parse(argv){
  const mode=argv.shift();need(['prepare','receive','inspect','export'].includes(mode),'PREPARE_MODE','Select prepare, receive, inspect or export.');
  const options={mode},flags=new Set(['directory','python','archive','output']);
  for(let i=0;i<argv.length;i++){
    const key=argv[i];if(key==='--resume'){need(!options.resume,'PREPARE_OPTION','Use each option once.');options.resume=true;continue;}
    need(key.startsWith('--')&&flags.has(key.slice(2))&&argv[i+1]&&!argv[i+1].startsWith('--')&&!Object.hasOwn(options,key.slice(2)),
      'PREPARE_OPTION','Use each complete documented option once.');options[key.slice(2)]=argv[++i];
  }
  const allowed=mode==='prepare'||mode==='receive'?['directory','python','archive','resume']:mode==='export'?['directory','output']:['directory'];
  need(Object.keys(options).every(k=>k==='mode'||allowed.includes(k)),'PREPARE_OPTION','This operation does not accept that option.');
  need(options.directory,'PREPARE_DIRECTORY','Select an absolute private preparation directory.');
  if(['prepare','receive'].includes(mode))need(options.python&&isAbsolute(options.python),'PREPARE_PYTHON','Select the actual absolute Python executable.');
  if(mode==='receive')need(options.archive,'PREPARE_ARCHIVE','Select the complete portable application and original runtime archive.');
  if(mode==='export')need(options.output,'PREPARE_ARCHIVE','Select the complete output archive.');
  for(const key of ['directory','python','archive','output'])if(options[key])need(isAbsolute(options[key]),'PREPARE_PATH','Select canonical absolute paths.');
  return options;
}
export async function prepareReplicationWorkbench(options){
  need(/^v24\./.test(process.version)&&process.platform==='linux'&&process.arch==='x64',
    'PREPARE_HOST','Run the original Linux amd64 application with Node24.');
  await inspectOriginalSource();
  const root=await privateRoot(options.directory),fd=await lock(root);
  try{
    const path=join(root,'.runtime','REQUEST.json'),node={executable:await realpath(process.execPath),version:process.version,
      abi:process.versions.modules,platform:process.platform,architecture:process.arch},transfer=await identity(join(PRODUCT,'preparation-transfer.py'));
    if(['inspect','export'].includes(options.mode)){
      need(await present(path),'PREPARE_REQUEST','The original request is absent.');
      const request=await json(path);
      need(equal(request.node,node)&&equal(request.transfer,transfer)&&request.sourceManifestSha256===ORIGINAL_MANIFEST_SHA,
        'PREPARE_HOST','Reopen with the same selected host runtime and complete product source.');
      const course=new Preparation(root,fd,request),resultPath=join(root,'.runtime','PREPARED.json');
      need(await present(resultPath),'PREPARE_INCOMPLETE','Resume the same original preparation before inspecting/exporting.');
      const result=await course.inspectResult(await json(resultPath));
      if(options.mode==='inspect')return{schema:SCHEMA,state:'READY',result,verifiedAt:now()};
      const output=resolve(options.output);
      need(isAbsolute(options.output)&&!inside(root,output),'PREPARE_EXPORT_PATH','Select an absolute output archive outside this preparation.');
      await privateRoot(dirname(output));
      if(await present(output)){const existing=await identity(output);need(existing.bytes===result.portable.bytes&&existing.sha256===result.portable.sha256,
        'PREPARE_EXPORT_CHANGED','The selected output already contains another transfer.');return{schema:SCHEMA,state:'EXPORTED',portable:existing,source:result.source};}
      const temporary=join(dirname(output),'.replication-export-'+randomUUID());
      try{
        await copyFile(result.portable.path,temporary,constants.COPYFILE_EXCL);
        const copied=await identity(temporary);need(copied.bytes===result.portable.bytes&&copied.sha256===result.portable.sha256,'PREPARE_EXPORT_CHANGED','The complete transfer changed during export.');
        const stream=await open(temporary,'r');try{await stream.sync();}finally{await stream.close();}
        await link(temporary,output);await syncParent(output);
      }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
      return{schema:SCHEMA,state:'EXPORTED',portable:await identity(output),source:result.source};
    }
    need(['prepare','receive'].includes(options.mode),'PREPARE_MODE','Select an original preparation operation.');
    need(typeof options.python==='string'&&isAbsolute(options.python),'PREPARE_PYTHON','Select the actual absolute Python executable.');
    const python=await executable(options.python),archive=options.archive?await identity(options.archive):null;
    if(options.mode==='prepare'&&archive)need(archive.bytes===ENGINE_BYTES&&archive.sha256===ENGINE_SHA,'PREPARE_ENGINE_ARCHIVE','Select the complete original Sling1.6.5 release archive.');
    if(options.mode==='receive')need(archive,'PREPARE_ARCHIVE','Select the complete original transfer.');
    const request={schema:SCHEMA,mode:options.mode,directory:root,sourceManifestSha256:ORIGINAL_MANIFEST_SHA,node,python,transfer,archive};
    if(await present(path)){
      need(equal(await json(path),request),'PREPARE_REQUEST_CHANGED','Resume the same exact source, host, executable paths and complete input archive.');
      need(options.resume||await present(join(root,'.runtime','PREPARED.json')),'RESUME_REQUIRED','Continue this incomplete preparation with --resume.');
    }
    await immutable(path,request);
    return await new Preparation(root,fd,request).complete();
  }finally{await fd.close();}
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){
    const help={command:'replication-workbench-prepare',
      prepare:'prepare --directory ABS_PRIVATE --python ABS [--archive ABS_ORIGINAL_SLING_TAR] [--resume]',
      receive:'receive --directory ABS_PRIVATE --archive ABS_COMPLETE_TRANSFER --python ABS [--resume]',
      inspect:'inspect --directory ABS_PRIVATE',export:'export --directory ABS_PRIVATE --output ABS_COMPLETE_TRANSFER'};
    process.stdout.write(JSON.stringify(help,null,2)+'\n');return help;
  }
  const result=await prepareReplicationWorkbench(parse([...argv]));process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'PREPARATION_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
