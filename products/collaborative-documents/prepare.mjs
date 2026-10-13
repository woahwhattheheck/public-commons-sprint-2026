// SPDX-License-Identifier: MIT
// Compose the original complete runtime, installer and portable receiver.
import {spawn} from 'node:child_process';
import {constants} from 'node:fs';
import {access,open,readFile,mkdir,lstat,realpath,link,unlink} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,relative,delimiter} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {inspectOriginalSource,WORKBENCH_ROOT} from './managed.mjs';

const PRODUCT=dirname(fileURLToPath(import.meta.url));
const SCHEMA='stellar-forge.collaborative-documents-preparation.v1';
const ORIGINAL_MANIFEST_SHA='7f99b944d4cc09f589bc04d189db492ad172501b181f6d3404be027e3d0255b8';
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
function argumentsFor(operation,options){
  const args=['-B',join(WORKBENCH_ROOT,'runtime/manage.py'),operation];
  const names=operation==='prepare'?{application:'--application',manifest:'--manifest',directory:'--directory',node:'--node',npm:'--npm',hocuspocusArchive:'--hocuspocus-archive',tiptapArchive:'--tiptap-archive'}:
    operation==='receive'?{archive:'--archive',directory:'--directory',node:'--node'}:
    operation==='export'?{directory:'--directory',output:'--output',node:'--node'}:{directory:'--directory',node:'--node'};
  for(const [name,flag] of Object.entries(names))if(options[name])args.push(flag,options[name]);
  if(operation==='inspect')args.push('--full');
  return args;
}
class Preparation{
  constructor(root,fd,request){this.root=root;this.fd=fd;this.request=request;this.control=join(root,'.runtime');}
  async command(name,command,args,{reuse=true}={}){
    const selected={command,args,cwd:WORKBENCH_ROOT,node:this.request.node,sourceManifestSha256:ORIGINAL_MANIFEST_SHA};
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
      const child=spawn(command,args,{cwd:WORKBENCH_ROOT,shell:false,env:{...process.env,CODEX_PRIMARY_RUNTIME_PYTHON:this.request.python,PATH:dirname(process.execPath)+delimiter+(process.env.PATH??'')},
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
  runtime(operation,name,options,{reuse=true}={}){return this.command(name,this.request.python,argumentsFor(operation,{...options,node:process.execPath}),{reuse});}
  async inspectRuntime(name,runtime){
    const value=await this.runtime('inspect',name,{directory:runtime},{reuse:false});
    need(value.schema==='hocuspocus.runtime-status.v1'&&value.status==='READY'&&value.directory===runtime&&typeof value.application==='string','PREPARE_RUNTIME','The original complete runtime is not READY.');
    await inspectOriginalSource({directory:value.application});
    return value;
  }
  async bind(name,observed){
    const application=await realpath(observed.application),readyPath=join(this.control,name+'-runtime-ready.json');
    await inspectOriginalSource({directory:application});
    const result=await this.command(name+'-bind',process.execPath,[join(application,'scripts/install.mjs'),'--receipt',readyPath,'--prepared-runtime',observed.directory]);
    need(result.state==='ready'&&result.receipt===readyPath,'PREPARE_BINDING','The original installer did not bind its actual application.');
    const bound={runtimeDirectory:observed.directory,runtimeId:observed.id,applicationDirectory:application,runtimeReadyFile:readyPath,ready:await identity(readyPath)};
    await this.verifyBound(name,bound);return bound;
  }
  async verifyBound(name,bound){
    await verify(bound.ready);
    need(bound.runtimeReadyFile===bound.ready.path,'PREPARE_BINDING','Preserve the same selected ready receipt.');
    const observed=await this.inspectRuntime(name+'-current-inspection',bound.runtimeDirectory);
    need(observed.application===bound.applicationDirectory&&observed.id===bound.runtimeId,'PREPARE_BINDING','The current complete runtime selects another application.');
    const module=await import(pathToFileURL(join(bound.applicationDirectory,'native/selection.mjs')).href);
    const selected=await module.selectRuntime({sourceRoot:bound.applicationDirectory,runtimeReadyFile:bound.runtimeReadyFile});
    const buildPath=join(bound.applicationDirectory,'dist/build-manifest.json'),build=await json(buildPath);
    need(build.schema==='tjlabs.tiptap-browser-build.v1'&&build.runtimeSelectionSha256===selected.selectionSha256&&build.lockfileSha256===selected.lockfile.sha256,'PREPARE_BROWSER_BINDING','The original browser build differs from the selected native runtime.');
    for(const file of [...build.inputs,build.output]){
      need(typeof file.path==='string'&&file.path&&!isAbsolute(file.path)&&!file.path.split(/[\\/]/).includes('..'),'PREPARE_BROWSER_PATH','Use the selected original browser member.');
      await verify({path:join(bound.applicationDirectory,file.path),bytes:file.bytes,sha256:file.sha256});
    }
    return{runtime:observed,runtimeSelectionSha256:selected.selectionSha256,buildManifest:await identity(buildPath)};
  }
  async complete(){
    const resultPath=join(this.control,'PREPARED.json'),candidatePath=join(this.control,'CANDIDATE.json');
    if(await present(resultPath)||await present(candidatePath)){
      const result=await json(await present(candidatePath)?candidatePath:resultPath);
      need(result.schema===SCHEMA&&result.status==='READY'&&equal(result.request,this.request),'PREPARE_RESULT_SELECTION','The completed preparation belongs to another exact request.');
      for(const name of ['primary','receiving'])if(result[name])await this.verifyBound(name,result[name]);
      await verify(result.archive);
      await immutable(resultPath,result);return result;
    }
    let primary=null,receiving,archive;
    if(this.request.mode==='prepare'){
      const prepared=await this.runtime('prepare','primary-prepare',{application:WORKBENCH_ROOT,manifest:join(PRODUCT,'original-source.json'),directory:join(this.root,'prepared-runtime'),
        npm:this.request.npm,hocuspocusArchive:this.request.hocuspocusArchive?.path,tiptapArchive:this.request.tiptapArchive?.path});
      need(prepared.status==='READY','PREPARE_RUNTIME','Complete the original prepared runtime.');
      // All receipts stay outside the inventoried application. Its original
      // installer only adopts the full READY runtime and performs no second npm.
      primary=await this.bind('primary',await this.inspectRuntime('primary-inspection',prepared.directory));
      const output=join(this.root,'collaborative-documents-runtime.tar.gz');
      const exported=await this.runtime('export','primary-export',{directory:prepared.directory,output});
      need(exported.schema==='hocuspocus.runtime.archive.v1'&&exported.path===output,'PREPARE_ARCHIVE','Retain the original complete runtime export.');
      archive=await identity(output);need(archive.sha256===exported.sha256&&archive.bytes===exported.bytes,'PREPARE_ARCHIVE','The full exported runtime differs.');
    }else{archive=this.request.archive;await verify(archive);}
    const received=await this.runtime('receive','independent-receive',{archive:archive.path,directory:join(this.root,'received-runtime')});
    need(received.schema==='hocuspocus.runtime-receiving-result.v1'&&received.status==='READY'&&received.archive_sha256===archive.sha256,'PREPARE_RECEIVE','Complete the original independent runtime receiving.');
    receiving=await this.bind('receiving',await this.inspectRuntime('receiving-inspection',received.directory));
    if(primary)need(primary.runtimeId!==receiving.runtimeId&&primary.applicationDirectory!==receiving.applicationDirectory,'PREPARE_INDEPENDENT_RECEIVING','Use the independently received runtime identity and application.');
    const result={schema:SCHEMA,status:'READY',request:this.request,completedAt:now(),primary,receiving,archive,
      source:{manifestSha256:ORIGINAL_MANIFEST_SHA,files:50},originalRuntimeReceiving:received,
      next:{applicationDirectory:(primary??receiving).applicationDirectory,runtimeReadyFile:(primary??receiving).runtimeReadyFile}};
    await immutable(candidatePath,result);await immutable(resultPath,result);return result;
  }
}
function parse(argv){
  const mode=argv.shift();need(['prepare','receive','inspect','export'].includes(mode),'PREPARE_MODE','Select prepare, receive, inspect or export.');
  const options={mode};const flags=new Set(['directory','npm','python','hocuspocus-archive','tiptap-archive','archive','output']);
  for(let i=0;i<argv.length;i++){const key=argv[i];if(key==='--resume'){need(!options.resume,'PREPARE_OPTION','Do not repeat options.');options.resume=true;continue;}
    need(key.startsWith('--')&&flags.has(key.slice(2))&&argv[i+1]&&!argv[i+1].startsWith('--')&&!Object.hasOwn(options,key.slice(2)),'PREPARE_OPTION','Use each declared complete option once.');options[key.slice(2)]=argv[++i];}
  const allowed=mode==='prepare'?['directory','npm','python','hocuspocus-archive','tiptap-archive']:mode==='receive'?['directory','python','archive']:mode==='export'?['directory','output']:['directory'];
  need(Object.keys(options).every(k=>['mode','resume',...allowed].includes(k)),'PREPARE_OPTION','This operation does not accept that option.');
  need(options.directory,'PREPARE_DIRECTORY','Select the original preparation directory.');
  if(mode==='prepare')need(options.npm,'PREPARE_NPM','Select the actual original npm executable.');
  if(mode==='receive')need(options.archive,'PREPARE_ARCHIVE','Select the complete original archive.');
  if(mode==='export')need(options.output,'PREPARE_ARCHIVE','Select the full output archive path.');
  return options;
}
export async function prepareCollaborativeDocuments(options){
  need(/^v24\./.test(process.version),'PREPARE_NODE','Run this command with the original selected Node24 executable.');
  await inspectOriginalSource();
  const root=await privateRoot(options.directory),fd=await lock(root);
  try{
    const path=join(root,'.runtime','REQUEST.json'),node={executable:await realpath(process.execPath),version:process.version,abi:process.versions.modules,platform:process.platform,architecture:process.arch};
    if(['inspect','export'].includes(options.mode)){
      need(await present(path),'PREPARE_REQUEST','The original preparation request is absent.');
      const request=await json(path);need(equal(request.node,node)&&request.sourceManifestSha256===ORIGINAL_MANIFEST_SHA,'PREPARE_HOST','Reopen with the same actual host runtime and original source.');
      const course=new Preparation(root,fd,request),resultPath=join(root,'.runtime','PREPARED.json');
      need(await present(resultPath),'PREPARE_INCOMPLETE','Resume the same original preparation before inspection/export.');
      const result=await json(resultPath);need(equal(result.request,request),'PREPARE_RESULT_SELECTION','The complete original result selects another request.');
      for(const name of ['primary','receiving'])if(result[name])await course.verifyBound(name,result[name]);await verify(result.archive);
      if(options.mode==='inspect')return{schema:SCHEMA,status:'READY',result,verifiedAt:now()};
      const output=resolve(options.output);need(isAbsolute(options.output)&&!inside(root,output),'PREPARE_EXPORT_PATH','Select an absolute archive outside the existing preparation root.');
      return course.runtime('export','export-'+sha(output).slice(0,32),{directory:(result.primary??result.receiving).runtimeDirectory,output},{reuse:false});
    }
    need(['prepare','receive'].includes(options.mode),'PREPARE_MODE','Select an original preparation operation.');
    const request={schema:SCHEMA,mode:options.mode,directory:root,sourceManifestSha256:ORIGINAL_MANIFEST_SHA,node,
      python:await executable(options.python,process.env.CODEX_PRIMARY_RUNTIME_PYTHON??'python3'),
      ...(options.mode==='prepare'?{npm:await executable(options.npm,'npm'),
        hocuspocusArchive:options['hocuspocus-archive']?await identity(options['hocuspocus-archive']):null,
        tiptapArchive:options['tiptap-archive']?await identity(options['tiptap-archive']):null}:{archive:await identity(options.archive)})};
    if(await present(path)){need(equal(await json(path),request),'PREPARE_REQUEST_CHANGED','Resume the exact original request, paths, inputs and selected runtime.');
      need(options.resume||await present(join(root,'.runtime','PREPARED.json')),'RESUME_REQUIRED','Continue the original incomplete preparation with --resume.');}
    await immutable(path,request);
    const course=new Preparation(root,fd,request);return await course.complete();
  }finally{await fd.close();}
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.includes('--help')){const value={command:'collaborative-documents-prepare',operations:['prepare','receive','inspect','export'],
    prepare:'prepare --directory ABS_PRIVATE --npm ABS_NPM [--python ABS_PYTHON] [--hocuspocus-archive ABS --tiptap-archive ABS] [--resume]',
    receive:'receive --directory ABS_PRIVATE --archive ABS_COMPLETE_RUNTIME [--python ABS_PYTHON] [--resume]',
    inspect:'inspect --directory ABS_PRIVATE',export:'export --directory ABS_PRIVATE --output ABS_OUTSIDE_ARCHIVE'};process.stdout.write(JSON.stringify(value,null,2)+'\n');return value;}
  const result=await prepareCollaborativeDocuments(parse([...argv]));process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)main().catch(error=>{process.stderr.write(JSON.stringify({error:{code:error.code??'PREPARATION_FAILED',message:error.message,details:error.details??{}}})+'\n');process.exitCode=1;});
