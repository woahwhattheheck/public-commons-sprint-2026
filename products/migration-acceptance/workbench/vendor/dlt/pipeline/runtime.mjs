import {spawn} from 'node:child_process';
import {openSync,closeSync,readFileSync,existsSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {NativeRuntime} from '../vendor/sling/native/runtime.mjs';
import {hashFile} from '../vendor/sling/core/objects.mjs';
import {canonical,now,requireValue} from '../vendor/sling/core/common.mjs';
export function readRuntimeReady(path){
  if(!path)return null;const value=JSON.parse(readFileSync(path,'utf8'));
  requireValue(value.schema==='dlt-workshare.runtime-ready.v1'&&value.state==='ready'&&value.version==='1.31.0'&&value.sourceCommit==='2360d229c77f7f64692acc31a4555f4cfcd50ed3','RUNTIME_SELECTION','Select the exact original dlt 1.31.0 installed receipt.',409);
  requireValue(typeof value.runtimeId==='string'&&value.python?.executable&&existsSync(value.python.executable)&&value.duckdb?.version,'RUNTIME_SELECTION','The actual selected interpreter/runtime receipt is incomplete.',409);
  if(value.portable){const actual=hashFile(value.portable.path);requireValue(actual.sha256===value.portable.sha256&&actual.bytes===value.portable.bytes,'RUNTIME_ARCHIVE','The complete installed runtime receiving source differs.',409);}
  return value;
}
export class DltRuntime extends NativeRuntime{
  constructor(workspace,options={}){
    super(workspace,{...options,runtimeReadyFile:undefined});
    this.readyFile=options.runtimeReadyFile?resolve(options.runtimeReadyFile):null;this.ready=readRuntimeReady(this.readyFile);
    if(this.ready)this.python=this.ready.python.executable;this.worker=join(this.sourceRoot,'pipeline/worker.py');
  }
  async inspectBinding(binding){
    const report=await super.inspectBinding(binding);
    if(!report.busy&&!report.state&&binding?.restored){
      const path=join(binding.directory,'runtime-run.json');
      if(existsSync(path)){
        const run=JSON.parse(readFileSync(path,'utf8'));
        requireValue(run.schema==='dlt-workshare.runtime-run-record.v1','RUNTIME_RUN_RECEIPT','The original pre-worker runtime receipt differs.',409);
        return{...report,state:{schema:'dlthub.native-journal.v1',status:'interrupted',attempts:[],steps:{},runtimeRun:run,error:{type:'RuntimePreparationInterrupted',message:'The original runtime wrapper ended before publishing a native worker journal. Review its exact receipt and explicitly resume this job.'}}};
      }
    }return report;
  }
  publicSelection(){if(!this.ready)return{available:false};const r=this.ready;return{available:true,adapter:'dlthub.native-pipeline.v1',runtimeId:r.runtimeId,version:r.version,sourceCommit:r.sourceCommit,pythonVersion:r.python.version,duckdb:r.duckdb,worker:hashFile(this.worker),identitySha256:r.identitySha256,installedManifestSha256:r.installedManifestSha256};}
  retainSelection(){
    requireValue(this.ready?.portable,'RUNTIME_REQUIRED','Install, verify and pack the complete original locked dlt runtime before preparing native jobs.',409);const selected=this.publicSelection();
    if(this.ready.portable)selected.archive=this.store.objects.putFile(this.ready.portable.path,this.ready.portable);
    return selected;
  }
  launch(job,{resume=false}={}){
    const projectId=job.projectId;if(this.launches.has(projectId))return this.launches.get(projectId);
    const pending=(async()=>{
      requireValue(this.ready&&this.ready.runtimeId===job.runtime.runtimeId,'RUNTIME_REBIND_REQUIRED','Receive and select this original job’s exact runtime before continuing.',409);
      readRuntimeReady(this.readyFile);requireValue(!this.workspace.receiving.has(projectId),'RECEIVING_BUSY','This project is receiving an original edition.',423);
      const actual=hashFile(this.worker);requireValue(actual.sha256===job.runtime.worker.sha256&&actual.bytes===job.runtime.worker.bytes,'WORKER_SELECTION','Use this job’s original complete native adapter.',409);
      const binding=await this.prepare(job),before=await this.inspectBinding(binding);
      requireValue(!this.workspace.receiving.has(projectId)&&this.store.binding(job.id)?.id===binding.id,'RECEIVING_CHANGED','Original native custody changed before launch.',423);
      this.writeControls(job,binding);if(before.busy||this.children.has(job.id))return{busy:true,bindingId:binding.id};
      if(before.state?.status==='complete')return{busy:false,bindingId:binding.id,complete:true};
      requireValue(resume||(!before.state?.attempts?.length&&!before.state?.runtimeRun),'RESUME_REQUIRED','Continue the original ended operation explicitly.',409);
      const workerArgs=[this.python,this.worker,'run','--directory',binding.directory,'--runtime-ready',this.readyFile];if(resume)workerArgs.push('--resume');
      const args=[join(this.sourceRoot,'runtime/runtime.mjs'),'run','--directory',dirname(this.readyFile),'--cwd',this.sourceRoot,'--argv-json',JSON.stringify(workerArgs),'--operation-lock',join(binding.directory,'lifetime.lock')];
      const output=openSync(join(binding.directory,'.observer.stdout'),'a',0o600),error=openSync(join(binding.directory,'.observer.stderr'),'a',0o600);let child;
      try{child=spawn(process.execPath,args,{cwd:this.sourceRoot,stdio:['ignore',output,error],detached:true,env:{...process.env,DLT_TELEMETRY:'false',RUNTIME__DLTHUB_TELEMETRY:'false'}});}finally{closeSync(output);closeSync(error);}
      this.children.set(job.id,child);binding.launch={pid:child.pid??null,requestedAt:now(),resume};this.store.setBinding(projectId,job.id,binding);
      child.once('error',()=>this.children.delete(job.id));child.once('exit',()=>this.children.delete(job.id));child.unref();
      await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no);});return{busy:true,bindingId:binding.id,pid:child.pid};
    })();this.launches.set(projectId,pending);return pending.finally(()=>{if(this.launches.get(projectId)===pending)this.launches.delete(projectId);});
  }
}
