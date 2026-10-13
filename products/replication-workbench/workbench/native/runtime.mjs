import { spawn } from 'node:child_process';
import { existsSync,mkdirSync,readFileSync,readdirSync,lstatSync,copyFileSync,openSync,closeSync,writeFileSync,fsyncSync,realpathSync,renameSync,unlinkSync } from 'node:fs';
import { join,resolve,dirname } from 'node:path';
import { ObjectStore,hashFile } from '../core/objects.mjs';
import { atomicBytes,atomicJson,identity,sha,clone,id,requireValue,safeRelative,now,privateDirectory,fsyncDirectory } from '../core/common.mjs';

function walk(root){
  const rows=[];const visit=(dir,prefix='')=>{for(const entry of readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
    if(entry.name==='lifetime.lock'||entry.name.startsWith('.observer')||entry.name.includes('.pending-'))continue;
    const rel=prefix?prefix+'/'+entry.name:entry.name,path=join(dir,entry.name);
    requireValue(!entry.isSymbolicLink(),'NATIVE_SYMLINK','Native receiving cannot include a symbolic link.',409,{path:rel});
    if(entry.isDirectory())visit(path,rel);else if(entry.isFile())rows.push({path:rel,...hashFile(path)});
  }};visit(root);return rows;
}
async function jsonCommand(python,args,{cwd}={}){
  return await new Promise((yes,no)=>{
    const child=spawn(python,args,{cwd,stdio:['ignore','pipe','pipe']});let output='',error='';
    child.stdout.on('data',b=>{output+=b; if(output.length>32*1024*1024)child.kill();});child.stderr.on('data',b=>{error=(error+b).slice(-10000);});
    child.once('error',no);child.once('exit',code=>{try{requireValue(code===0,'NATIVE_INSPECTION_FAILED','The original native state could not be observed.',503,{exitCode:code,stderr:error});yes(JSON.parse(output));}catch(e){no(e);}});
  });
}
export function readRuntime(path){
  if(!path)return null;const ready=JSON.parse(readFileSync(path,'utf8'));
  requireValue(ready.schema==='tjlabs.sling-runtime-ready.v1'&&ready.state==='ready'&&ready.version==='1.6.5'&&ready.sourceCommit==='7641892e24a7023c8012069596698970c7b3e041','RUNTIME_SELECTION','Select the exact installed original Sling1.6.5 receipt.',409);
  for(const key of ['executable','archive']){const value=ready[key];requireValue(value&&typeof value.path==='string','RUNTIME_SELECTION','The complete original archive/executable selection is required.',409);const actual=hashFile(value.path);requireValue(actual.sha256===value.sha256&&actual.bytes===value.bytes,'RUNTIME_IDENTITY','The original selected Sling runtime bytes changed.',409);}
  requireValue(ready.archive.sha256==='e4e386c7d4429b33a213c146594be0bf6efa38f4732035dd67e307616fcb9c66'&&ready.archive.bytes===121317497,'RUNTIME_ARCHIVE','Original release archive differs.',409);
  return ready;
}
export class NativeRuntime {
  constructor(workspace,{runtimeReadyFile,python='python3'}={}){
    this.workspace=workspace;this.store=workspace.store;this.sourceRoot=workspace.sourceRoot;this.python=python;
    this.ready=readRuntime(runtimeReadyFile);this.children=new Map();this.launches=new Map();this.reading=new Map();
    this.worker=join(this.sourceRoot,'native/worker.py');
  }
  publicSelection(){
    if(!this.ready)return{available:false};
    const r=this.ready;return{available:true,version:r.version,sourceCommit:r.sourceCommit,platform:r.platform,machine:r.machine,executable:{sha256:r.executable.sha256,bytes:r.executable.bytes},archive:{sha256:r.archive.sha256,bytes:r.archive.bytes},readyAt:r.readyAt};
  }
  retainSelection(){
    requireValue(this.ready,'RUNTIME_REQUIRED','Install and select the original Sling engine before preparing a native run.',409);
    const archive=this.store.objects.putFile(this.ready.archive.path,this.ready.archive);
    return{...this.publicSelection(),archive,versionObservation:{...this.ready.versionObservation,argv:['sling','--version']}};
  }
  async inspectBinding(binding){
    if(!binding?.restored||!existsSync(binding.directory))return{busy:false,state:null,unrestored:true};
    return jsonCommand(this.python,[this.worker,'inspect','--directory',binding.directory],{cwd:this.sourceRoot});
  }
  async owned(projectId){
    if(this.launches.has(projectId))return true;
    for(const b of this.store.bindings(projectId)){
      if(b.suspended)continue;
      if(this.children.has(b.jobId))return true;
      const result=await this.inspectBinding(b);if(result.busy)return true;
    }
    return false;
  }
  async drainReads(projectId){await Promise.allSettled([...this.reading.values()].filter(x=>x.projectId===projectId).map(x=>x.promise));}
  ensureBinding(job){
    let binding=this.store.binding(job.id);
    if(binding&&!binding.suspended)return binding;
    const generation='binding_'+identity({instanceId:this.store.instanceId,jobId:job.id,snapshot:job.nativeSnapshotSha256??null}).slice(0,32);
    const directory=join(this.store.directory,'native',job.id,generation);
    binding={id:generation,directory,projectId:job.projectId,jobId:job.id,snapshot:job.nativeSnapshotSha256??null,restored:false,suspended:false,createdAt:now()};
    this.store.setBinding(job.projectId,job.id,binding);return binding;
  }
  async prepare(job){
    const binding=this.ensureBinding(job);if(binding.restored)return binding;
    privateDirectory(binding.directory);
    const before=await jsonCommand(this.python,[this.worker,'inspect','--directory',binding.directory],{cwd:this.sourceRoot});
    requireValue(!before.busy,'NATIVE_PREPARATION_OWNED','The original native owner must close before preparing its working copies.',423);
    requireValue(job.files?.length||!before.state?.attempts?.length,'NATIVE_PREPARATION_STATE','A native attempt exists in an unprepared binding. Preserve its original data and reconcile that binding before continuing.',409);
    const copyInitial=(source,target,expected)=>{
      const actual=hashFile(source);requireValue(actual.sha256===expected.sha256&&actual.bytes===expected.bytes,'INPUT_IDENTITY','The retained original initial copy source differs.',409);
      if(existsSync(target)){const present=hashFile(target);if(present.sha256===expected.sha256&&present.bytes===expected.bytes)return;}
      mkdirSync(dirname(target),{recursive:true,mode:0o700});
      const temp=target+'.pending-initial-copy';
      try{copyFileSync(source,temp);const copied=hashFile(temp);requireValue(copied.sha256===expected.sha256&&copied.bytes===expected.bytes,'INPUT_COPY','The initial native copy did not retain every original byte.',409);
        const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);fsyncDirectory(dirname(target));
      }finally{try{unlinkSync(temp);}catch(error){if(error.code!=='ENOENT')throw error;}}
    };
    if(job.files?.length){
      for(const file of job.files){const target=join(binding.directory,safeRelative(file.path));copyInitial(this.store.objects.path(file.sha256),target,file);}
    }else{
      const selection=JSON.parse(this.store.objects.read(job.selection.sha256,job.selection.bytes));
      atomicBytes(join(binding.directory,'selection.json'),this.store.objects.read(job.selection.sha256,job.selection.bytes),{immutable:true});
      atomicBytes(join(binding.directory,'replication.json'),this.store.objects.read(job.replication.sha256,job.replication.bytes),{immutable:true});
      for(const file of selection.inputs)copyInitial(this.store.objects.path(file.sha256),join(binding.directory,safeRelative(file.path)),file);
      for(const name of ['source','target']){
        const original=selection.inputs.find(file=>file.path==='inputs/'+name+'.sqlite');
        if(original)copyInitial(this.store.objects.path(original.sha256),join(binding.directory,'data',name+'.sqlite'),original);
      }
    }
    for(const row of walk(binding.directory)){const path=join(binding.directory,row.path),fd=openSync(path,'r');try{fsyncSync(fd);}finally{closeSync(fd);}fsyncDirectory(dirname(path));}
    fsyncDirectory(binding.directory);
    binding.restored=true;this.store.setBinding(job.projectId,job.id,binding);return binding;
  }
  writeControls(job,binding){
    for(const c of job.controls??[]){
      const relative=c.kind==='cancel'?'control/cancel.json':'control/decisions/'+c.id+'.json';
      atomicJson(join(binding.directory,relative),c,{immutable:c.kind!=='cancel'});
    }
  }
  launch(job,{resume=false}={}){
    const projectId=job.projectId;if(this.launches.has(projectId))return this.launches.get(projectId);
    const pending=(async()=>{
      requireValue(this.ready,'RUNTIME_REQUIRED','Select the original Sling runtime before this same job is started.',409);
      requireValue(!this.workspace.receiving.has(projectId),'RECEIVING_BUSY','This project is receiving a retained edition.',423);
      const expected=job.runtime.executable;
      requireValue(this.ready.executable.sha256===expected.sha256&&this.ready.executable.bytes===expected.bytes,'RUNTIME_REBIND_REQUIRED','The selected original executable differs from this job.',409);
      const binding=await this.prepare(job);const before=await this.inspectBinding(binding);
      requireValue(!this.workspace.receiving.has(projectId)&&this.store.binding(job.id)?.id===binding.id,'RECEIVING_CHANGED','The local native binding changed before launch.',423);
      this.writeControls(job,binding);if(before.busy||this.children.has(job.id))return{busy:true,bindingId:binding.id};
      if(before.state?.status==='complete')return{busy:false,bindingId:binding.id,complete:true};
      requireValue(resume||!before.state?.attempts?.length,'RESUME_REQUIRED','Continue the retained original job explicitly.',409);
      const args=[this.worker,'run','--directory',binding.directory,'--executable',this.ready.executable.path];if(resume)args.push('--resume');
      const output=openSync(join(binding.directory,'.observer.stdout'),'a',0o600),error=openSync(join(binding.directory,'.observer.stderr'),'a',0o600);
      let child;
      try{child=spawn(this.python,args,{cwd:this.sourceRoot,stdio:['ignore',output,error],detached:true});}finally{closeSync(output);closeSync(error);}
      this.children.set(job.id,child);binding.launch={pid:child.pid??null,requestedAt:now(),resume};this.store.setBinding(projectId,job.id,binding);
      child.once('error',()=>{this.children.delete(job.id);});child.once('exit',()=>{this.children.delete(job.id);});child.unref();
      await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no);});
      return{busy:true,bindingId:binding.id,pid:child.pid};
    })();this.launches.set(projectId,pending);return pending.finally(()=>{if(this.launches.get(projectId)===pending)this.launches.delete(projectId);});
  }
  inspect(job){
    const old=this.reading.get(job.id);if(old)return old.promise;
    const binding=this.store.binding(job.id),observedBinding=binding?.id??null;
    const pending=(async()=>{
      if(!binding||binding.suspended)return{jobId:job.id,bindingId:observedBinding,received:true,busy:false,state:null};
      const report=await this.inspectBinding(binding);if(report.busy||this.children.has(job.id))return{jobId:job.id,bindingId:observedBinding,busy:true,state:report.state};
      if(!report.state)return{jobId:job.id,bindingId:observedBinding,busy:false,state:null};
      const selected=walk(binding.directory),files=[];
      for(const row of selected){const object=this.store.objects.putFile(join(binding.directory,row.path),row);files.push({path:row.path,...object});}
      const after=await this.inspectBinding(binding);requireValue(!after.busy&&identity(after.state)===identity(report.state),'NATIVE_OBSERVATION_CHANGED','The original native state changed during closed retention.',423);
      const verify=walk(binding.directory);requireValue(identity(verify)===identity(selected),'NATIVE_OBSERVATION_CHANGED','Original native files changed during retention.',423);
      return{jobId:job.id,bindingId:observedBinding,busy:false,state:report.state,files,nativeSnapshotSha256:identity({state:report.state,files})};
    })();this.reading.set(job.id,{projectId:job.projectId,promise:pending});
    return pending.finally(()=>{if(this.reading.get(job.id)?.promise===pending)this.reading.delete(job.id);});
  }
}
