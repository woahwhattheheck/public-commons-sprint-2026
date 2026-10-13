import { spawn } from 'node:child_process';
import { openSync,closeSync,readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NativeRuntime } from '../vendor/sling/native/runtime.mjs';
import { hashFile } from '../vendor/sling/core/objects.mjs';
import { identity,now,requireValue } from '../vendor/sling/core/common.mjs';

// Reuses the original binding, closed observation, received-history and kernel
// ownership implementation. Only the original-engine HTTP launch is specialized.
export class ClickHouseRuntime extends NativeRuntime {
  constructor(workspace,options={}){
    super(workspace,{...options,runtimeReadyFile:undefined});
    this.worker=join(this.sourceRoot,'commissioning/worker.py');
    this.ready={available:true,adapter:'altinity.native-http.v1',worker:hashFile(this.worker)};
  }
  publicSelection(){return{available:true,adapter:this.ready.adapter,worker:this.ready.worker,server:'Selected per approved connection; actual version/account/UUID retained by each native operation',secrets:'existing-host-environment-only'};}
  retainSelection(){return this.publicSelection();}
  launch(job,{resume=false}={}){
    const projectId=job.projectId;if(this.launches.has(projectId))return this.launches.get(projectId);
    const pending=(async()=>{
      requireValue(!this.workspace.receiving.has(projectId),'RECEIVING_BUSY','This project is receiving an original edition.',423);
      const actual=hashFile(this.worker);
      requireValue(actual.sha256===job.runtime.worker.sha256&&actual.bytes===job.runtime.worker.bytes,'ADAPTER_REBIND_REQUIRED','Use this job’s original complete native worker source.',409);
      const binding=await this.prepare(job),before=await this.inspectBinding(binding);
      requireValue(!this.workspace.receiving.has(projectId)&&this.store.binding(job.id)?.id===binding.id,'RECEIVING_CHANGED','The native binding changed before launch.',423);
      this.writeControls(job,binding);
      if(before.busy||this.children.has(job.id))return{busy:true,bindingId:binding.id};
      if(before.state?.status==='complete')return{busy:false,bindingId:binding.id,complete:true};
      requireValue(resume||!before.state?.attempts?.length,'RESUME_REQUIRED','Continue the same original native operation explicitly.',409);
      const args=['-I','-B',this.worker,'run','--directory',binding.directory];if(resume)args.push('--resume');
      const output=openSync(join(binding.directory,'.observer.stdout'),'a',0o600),error=openSync(join(binding.directory,'.observer.stderr'),'a',0o600);let child;
      try{child=spawn(this.python,args,{cwd:this.sourceRoot,stdio:['ignore',output,error],detached:true});}finally{closeSync(output);closeSync(error);}
      this.children.set(job.id,child);binding.launch={pid:child.pid??null,requestedAt:now(),resume};
      this.store.setBinding(projectId,job.id,binding);
      child.once('error',()=>this.children.delete(job.id));child.once('exit',()=>this.children.delete(job.id));child.unref();
      await new Promise((yes,no)=>{child.once('spawn',yes);child.once('error',no);});
      return{busy:true,bindingId:binding.id,pid:child.pid};
    })();this.launches.set(projectId,pending);return pending.finally(()=>{if(this.launches.get(projectId)===pending)this.launches.delete(projectId);});
  }
}
