// Run the original builder, installer and complete Applications receiving on one pinned source.
import { mkdir, readFile, writeFile, rename, lstat, realpath } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';

const exec = promisify(execFile), hash = x => createHash('sha256').update(x).digest('hex');
const args = process.argv.slice(2), selected = {};
for(let i=0;i<args.length;i+=2) {
 if(!['--selection','--work','--output'].includes(args[i]) || !args[i+1] ||
    Object.hasOwn(selected,args[i].slice(2))) throw new Error('Use --selection FILE --work DIRECTORY --output DIRECTORY');
 selected[args[i].slice(2)] = args[i+1];
}
if(!selected.selection || !selected.work || !selected.output)
 throw new Error('Use --selection FILE --work DIRECTORY --output DIRECTORY');
const inputPath=resolve(selected.selection), work=resolve(selected.work), output=resolve(selected.output);
const inputBytes=await readFile(inputPath), input=JSON.parse(inputBytes);
const B='stellar/scf-starforge-20261009/';
const need=(value,code)=>{if(!value)throw Object.assign(new Error(code),{code})};
need(/^[a-f0-9]{40}$/.test(input.sourceCommit),'SOURCE_COMMIT_REQUIRED');
await mkdir(work,{recursive:true,mode:0o700});await mkdir(output,{recursive:true,mode:0o700});
const savedPath=join(work,'installed-receiving-checkpoint.json');
const exists=async p=>lstat(p).catch(e=>{if(e.code==='ENOENT')return null;throw e});
const save=async(p,v)=>{const t=p+'.'+randomUUID()+'.next';await writeFile(t,JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});await rename(t,p)};
let state=await exists(savedPath)?JSON.parse(await readFile(savedPath,'utf8')):{
 schema:'stellar-forge.coingecko-installed-receiving.v1',inputSha256:hash(inputBytes),stages:{}
};
need(state.inputSha256===hash(inputBytes),'ORIGINAL_INSTALLED_SELECTION_CHANGED');
const persist=()=>save(savedPath,state),say=v=>process.stdout.write(JSON.stringify({at:new Date().toISOString(),...v})+'\n');
await persist();
const gitRoot=join(work,'source.git'), tooling=join(work,'tooling');
const git=async argv=>exec('git',['--git-dir',gitRoot,...argv],{
 maxBuffer:32*1024*1024,timeout:300000,env:{...process.env,GIT_TERMINAL_PROMPT:'0'}
});
if(!state.stages.git){
 if(!await exists(join(gitRoot,'HEAD'))){
  await exec('git',['init','--bare',gitRoot],{maxBuffer:1048576});
  if(input.gitObjectDirectory) {
   const alternate=await realpath(input.gitObjectDirectory);
   await writeFile(join(gitRoot,'objects/info/alternates'),alternate+'\n',{mode:0o600,flag:'wx'});
  }
  await git(['config','remote.origin.url','https://github.com/woahwhattheheck/public-commons-sprint-2026.git']);
  await git(['config','remote.origin.promisor','true']);
  await git(['config','remote.origin.partialclonefilter','blob:none']);
 }
 await git(['fetch','--depth=1','--no-tags','--no-write-fetch-head','--no-auto-maintenance',
  '--recurse-submodules=no','--filter=blob:none','origin',input.sourceCommit]);
 const actual=(await git(['rev-parse',input.sourceCommit+'^{commit}'])).stdout.trim();
 need(actual===input.sourceCommit,'GIT_SOURCE_COMMIT_CHANGED');
 state.stages.git={commit:actual};await persist();say({stage:'original-git-source',commit:actual});
}
if(!state.stages.tooling){
 await mkdir(tooling,{recursive:true,mode:0o700});
 const extractor=String.raw`
import tarfile,sys,pathlib,os
root=pathlib.Path(sys.argv[1]).resolve()
count=0
with tarfile.open(fileobj=sys.stdin.buffer,mode='r|') as archive:
 for member in archive:
  name=pathlib.PurePosixPath(member.name)
  if name.is_absolute() or '..' in name.parts:raise RuntimeError('Invalid Git source path')
  target=root.joinpath(*name.parts)
  if member.isdir():target.mkdir(parents=True,exist_ok=True,mode=0o700);continue
  if not member.isfile():raise RuntimeError('Unexpected Git source member')
  target.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
  source=archive.extractfile(member);temporary=target.with_name(target.name+'.source-next')
  with temporary.open('wb') as output:
   while True:
    chunk=source.read(1048576)
    if not chunk:break
    output.write(chunk)
  os.chmod(temporary,0o755 if member.mode&0o111 else 0o644);os.replace(temporary,target);count+=1
print(count)
`;
 const source=spawn('git',['--git-dir',gitRoot,'archive','--format=tar',input.sourceCommit,B+'distribution'],{
  stdio:['ignore','pipe','pipe'],env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
 const unpack=spawn('python',['-B','-c',extractor,tooling],{stdio:['pipe','pipe','pipe']});
 let sourceError='',unpackError='',count='';
 source.stderr.on('data',b=>sourceError+=b);unpack.stderr.on('data',b=>unpackError+=b);unpack.stdout.on('data',b=>count+=b);
 const sourceDone=new Promise((ok,bad)=>{source.once('error',bad);source.once('close',code=>ok(code))});
 const unpackDone=new Promise((ok,bad)=>{unpack.once('error',bad);unpack.once('close',code=>ok(code))});
 source.stdout.pipe(unpack.stdin);
 const [sourceExit,unpackExit]=await Promise.all([sourceDone,unpackDone]);
 need(sourceExit===0&&unpackExit===0,'ORIGINAL_TOOLING_EXTRACTION_FAILED: '+sourceError+unpackError);
 state.stages.tooling={files:Number(count.trim())};await persist();say({stage:'original-build-tooling',...state.stages.tooling});
}
const moduleAt=p=>import(pathToFileURL(join(tooling,B+'distribution',p)).href);
if(!state.build){
 const {buildDistribution}=await moduleAt('build.mjs');
 let previous='';
 state.build=await buildDistribution({repository:gitRoot,ref:input.sourceCommit,output:join(work,'build'),
  resume:Boolean(await exists(join(work,'build'))),offline:false,onProgress:e=>{if(e.phase!==previous){previous=e.phase;say({stage:'original-distribution',...e})}}});
 await persist();say({stage:'source-package-complete',archive:state.build.archive,bytes:state.build.archiveBytes,sha256:state.build.sha256});
}
const runtimeDirectory=join(work,'runtime'),installer=await moduleAt('runtime-install.mjs');
if(!await exists(join(runtimeDirectory,'runtime-install.json'))){
 const preparation=await exists(join(runtimeDirectory,'preparation.json'));
 need(!preparation,'ORIGINAL_RUNTIME_PREPARATION_REQUIRES_RECOVERY');
 state.preparation=await installer.prepareRuntimeInstall({directory:runtimeDirectory,
  archive:state.build.archive,sha256:state.build.sha256,native:false,features:['schema'],operator:false});
 await persist();say({stage:'original-runtime-prepared',profileId:state.preparation.profileId});
}
state.runtime=await installer.installRuntime({directory:runtimeDirectory,offline:false,
 ...(input.npmCache?{cache:input.npmCache}:{})});
need(state.runtime.status==='READY','ORIGINAL_RUNTIME_NOT_READY');await persist();
say({stage:'original-runtime-ready',directory:runtimeDirectory,sourceCommit:state.runtime.sourceCommit??input.sourceCommit});
const runtimeHome=join(work,'runtime-store');await mkdir(runtimeHome,{recursive:true,mode:0o700});
const receiving={
 schema:'stellar-forge.coingecko-applications-receiving.v1',
 sourceRoot:state.runtime.sourceRoot,runtimeDirectory,
 consoleDirectory:join(work,'console'),runtimeHome,
 workspaceDirectory:input.workspaceDirectory,projectId:input.projectId,
 receivingDirectory:join(work,'received-market'),operationPrefix:input.operationPrefix,
 originalSources:input.originalSources,actor:input.actor,
 playwrightModule:input.playwrightModule,browserExecutable:input.browserExecutable,
 ...(input.configurationFile?{configurationFile:input.configurationFile}:{})
};
const manifest=join(work,'applications-receiving.json');
if(await exists(manifest))need(JSON.stringify(JSON.parse(await readFile(manifest,'utf8')))===JSON.stringify(receiving),'ORIGINAL_APPLICATION_MANIFEST_CHANGED');
else await save(manifest,receiving);
const driver=await import(pathToFileURL(input.driver).href);
const result=await driver.receiveCoinGeckoApplication({manifest,output});
state.result={applicationId:result.applicationId,projectId:result.projectId,completedAt:result.completedAt};
await persist();say({complete:true,...state.result});
