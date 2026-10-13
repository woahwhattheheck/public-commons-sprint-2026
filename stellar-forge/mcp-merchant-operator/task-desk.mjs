// MIT. One authenticated transport owner; the original running desk owns every native command.
import {constants} from 'node:fs';
import {open,mkdtemp,unlink,rmdir,realpath,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {taskDeskTools} from './catalog/task-desk.mjs';
import {RetainedFileReads} from './retained-file-reads.mjs';
import {readTaskDeskConfiguration,connectTaskDesk,TASK_DESK_ALIAS,TASK_DESK_SHA,TASK_DESK_UUID,
  plain,exact,checked,failure,canonical} from './task-desk-connection.mjs';
export {readTaskDeskConfiguration};
const definitions=new Map(taskDeskTools((name,description,properties,required)=>({name,properties,required})).map(x=>[x.name,x]));
function validate(value,schema,label){
  if(schema.anyOf){for(const candidate of schema.anyOf){try{validate(value,candidate,label);return;}catch{}}throw failure('INVALID_PARAMS','Invalid '+label+'.');}
  if(schema.type==='object'){
    exact(value,Object.keys(schema.properties??{}),schema.required??[]);
    for(const key of Object.keys(value))validate(value[key],schema.properties[key],label+'.'+key);
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))throw failure('INVALID_PARAMS','Invalid '+label+'.');
    value.forEach((item,index)=>validate(item,schema.items,label+'['+index+']'));
  }else if(schema.type==='string'){
    if(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||
       schema.pattern&&!new RegExp(schema.pattern).test(value))throw failure('INVALID_PARAMS','Invalid '+label+'.');
  }else if(schema.type==='integer'){
    if(!Number.isSafeInteger(value)||value<(schema.minimum??-Infinity)||value>(schema.maximum??Infinity))throw failure('INVALID_PARAMS','Invalid '+label+'.');
  }else if(schema.type==='null'&&value!==null)throw failure('INVALID_PARAMS','Invalid '+label+'.');
  if(schema.enum&&!schema.enum.includes(value))throw failure('INVALID_PARAMS','Invalid '+label+'.');
}
async function privateDirectory(directory){
  const path=resolve(directory),actual=await realpath(path),s=await stat(actual);
  if(path!==actual||!s.isDirectory()||typeof process.getuid!=='function'||s.uid!==process.getuid()||(s.mode&0o077)!==0)
    throw failure('TASK_DESK_EXPORT_DIRECTORY','Use the existing owned private Merchant export directory.');
  return path;
}
/** One bounded-memory receiving, then an owned read-only descriptor with its complete digest. */
async function spool(response,{directory,maximum,expectedBytes,expectedSha256,name,type}){
  let temporary,path,writer,reader,size=0;const digest=createHash('sha256');
  try{
    temporary=await mkdtemp(join(await privateDirectory(directory),'.task-desk-read-'));
    path=join(temporary,'original');
    writer=await open(path,'wx',0o600);
    const declared=response.headers.get('content-length');
    if(declared!==null&&(!/^[0-9]+$/.test(declared)||!Number.isSafeInteger(Number(declared))||
        Number(declared)>maximum||expectedBytes!==undefined&&Number(declared)!==expectedBytes))
      throw failure('TASK_DESK_FILE_CHANGED','The original download length differs from its selected metadata.');
    for await(const value of response.body??[]){
      const chunk=Buffer.from(value);size+=chunk.length;
      if(size>maximum||expectedBytes!==undefined&&size>expectedBytes)
        throw failure('TASK_DESK_FILE_LIMIT','The complete original download exceeds its selected byte limit.');
      let at=0;while(at<chunk.length){const part=await writer.write(chunk,at,chunk.length-at);
        if(!part.bytesWritten)throw failure('TASK_DESK_FILE_WRITE','The full original file could not be retained.');at+=part.bytesWritten;}
      digest.update(chunk);
    }
    const sha256=digest.digest('hex');
    if(expectedBytes!==undefined&&size!==expectedBytes||expectedSha256!==undefined&&sha256!==expectedSha256)
      throw failure('TASK_DESK_FILE_CHANGED','The complete received bytes differ from their original selection.');
    await writer.sync();await writer.close();writer=null;
    reader=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    await unlink(path);await rmdir(temporary);
    const owned=reader;reader=null;return {readonlyFileHandle:owned,bytes:size,sha256,name,type};
  }catch(error){await response.body?.cancel().catch(()=>{});throw error;}
  finally{await writer?.close().catch(()=>{});await reader?.close().catch(()=>{});
    if(path)await unlink(path).catch(()=>{});if(temporary)await rmdir(temporary).catch(()=>{});}
}
function nativeDraft(input,definition){
  const selections=input.selections.map(item=>{
    const result=structuredClone(item);
    if(result.rpcResult){
      if(!definition.roots.commerce)throw failure('TASK_DESK_COMMERCE_REQUIRED','The original host must configure this desk’s commerce root before selecting a saved RPC read.');
      result.rpcResult={...result.rpcResult,commerceDirectory:definition.roots.commerce};
    }
    return result;
  });
  return {task:input.task,selections,...(input.predecessorId===undefined?{}:{predecessorId:input.predecessorId})};
}

