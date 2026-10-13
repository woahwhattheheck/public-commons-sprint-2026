import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';

export class Hdf5Process {
  constructor({directory, python='python3', create=true}) {
    this.pending=new Map();this.buffer=Buffer.alloc(0);this.closed=false;this.closing=null;this.failure=null;
    this.child=spawn(python,['-B',fileURLToPath(new URL('./cli.py',import.meta.url)),'--workspace',directory,...(create?['--create']:[]),'--stdio'],
      {stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    this.stderr='';this.child.stderr.on('data',chunk=>{this.stderr=(this.stderr+chunk.toString()).slice(-8192);});
    this.ready=new Promise((resolve,reject)=>{this.readyResolve=resolve;this.readyReject=reject;});
    this.timer=setTimeout(()=>this.fail(Object.assign(new Error('The selected Python process did not open its original workspace in time.'),{code:'HDF5_START_TIMEOUT'})),30000);
    this.child.on('error',error=>this.fail(error));
    for(const stream of [this.child.stdin,this.child.stdout,this.child.stderr])stream.on('error',error=>this.fail(error));
    this.child.stdout.on('data',chunk=>this.receive(chunk));
    this.completion=new Promise(resolve=>this.child.once('close',(code,signal)=>{
      this.closed=true;clearTimeout(this.timer);
      const error=Object.assign(new Error('The original HDF5 process closed; reopen and inspect its retained operation. '+this.stderr),
        {code:'HDF5_PROCESS_CLOSED',exitCode:code,signal});
      this.readyReject(error);for(const pending of this.pending.values())pending.reject(error);this.pending.clear();resolve({code,signal});
    }));
    // A rejected startup is also observed by normal close; do not leave an unhandled promise.
    void this.ready.catch(()=>{});
  }
  fail(error) {
    this.failure??=error;error=this.failure;
    clearTimeout(this.timer);this.readyReject(error);
    for(const pending of this.pending.values())pending.reject(error);this.pending.clear();
    if(!this.closed)this.child.kill('SIGTERM');
  }
  receive(chunk) {
    this.buffer=Buffer.concat([this.buffer,chunk]);
    if(this.buffer.length>17*1024*1024){this.fail(new Error('HDF5 process response exceeded its documented limit.'));return;}
    let offset;
    while((offset=this.buffer.indexOf(10))>=0) {
      const line=this.buffer.subarray(0,offset);this.buffer=this.buffer.subarray(offset+1);
      let response;
      try{response=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(line));}
      catch(error){this.fail(error);return;}
      if(response.ready){
        if(response.ready.schema!=='stellar-forge.hdf5-process.v1'){this.fail(new Error('Unsupported HDF5 process.'));return;}
        clearTimeout(this.timer);this.readyResolve(response.ready);continue;
      }
      const pending=this.pending.get(response.id);
      if(!pending){this.fail(new Error('HDF5 process returned an unknown request identity.'));return;}
      this.pending.delete(response.id);
      if(response.error)pending.reject(Object.assign(new Error(response.error.message),response.error));
      else pending.resolve(response.result);
    }
  }
  async call(action,payload={}) {
    await this.ready;
    if(this.failure)throw this.failure;
    if(this.closed||this.closing)throw Object.assign(new Error('The original workspace is closing.'),{code:'HDF5_CLOSING',status:409});
    const control=['operation.get','operation.cancel','status'].includes(action);
    if(this.pending.size>=4||!control&&[...this.pending.values()].filter(item=>!item.control).length>=3)throw Object.assign(new Error('The original workspace has four accepted requests; wait or cancel a selected operation.'),{code:'HDF5_BUSY',status:409});
    const id=randomUUID(),bytes=Buffer.from(JSON.stringify({id,action,payload})+'\n');
    if(bytes.length>1024*1024)throw Object.assign(new Error('Request exceeds 1 MiB.'),{status:413});
    const response=new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject,control}));
    this.child.stdin.write(bytes,error=>{if(error){const entry=this.pending.get(id);this.pending.delete(id);entry?.reject(error);}});
    return response;
  }
  close() {
    return this.closing??=(async()=>{
      clearTimeout(this.timer);let timer,force,requestedSignal=null,outcome;
      if(!this.closed){
        this.child.stdin.end();
        timer=setTimeout(()=>{requestedSignal='SIGTERM';this.child.kill('SIGTERM');},125000);timer.unref();
        force=setTimeout(()=>{requestedSignal='SIGKILL';this.child.kill('SIGKILL');},135000);force.unref();
      }
      try{outcome=await this.completion;}finally{clearTimeout(timer);clearTimeout(force);}
      if(this.failure)throw this.failure;
      if(outcome.code!==0||outcome.signal||requestedSignal)
        throw Object.assign(new Error('The original Python process was reaped with an interrupted shutdown; inspect its retained operations.'),
          {code:'HDF5_SHUTDOWN_INTERRUPTED',exitCode:outcome.code,signal:outcome.signal,requestedSignal});
      return outcome;
    })();
  }
}
