// MIT. Borrow the original managed HTTP owner; never construct another scientific store.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {MeasurementClient,readMeasurementConfiguration,need,MAX_RESPONSE} from '../../products/measurement-workspace/client.mjs';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {validateArguments} from './catalog/measurement-workspace.mjs';
export {readMeasurementConfiguration};
export class MerchantMeasurementWorkspaces {
 #config;#client;#reads;#active=new Set();#closing=false;#close;
 constructor(config){this.#config=config.measurementWorkspaces;need(this.#config,'Attach the original Measurements connection configuration.');this.#client=new MeasurementClient(this.#config);this.#reads=new RetainedFileReads({errorPrefix:'MEASUREMENT',maxImmutableFileBytes:MAX_RESPONSE});}
 get summary(){return {configured:true,workspaces:this.#client.configuration().workspaces,fileReads:this.#reads.summary};}
 async call(name,args={}){
  validateArguments(name,args);need(!this.#closing,'Measurements adapter is closing.');
  let done;const active=new Promise(r=>{done=r;});this.#active.add(active);
  try{
   if(name==='merchant_measurement_workspaces')return this.#client.configuration();
   const row=this.#config.workspaces[args.workspace];
   need(row&&args.instanceId===row.connection.instanceId,'Select the exact configured Measurements instance.');
   const scope='measurement:'+args.workspace+':'+args.instanceId;
   switch(name){
    case 'merchant_measurement_input_inspect':return await this.#client.inspectInput(args.workspace,args.input);
    case 'merchant_measurement_read':return await this.#client.read(args.workspace,args);
    case 'merchant_measurement_execute':return await this.#client.execute(args.workspace,args);
    case 'merchant_measurement_request':return await this.#client.status(args.workspace,args.requestId);
    case 'merchant_measurement_file_info':{const {path,directory,...info}=await this.#client.file(args.workspace,args);return info;}
    case 'merchant_measurement_file_read':{
     const descriptor=await this.#client.file(args.workspace,args);need(descriptor.sha256===args.expectedSha256,'Original selected file hash differs.');
     return await this.#reads.read({scope,key:args.requestId+':'+args.part+':'+(args.attempt||''),kind:'measurement-native-response',
      expectedSha256:args.expectedSha256,readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
      load:async()=>({readonlyFileHandle:await open(descriptor.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK),bytes:descriptor.bytes,sha256:descriptor.sha256,name:descriptor.name,type:descriptor.type})});
    }
    case 'merchant_measurement_file_release':return await this.#reads.release(scope,args.readId);
    default:throw Object.assign(new Error('Measurements tool not found.'),{code:'TOOL_NOT_FOUND'});
   }
  }finally{this.#active.delete(active);done();}
 }
 close(){if(this.#close)return this.#close;this.#closing=true;return this.#close=(async()=>{await Promise.allSettled([...this.#active]);await this.#client.close();await this.#reads.close();})().catch(error=>{this.#close=null;throw error;});}
}