function customerReview(input){
  if(input.request.kind!=='inbox-task'||input.request.expectedTaskSha256!==input.expectedTaskSha256)
    throw failure('TASK_DESK_CUSTOMER_TASK_CHANGED','The retained customer request belongs to another original task.');
}
function customerResult(value,input){
  customerReview(input);
  if(value?.id!==input.request.id||canonical(value.request)!==canonical(input.request)||
     value.previewSha256!==input.expectedPreviewSha256)
    throw failure('TASK_DESK_CUSTOMER_REQUEST_CHANGED','This named delivery belongs to a different retained request or preview. Preserve this review and inspect the original history before selecting a new ID.',
      {expected:{request:input.request,previewSha256:input.expectedPreviewSha256},
       actual:{id:value?.id,request:value?.request,previewSha256:value?.previewSha256,state:value?.state}});
  if(!['PREPARING','COMPLETE'].includes(value.state))
    throw failure('TASK_DESK_CUSTOMER_STATE','The original customer-delivery state is unrecognized.');
  return value;
}

export class MerchantTaskDesks{
  #config;#fetch;#files;#pending=new Set();#closing=false;#close;
  constructor(config,{fetchImpl=globalThis.fetch}={}){
    this.#config=config;this.#fetch=fetchImpl;
    const maxima=Object.values(config.taskDesks?.desks??{}).map(x=>x.maxFileBytes);
    this.#files=new RetainedFileReads({errorPrefix:'TASK_DESK_FILE',maxImmutableFileBytes:Math.max(1,...maxima)});
  }
  get summary(){
    return {configured:Boolean(this.#config.taskDesks),ownership:'EXISTING_INBOX_TASK_DESK',
      desks:Object.entries(this.#config.taskDesks?.desks??{}).map(([desk,d])=>({desk,label:d.label,roots:d.roots,maxFileBytes:d.maxFileBytes})),
      files:this.#files.summary};
  }
  #definition(alias){
    checked(alias,TASK_DESK_ALIAS,'desk alias');const d=this.#config.taskDesks?.desks[alias];
    if(!d)throw failure('TASK_DESK_NOT_CONFIGURED','Choose an original desk from merchant_task_desks.');
    return d;
  }
  async #connect(input,definition,{newCommand=false}={}){
    if(newCommand)checked(input.expectedInstanceId,TASK_DESK_UUID,'reviewed current instance');
    return connectTaskDesk(definition,{expectedInstanceId:input.expectedInstanceId,fetchImpl:this.#fetch});
  }
  async #task(client,input){
    const task=await client.getTask(input.taskId);
    if(task?.record?.taskSha256!==input.expectedTaskSha256)
      throw failure('TASK_DESK_TASK_CHANGED','The selected saved task differs from its original reviewed SHA256.',
        {expectedTaskSha256:input.expectedTaskSha256,taskSha256:task?.record?.taskSha256});
    return task;
  }
  async #file(input,definition,rpc){
    const scope='task-desk:'+input.desk;
    const selection=rpc?{kind:'rpc',intentId:input.intentId,sourceReadId:input.sourceReadId,responseSha256:input.responseSha256}
      :{kind:input.kind,taskId:input.taskId,taskSha256:input.expectedTaskSha256,...(input.intentId===undefined?{}:{intentId:input.intentId})};
    if(!rpc&&input.kind==='response'&&!input.intentId)throw failure('INVALID_PARAMS','Select the original response intent.');
    if(!rpc&&input.kind==='archive'&&input.intentId!==undefined)throw failure('INVALID_PARAMS','The full packet archive has no separate intent selection.');
    if(rpc&&input.expectedSha256!==undefined&&input.expectedSha256!==input.responseSha256)
      throw failure('TASK_DESK_FILE_CHANGED','Retain the original RPC response SHA256.');
    const expectedSha256=rpc?input.responseSha256:input.expectedSha256;
    const load=async()=>{
      const connected=await this.#connect(input,definition,{newCommand:true}),client=connected.client;
      let response,bytes,sha,name,type;
      if(rpc){
        const selected={readId:input.sourceReadId,responseSha256:input.responseSha256};
        const original=await client.getRpcResponse(input.intentId,selected);
        bytes=original.delivery?.bytes;sha=input.responseSha256;
        if(!Number.isSafeInteger(bytes)||bytes<0)throw failure('TASK_DESK_RPC_METADATA','The original RPC read has no complete byte count.');
        response=await client.downloadRpcResponse(input.intentId,selected);
        name='rpc-result-'+input.sourceReadId.replace(/[^a-zA-Z0-9._-]/g,'_').slice(0,120)+'.json';type='application/json';
      }else{
        await this.#task(client,input);const packet=await client.getPacket(input.taskId);
        if(packet.taskSha256!==input.expectedTaskSha256)throw failure('TASK_DESK_TASK_CHANGED','The original packet belongs to another task.');
        if(input.kind==='response'){
          const file=packet.files.find(item=>item.intentId===input.intentId);
          if(!file)throw failure('TASK_DESK_PACKET_INTENT','Choose a complete original packet response.');
          bytes=file.bytes;sha=file.sha256;
          if(expectedSha256!==undefined&&sha!==expectedSha256)throw failure('TASK_DESK_FILE_CHANGED','The selected response differs from its requested SHA256.');
          response=await client.downloadIntentResponse(input.taskId,input.intentId);
          name=file.path.split('/').pop();type=file.contentType||'application/octet-stream';
        }else{
          response=await client.downloadPacketArchive(input.taskId);
          name='task-results-'+input.taskId.slice(0,12)+'.tar';type='application/x-tar';
        }
      }
      return spool(response,{directory:this.#config.exportsDirectory,maximum:definition.maxFileBytes,
        expectedBytes:bytes,expectedSha256:sha??expectedSha256,name,type});
    };
    return {desk:input.desk,selection,...await this.#files.read({
      scope,key:canonical(selection),kind:selection.kind,directory:this.#config.exportsDirectory,
      load,readId:input.readId,expectedSha256,offset:input.offset,limit:input.limit})};
  }

  async #customerFile(input,definition){
    customerReview(input);
    if(input.expectedSha256!==undefined&&input.expectedSha256!==input.packageSha256)
      throw failure('TASK_DESK_FILE_CHANGED','Retain the exact complete customer package SHA256.');
    const selection={kind:'customer',taskId:input.taskId,taskSha256:input.expectedTaskSha256,
      request:input.request,previewSha256:input.expectedPreviewSha256,
      packageSha256:input.packageSha256,manifestSha256:input.manifestSha256};
    const load=async()=>{
      const connected=await this.#connect(input,definition,{newCommand:true}),client=connected.client;
      await this.#task(client,input);
      const original=customerResult(await client.getCustomerDelivery(input.taskId,input.request.id),input);
      const pkg=original.package;
      if(original.state!=='COMPLETE'||!pkg)
        throw failure('TASK_DESK_CUSTOMER_PENDING','Continue the original reviewed preparation before reading its complete package.');
      if(pkg.sha256!==input.packageSha256||pkg.manifestSha256!==input.manifestSha256||
         !Number.isSafeInteger(pkg.bytes)||pkg.bytes<0||pkg.mediaType!=='application/x-ndjson'||
         pkg.filename!==input.request.id+'.ndjson')
        throw failure('TASK_DESK_CUSTOMER_PACKAGE_CHANGED','The original complete customer package differs from its reviewed identity.');
      const response=await client.downloadCustomerDelivery(input.taskId,input.request.id);
      return spool(response,{directory:this.#config.exportsDirectory,maximum:definition.maxFileBytes,
        expectedBytes:pkg.bytes,expectedSha256:pkg.sha256,name:pkg.filename,type:pkg.mediaType});
    };
    return {desk:input.desk,selection,...await this.#files.read({
      scope:'task-desk:'+input.desk,key:canonical(selection),kind:'customer',
      directory:this.#config.exportsDirectory,load,readId:input.readId,
      expectedSha256:input.packageSha256,offset:input.offset,limit:input.limit})};
  }

  async #execute(name,input){
    if(name==='merchant_task_desks')return this.summary;
    const definition=this.#definition(input.desk);
    if(name==='merchant_task_desk_file_release'){
      await this.#files.release('task-desk:'+input.desk,input.readId);return {desk:input.desk,released:true,readId:input.readId};
    }
    if(name==='merchant_task_desk_packet_file'||name==='merchant_task_desk_rpc_file')
      return this.#file(input,definition,name==='merchant_task_desk_rpc_file');
    if(name.startsWith('merchant_task_desk_customer_')&&!definition.roots.customerDelivery)
      throw failure('TASK_DESK_CUSTOMER_NOT_CONFIGURED','Select the original desk with its configured customer-delivery root.');
    if(name==='merchant_task_desk_customer_file')return this.#customerFile(input,definition);
    const commands=new Set(['preview','create','review','execute','recover','receive','customer_source','customer_preview','customer_prepare']);
    const operation=name.slice('merchant_task_desk_'.length);
    const connected=await this.#connect(input,definition,{newCommand:commands.has(operation)}),client=connected.client;
    const result=native=>({desk:input.desk,instanceId:connected.instanceId,bindingSha256:connected.bindingSha256,native});
    const selectedTask=input.taskId&&operation!=='operations'?await this.#task(client,input):null;
    switch(operation){
      case 'status':return result(connected.status);
      case 'jobs':return result(await client.listJobs());
      case 'rpc_reads':return result(await client.listRpcResponses(input.intentId));
      case 'rpc_inspect':return result(await client.getRpcResponse(input.intentId,{readId:input.readId,responseSha256:input.responseSha256}));
      case 'tasks':return result(await client.listTasks());
      case 'preview':return result(await client.previewTask(nativeDraft(input,definition)));
      case 'create':return result(await client.createTask({...nativeDraft(input,definition),expectedPreviewSha256:input.expectedPreviewSha256}));
      case 'inspect':return result(selectedTask);
      case 'compare':
        await this.#task(client,{taskId:input.previousId,expectedTaskSha256:input.expectedPreviousTaskSha256});
        return result(await client.compareTask(input.taskId,input.previousId));
      case 'review':return result(await client.reviewTask(input.taskId,{intentId:input.intentId}));
      case 'execute':return result(await client.executeTask(input.taskId,{intentId:input.intentId,reviewId:input.reviewId,requestId:input.requestId}));
      case 'recover':return result(await client.recoverTask(input.taskId,{intentId:input.intentId,requestId:input.requestId}));
      case 'receive':return result(await client.receiveTask(input.taskId,{requestId:input.requestId}));
      case 'operations':{
        if(!input.operationId)return result(await client.listOperations({taskId:input.taskId}));
        const original=await client.getOperation(input.operationId);
        if(input.taskId!==undefined&&original.operation.taskId!==input.taskId)
          throw failure('TASK_DESK_OPERATION_CHANGED','This original request ID belongs to another task.');
        return result(original);
      }
      case 'packet':return result(await client.getPacket(input.taskId));
      case 'customer_source':return result(await client.createCustomerSourceManifest({sourceRoot:input.sourceRoot,destination:input.destination}));
      case 'customer_task':return result(await client.inspectCustomerTask(input.taskId));
      case 'customer_deliveries':return result(await client.listCustomerDeliveries(input.taskId));
      case 'customer_preview':{
        const preview=await client.previewCustomerDelivery(input.taskId,input.selection);
        if(preview?.task?.taskSha256!==input.expectedTaskSha256||
           preview?.request?.expectedTaskSha256!==input.expectedTaskSha256)
          throw failure('TASK_DESK_CUSTOMER_TASK_CHANGED','The original customer preview belongs to another task.');
        return result(preview);
      }
      case 'customer_prepare':{
        customerReview(input);
        const prepared=await client.prepareCustomerDelivery(input.taskId,{
          request:input.request,expectedPreviewSha256:input.expectedPreviewSha256});
        return result(customerResult(prepared,input));
      }
      case 'customer_inspect':return result(await client.getCustomerDelivery(input.taskId,input.deliveryId));
      case 'customer_reconcile':{
        customerReview(input);
        return result(customerResult(await client.getCustomerDelivery(input.taskId,input.request.id),input));
      }
      default:throw failure('TOOL_NOT_FOUND','Unknown original InboxTask desk operation.');
    }
  }
  async call(name,args={}){
    if(this.#closing)throw failure('TASK_DESK_BRIDGE_CLOSING','The Merchant desk connection is closing.');
    const definition=definitions.get(name);if(!definition)throw failure('TOOL_NOT_FOUND','Unknown original InboxTask desk operation.');
    validate(args,{type:'object',properties:definition.properties,required:definition.required},'request');
    const selected=structuredClone(args);
    const pending=Promise.resolve().then(()=>this.#execute(name,selected));this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){
    if(!this.#close){this.#closing=true;this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);await this.#files.close();
    })().catch(error=>{this.#close=null;throw error;});}
    return this.#close;
  }
}
