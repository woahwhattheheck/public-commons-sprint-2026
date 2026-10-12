// MIT. Original Soroban event workspace operations on the maintained Merchant host.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {openSorobanEventsWorkspace} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/soroban-events/engine.mjs';
import {RetainedFileReads} from '../retained-file-reads.mjs';
import {validateSorobanEventsArguments} from '../catalog/soroban-events.mjs';
import {MANIFEST_NAME,MAX_JSON_BYTES,MAX_FILE_BYTES,MAX_MANIFEST_BYTES,
  ALIAS,need,checked,plain,digest,decode,relativeFile,parseSorobanEventsManifest} from './contracts.mjs';
export {readSorobanEventsConfiguration} from './connection.mjs';

const methods={state:'describe',plan_save:'planSave',capture_start:'captureStart',
  capture_resume:'captureResume',capture_status:'captureStatus',events:'eventPage',
  edition_create:'editionCreate',edition:'edition',source_export:'sourceExport',publisher_source:'publisherSource'};

export class MerchantSorobanEvents{
  #config;#options;#sessions=new Map();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'SOROBAN_EVENTS',maxImmutableFileBytes:MAX_FILE_BYTES});
  constructor(config,{openWorkspace=openSorobanEventsWorkspace,rpcRequest}={}){
    this.#config=config.sorobanEvents??{workspaces:{},receivers:{}};
    this.#options={openWorkspace,rpcRequest};
  }
  get summary(){return {configured:Object.keys(this.#config.workspaces),owned:[...this.#sessions.keys()],
    closing:this.#closing,...this.#reads.summary};}
  #definition(alias){
    checked(alias,ALIAS,'workspace alias');
    need(Object.hasOwn(this.#config.workspaces,alias),'SOROBAN_EVENTS_WORKSPACE_NOT_CONFIGURED',
      'Choose a workspace from merchant_soroban_events_workspaces.');
    return this.#config.workspaces[alias];
  }
  #view(alias){
    const definition=this.#definition(alias),record=this.#sessions.get(alias);
    return {workspace:alias,label:definition.label,ownership:record?(record.closing?'CLOSING':record.workspace?'OPEN':'OPENING'):'CLOSED',
      captureConfigured:Boolean(definition.connection),network:definition.connection?.network??null,
      receivers:Object.entries(this.#config.receivers??{}).filter(([,target])=>target===alias).map(([name])=>name)};
  }
  async #open(alias){
    const definition=this.#definition(alias);
    let record=this.#sessions.get(alias);
    if(record){need(!record.closing,'SOROBAN_EVENTS_CLOSING','Close this same original workspace before reopening it.');return record.opening;}
    record={workspace:null,opening:null,calls:new Set(),closing:false,close:null};
    this.#sessions.set(alias,record);
    record.opening=Promise.resolve().then(()=>this.#options.openWorkspace({
      directory:definition.directory,...(definition.connection?{connection:definition.connection}:{}),
      ...(this.#options.rpcRequest?{rpcRequest:this.#options.rpcRequest}:{})
    })).then(workspace=>{record.workspace=workspace;return workspace;},error=>{
      if(this.#sessions.get(alias)===record)this.#sessions.delete(alias);throw error;
    });
    return record.opening;
  }
  #opened(alias){
    this.#definition(alias);
    const record=this.#sessions.get(alias);
    need(record&&!record.closing,'SOROBAN_EVENTS_NOT_OPEN','Open the original configured workspace first.');
    return record;
  }
  #closeWorkspace(alias){
    this.#definition(alias);
    const record=this.#sessions.get(alias);
    if(!record)return Promise.resolve({workspace:alias,state:'CLOSED'});
    if(!record.close){
      record.closing=true;
      const attempt=(async()=>{
        await Promise.allSettled([...record.calls]);
        const workspace=await record.opening;
        await this.#reads.closeScope(alias);
        await workspace.close();
        if(this.#sessions.get(alias)===record)this.#sessions.delete(alias);
        return {workspace:alias,state:'CLOSED'};
      })();
      record.close=attempt;attempt.catch(()=>{if(record.close===attempt)record.close=null;});
    }
    return record.close;
  }
  async #manifest(workspace,exportId){
    const state=await workspace.describe(),descriptor=state.exports.find(item=>item.id===exportId);
    need(descriptor,'SOROBAN_EVENTS_EXPORT_NOT_FOUND','Select one retained source export from the original state.');
    const original=await workspace.sourceFile({exportId,path:MANIFEST_NAME});
    need(Buffer.isBuffer(original.content)&&original.content.length===original.bytes&&original.bytes<=MAX_MANIFEST_BYTES&&
      digest(original.content)===original.sha256&&(!descriptor.manifestSha256||descriptor.manifestSha256===original.sha256),
      'SOROBAN_EVENTS_MANIFEST_CHANGED','The original source manifest differs from its retained identity.');
    const manifest=parseSorobanEventsManifest(original.content,exportId);
    return {descriptor,manifest,raw:decode(original.content),bytes:original.content,sha256:original.sha256};
  }
  async #file(workspace,alias,args){
    const selected=await this.#manifest(workspace,args.exportId);
    need(selected.sha256===args.expectedManifestSha256,'SOROBAN_EVENTS_MANIFEST_CHANGED');
    const name=relativeFile(args.file),manifestFile=name===MANIFEST_NAME;
    const item=manifestFile?{name,bytes:selected.bytes.length,sha256:selected.sha256,contentType:'application/json'}:
      selected.manifest.files.find(file=>file.name===name);
    need(item&&item.sha256===args.expectedSha256,'SOROBAN_EVENTS_FILE_CHANGED','Select the exact original file and SHA256.');
    const result=await this.#reads.read({
      scope:alias,key:args.exportId+':'+name,kind:'soroban-event-source',
      directory:this.#definition(alias).directory,readId:args.readId,
      expectedSha256:args.expectedSha256,offset:args.offset??0,limit:args.limit??65536,
      load:async()=>{
        if(manifestFile)return {name,type:'application/json',bytes:selected.bytes};
        // Ask the original engine to select the source before handing its exact
        // immutable file to the maintained descriptor reader.
        const original=await workspace.sourceFile({exportId:args.exportId,path:name,offset:0,length:1});
        need(original.path===name&&original.bytes===item.bytes&&original.sha256===item.sha256,
          'SOROBAN_EVENTS_FILE_CHANGED');
        const root=resolve(selected.descriptor.directory),file=resolve(root,name);
        need(file.startsWith(root+sep)&&await realpath(root)===root&&
          (await realpath(dirname(file)))===dirname(file),'SOROBAN_EVENTS_FILE_CHANGED');
        const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
        return {readonlyFileHandle:handle,name,bytes:item.bytes,sha256:item.sha256,type:item.contentType};
      }
    });
    return {workspace:alias,exportId:args.exportId,manifestSha256:selected.sha256,...result};
  }
  async #json(workspace,args){
    const selected=await this.#manifest(workspace,args.exportId);
    need(selected.sha256===args.expectedManifestSha256,'SOROBAN_EVENTS_MANIFEST_CHANGED');
    const item=selected.manifest.files.find(file=>file.name===args.file);
    need(item&&item.bytes<=MAX_JSON_BYTES&&/json/i.test(item.contentType),'SOROBAN_EVENTS_JSON_FILE_REQUIRED',
      'Select an original JSON source within 128 MiB, or download the complete native file.');
    const source=await workspace.sourceFile({exportId:args.exportId,path:relativeFile(args.file)});
    need(source.content.length===item.bytes&&digest(source.content)===item.sha256,'SOROBAN_EVENTS_FILE_CHANGED');
    let value=decode(source.content);
    const pointer=args.pointer??'';
    need(pointer===''||pointer.startsWith('/'),'SOROBAN_EVENTS_JSON_POINTER_INVALID');
    if(pointer)for(const encoded of pointer.slice(1).split('/')){
      need(!/~(?![01])/.test(encoded),'SOROBAN_EVENTS_JSON_POINTER_INVALID');
      const key=encoded.replace(/~1/g,'/').replace(/~0/g,'~');
      need((Array.isArray(value)||plain(value))&&Object.hasOwn(value,key),'SOROBAN_EVENTS_JSON_POINTER_NOT_FOUND');
      value=value[key];
    }
    const offset=args.offset??0,limit=args.limit??100;
    const result={workspace:args.workspace,exportId:args.exportId,manifestSha256:selected.sha256,
      file:args.file,pointer,type:Array.isArray(value)?'array':plain(value)?'object':value===null?'null':typeof value};
    if(Array.isArray(value))Object.assign(result,{offset,total:value.length,nextOffset:offset+limit<value.length?offset+limit:null,value:value.slice(offset,offset+limit)});
    else if(plain(value)){const keys=Object.keys(value);Object.assign(result,{offset,total:keys.length,
      nextOffset:offset+limit<keys.length?offset+limit:null,value:Object.fromEntries(keys.slice(offset,offset+limit).map(key=>[key,value[key]]))});}
    else Object.assign(result,{offset:0,total:1,nextOffset:null,value});
    if(Buffer.byteLength(JSON.stringify(result))>512*1024){
      delete result.value;result.valueAvailableInOriginalFile=true;
      result.message='The selected value is retained in full in the original source file.';
    }
    return result;
  }
  async #execute(action,args,workspace){
    if(methods[action]){
      const {workspace:alias,...input}=args;
      return action==='state'?workspace.describe():workspace[methods[action]](input);
    }
    if(action==='manifest'){
      const selected=await this.#manifest(workspace,args.exportId);
      return {state:'MANIFEST_RETAINED',workspace:args.workspace,exportId:args.exportId,
        manifest:selected.raw,manifestFile:{name:MANIFEST_NAME,bytes:selected.bytes.length,sha256:selected.sha256}};
    }
    if(action==='file')return this.#file(workspace,args.workspace,args);
    if(action==='file_release'){
      await this.#reads.release(args.workspace,args.readId);
      return {workspace:args.workspace,exportId:args.exportId,readId:args.readId,state:'RELEASED'};
    }
    if(action==='json')return this.#json(workspace,args);
    if(action==='receive'){
      const target=(this.#config.receivers??{})[args.receiver];
      need(target,'SOROBAN_EVENTS_RECEIVER_NOT_CONFIGURED','Select an existing declared receiving alias.');
      need(target!==args.workspace,'SOROBAN_EVENTS_RECEIVER_CONFLICT','Receive into its separate configured workspace.');
      const selected=await this.#manifest(workspace,args.exportId);
      need(selected.sha256===args.expectedManifestSha256,'SOROBAN_EVENTS_MANIFEST_CHANGED');
      const receiving=await this.#open(target),record=this.#opened(target);
      const pending=receiving.sourceReceive({requestId:args.requestId,expectedRevision:args.expectedRevision,
        sourceDirectory:selected.descriptor.directory,expectedManifestSha256:args.expectedManifestSha256});
      record.calls.add(pending);
      try{return {receiver:args.receiver,workspace:target,...await pending};}
      finally{record.calls.delete(pending);}
    }
    need(false,'SOROBAN_EVENTS_UNKNOWN_TOOL');
  }
  async call(name,args={}){
    const action=validateSorobanEventsArguments(name,args);
    need(!this.#closing,'SOROBAN_EVENTS_CLOSING','The original event provider is closing.');
    try{
      if(action==='workspaces')return {workspaces:Object.keys(this.#config.workspaces).map(alias=>this.#view(alias)),
        receivers:{...(this.#config.receivers??{})}};
      this.#definition(args.workspace);
      if(action==='open'){const workspace=await this.#open(args.workspace);return {workspace:args.workspace,...await workspace.describe()};}
      if(action==='close')return await this.#closeWorkspace(args.workspace);
      const record=this.#opened(args.workspace);
      const pending=(async()=>this.#execute(action,args,await record.opening))();
      record.calls.add(pending);
      try{return await pending;}finally{record.calls.delete(pending);}
    }catch(error){
      let message=String(error.message??error);
      for(const definition of Object.values(this.#config.workspaces)){
        const connection=definition.connection;
        for(const value of [connection?.rpcUrl,...Object.values(connection?.headers??{})])
          if(typeof value==='string'&&value.length>0)message=message.split(value).join('[private RPC connection]');
      }
      const exposed=Object.assign(new Error(message),{code:error.code??'SOROBAN_EVENTS_ERROR'});
      if(error.applied===false)exposed.applied=false;
      if(args.requestId)exposed.requestId=args.requestId;
      throw exposed;
    }
  }
  close(){
    if(!this.#close){
      this.#closing=true;
      const attempt=(async()=>{
        for(;;){
          const records=[...this.#sessions.values()];
          await Promise.allSettled(records.flatMap(record=>[record.opening,...record.calls].filter(Boolean)));
          if([...this.#sessions.values()].every(record=>record.calls.size===0))break;
        }
        const results=await Promise.allSettled([...this.#sessions.keys()].map(alias=>this.#closeWorkspace(alias)));
        const failed=results.find(result=>result.status==='rejected');
        if(failed)throw failed.reason;
        await this.#reads.close();
      })();
      this.#close=attempt;attempt.catch(()=>{if(this.#close===attempt)this.#close=null;});
    }
    return this.#close;
  }
}
