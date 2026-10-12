/**
 * Maintained Node customer surface for the original groundwater Python workspace.
 * It forwards original requests; it never creates a second model or run journal.
 */
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const program=fileURLToPath(new URL('./workspace.py',import.meta.url));
export class GroundwaterWorkspace {
  constructor({workspace,python='python3',application=program}={}) {
    if(typeof workspace!=='string'||!path.isAbsolute(workspace)) throw new TypeError('workspace must be an absolute private directory');
    this.workspace=workspace;this.python=python;this.application=application;
  }
  async call(command,args=[],request,options={}) {
    const argv=['-B',this.application,command,...(['inspect-package','receive-package','restore'].includes(command)?[]:['--workspace',this.workspace]),...args];
    const child=spawn(this.python,argv,{stdio:['pipe','pipe','pipe']});
    let stdout=[],stderr=[],bytes=0;
    const limit=64*1024*1024;
    const stop=()=>{if(child.exitCode===null)child.kill('SIGTERM');};
    options.signal?.addEventListener('abort',stop);
    if(options.signal?.aborted)stop();
    child.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>limit){stop();}else stdout.push(chunk);});
    child.stderr.on('data',chunk=>{if(Buffer.concat(stderr).length<1024*1024)stderr.push(chunk);});
    if(request!==undefined) child.stdin.end(JSON.stringify(request));else child.stdin.end();
    try {
      const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
      if(bytes>limit)throw new Error('Original groundwater response exceeds 64 MiB; read the original retained file through its export.');
      const output=Buffer.concat(stdout).toString('utf8'),error=Buffer.concat(stderr).toString('utf8');
      if(code!==0){let detail;try{detail=JSON.parse(error.trim());}catch{detail={error:{message:error||output}};}const failure=new Error(detail.error?.message||'Original groundwater command failed');failure.detail=detail;failure.exitCode=code;throw failure;}
      return JSON.parse(output.trim());
    } finally {options.signal?.removeEventListener('abort',stop);}
  }
  initialize(workspaceId,options){return this.call('init',workspaceId?['--workspace-id',workspaceId]:[],undefined,options);}
  state(projectId,options){return this.call('state',projectId?['--project',projectId]:[],undefined,options);}
  action(originalRequest,options){return this.call('action',['--request','-'],originalRequest,options);}
  operation(originalId,options){return this.call('operation',['--id',originalId],undefined,options);}
  run(originalId,options){return this.call('run',['--id',originalId],undefined,options);}
  report(originalId,options){return this.call('report',['--id',originalId],undefined,options);}
  inspectPackage(archive,options){return this.call('inspect-package',['--archive',archive],undefined,options);}
  receivePackage(archive,destination,options){return this.call('receive-package',['--archive',archive,'--destination',destination],undefined,options);}
  restore(archive,destination,options){return this.call('restore',['--archive',archive,'--destination',destination],undefined,options);}
}
export default GroundwaterWorkspace;
