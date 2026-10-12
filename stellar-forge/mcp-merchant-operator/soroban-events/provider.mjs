// MIT. Original Soroban event workspace operations on the maintained Merchant host.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {openSorobanEventsWorkspace} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/soroban-events/engine.mjs';
import {openSorobanEventWatches} from '../../../stellar/scf-starforge-20261009/sf30-seller-sdk/soroban-events/watch.mjs';
import {RetainedFileReads} from '../retained-file-reads.mjs';
import {validateSorobanEventsArguments} from '../catalog/soroban-events.mjs';
import {MANIFEST_NAME,MANIFEST_SCHEMA,WATCH_MANIFEST_SCHEMA,MAX_JSON_BYTES,MAX_FILE_BYTES,MAX_MANIFEST_BYTES,
  ALIAS,need,checked,plain,digest,decode,relativeFile,parseSorobanEventsManifest} from './contracts.mjs';
export {readSorobanEventsConfiguration} from './connection.mjs';

const methods={state:'describe',plan_save:'planSave',capture_start:'captureStart',
  capture_resume:'captureResume',capture_status:'captureStatus',events:'eventPage',
  edition_create:'editionCreate',edition:'edition',source_export:'sourceExport',publisher_source:'publisherSource'};

const watchMethods={watch_state:'describe',watch_status:'watchStatus',watch_save:'watchSave',
  watch_configure:'watchConfigure',watch_start:'watchStart',watch_pause:'watchPause',
  watch_run:'watchRun',watch_repair:'watchRepair',watch_export:'watchExport'};

export class MerchantSorobanEvents{
  #config;#options;#sessions=new Map();#closing=false;#close;
  #reads=new RetainedFileReads({errorPrefix:'SOROBAN_EVENTS',maxImmutableFileBytes:MAX_FILE_BYTES});
  constructor(config,{openWorkspace=openSorobanEventsWorkspace,openWatches=openSorobanEventWatches,rpcRequest}={}){
    this.#config=config.sorobanEvents??{workspaces:{},receivers:{}};
    this.#options={openWorkspace,openWatches,rpcRequest};
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
      captureConfigured:Boolean(definition.connection||Object.keys(definition.connections??{}).length),
      network:definition.connection?.network??definition.connections?.default?.network??null,
      connections:[...(definition.connection?['default']:[]),...Object.keys(definition.connections??{})],
      publications:Object.keys(definition.publications??{}),
      receivers:Object.entries(this.#config.receivers??{}).filter(([,target])=>target===alias).map(([name])=>name)};
  }
  #publication(alias,name){
    if(name===null)return null;
    checked(name,ALIAS,'publication alias');
    const publication=this.#definition(alias).publications?.[name];
    need(publication,'SOROBAN_EVENTS_PUBLICATION_NOT_CONFIGURED','Select an existing publication alias from this workspace.');
    return {...publication};
  }
  #redact(error){
    let message=String(error.message??error);
    for(const definition of Object.values(this.#config.workspaces))
      for(const connection of [definition.connection,...Object.values(definition.connections??{})])
        for(const value of [connection?.rpcUrl,...Object.values(connection?.headers??{})])
          if(typeof value==='string'&&value.length>0)message=message.split(value).join('[private RPC connection]');
    return {code:error.code??'SOROBAN_EVENTS_ERROR',message};
  }
  #runWatches(record){
    if(record.closing||record.runner)return;
    const controller=new AbortController();
    record.runnerController=controller;record.runnerError=null;
    const pending=Promise.resolve().then(()=>record.watches.run({signal:controller.signal}))
      .catch(error=>{if(!controller.signal.aborted)record.runnerError=this.#redact(error);})
      .finally(()=>{if(record.runner===pending){record.runner=null;record.runnerController=null;}});
    record.runner=pending;
  }
  async #open(alias){
    need(!this.#closing,'SOROBAN_EVENTS_CLOSING','The original event provider is closing.');
    const definition=this.#definition(alias);
    let record=this.#sessions.get(alias);
    if(record){need(!record.closing,'SOROBAN_EVENTS_CLOSING','Close this same original workspace before reopening it.');return record.opening;}
    record={workspace:null,watches:null,opening:null,calls:new Set(),closing:false,close:null,
      runner:null,runnerController:null,runnerError:null};
    this.#sessions.set(alias,record);
    record.opening=Promise.resolve().then(()=>this.#options.openWorkspace({
      directory:definition.directory,...(definition.connection?{connection:definition.connection}:{}),
      ...(definition.connections?{connections:definition.connections}:{}),
      ...(this.#options.rpcRequest?{rpcRequest:this.#options.rpcRequest}:{})
    })).then(async workspace=>{
      record.workspace=workspace;
      record.watches=await this.#options.openWatches({workspace});
      // One native loop resumes persisted RUNNING watches and idles when paused.
      // It is separate from finite calls so shutdown can abort and drain it first.
      this.#runWatches(record);
      return workspace;
    }).catch(async error=>{
      await record.watches?.close().catch(()=>{});
      await record.workspace?.close().catch(()=>{});
      if(this.#sessions.get(alias)===record)this.#sessions.delete(alias);
      throw error;
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
        const workspace=await record.opening;
        record.runnerController?.abort(new Error('Soroban event workspace closing.'));
        await record.watches.close();
        if(record.runner)await record.runner;
        await Promise.allSettled([...record.calls]);
        await this.#reads.closeScope(alias);
        await workspace.close();
        if(this.#sessions.get(alias)===record)this.#sessions.delete(alias);
        return {workspace:alias,state:'CLOSED'};
      })();
      record.close=attempt;attempt.catch(()=>{if(record.close===attempt)record.close=null;});
    }
    return record.close;
  }
  async #sourceBytes(source,{exportId,path},maximum){
    const identity=await source.sourceFile({exportId,path,offset:0,length:1});
    need(identity.path===path&&Number.isSafeInteger(identity.bytes)&&identity.bytes>=0&&identity.bytes<=maximum,
      'SOROBAN_EVENTS_SOURCE_TOO_LARGE','Select the complete download for a source larger than this JSON view.');
    const chunks=[];let offset=0;
    while(offset<identity.bytes){
      const length=Math.min(196608,identity.bytes-offset);
      const page=await source.sourceFile({exportId,path,offset,length});
      need(page.path===path&&page.bytes===identity.bytes&&page.sha256===identity.sha256&&
        Buffer.isBuffer(page.content)&&page.content.length===length,'SOROBAN_EVENTS_FILE_CHANGED');
      chunks.push(page.content);offset+=length;
    }
    const content=Buffer.concat(chunks,offset);
    need(digest(content)===identity.sha256,'SOROBAN_EVENTS_FILE_CHANGED');
    return {...identity,content};
  }
  async #manifest(workspace,exportId,watches){
    const state=await workspace.describe();
    let descriptor=state.exports.find(item=>item.id===exportId),source=workspace;
    if(!descriptor){
      const watchState=await watches.describe();
      descriptor=watchState.exports.find(item=>item.id===exportId);source=watches;
    }
    need(descriptor,'SOROBAN_EVENTS_EXPORT_NOT_FOUND','Select one retained edition or watch export from its original state.');
    const original=await this.#sourceBytes(source,{exportId,path:MANIFEST_NAME},MAX_MANIFEST_BYTES);
    need(Buffer.isBuffer(original.content)&&original.content.length===original.bytes&&original.bytes<=MAX_MANIFEST_BYTES&&
      digest(original.content)===original.sha256&&(!descriptor.manifestSha256||descriptor.manifestSha256===original.sha256),
      'SOROBAN_EVENTS_MANIFEST_CHANGED','The original source manifest differs from its retained identity.');
    const manifest=parseSorobanEventsManifest(original.content,exportId);
    return {descriptor,source,manifest,raw:decode(original.content),bytes:original.content,sha256:original.sha256};
  }
  async #file(workspace,alias,args,watches){
    const selected=await this.#manifest(workspace,args.exportId,watches);
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
        const original=await selected.source.sourceFile({exportId:args.exportId,path:name,offset:0,length:1});
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
  async #json(workspace,args,watches){
    const selected=await this.#manifest(workspace,args.exportId,watches);
    need(selected.sha256===args.expectedManifestSha256,'SOROBAN_EVENTS_MANIFEST_CHANGED');
    const item=selected.manifest.files.find(file=>file.name===args.file);
    need(item&&item.bytes<=MAX_JSON_BYTES&&/json/i.test(item.contentType),'SOROBAN_EVENTS_JSON_FILE_REQUIRED',
      'Select an original JSON source within 128 MiB, or download the complete native file.');
    const source=await this.#sourceBytes(selected.source,{exportId:args.exportId,path:relativeFile(args.file)},MAX_JSON_BYTES);
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
  async #execute(action,args,workspace,record){
    const watches=record.watches;
    if(methods[action]){
      const {workspace:alias,...input}=args;
      return action==='state'?workspace.describe():workspace[methods[action]](input);
    }
    if(watchMethods[action]){
      const {workspace:alias,...input}=args;
      if(Object.hasOwn(input,'publication'))input.publication=this.#publication(alias,input.publication);
      const result=await (action==='watch_state'?watches.describe():watches[watchMethods[action]](input));
      if(action==='watch_start')this.#runWatches(record);
      if(action==='watch_state')return {...result,runner:{state:record.runner?'RUNNING':'STOPPED',lastError:record.runnerError}};
      return result;
    }
    if(action==='manifest'){
      const selected=await this.#manifest(workspace,args.exportId,watches);
      return {state:'MANIFEST_RETAINED',workspace:args.workspace,exportId:args.exportId,
        manifest:selected.raw,manifestFile:{name:MANIFEST_NAME,bytes:selected.bytes.length,sha256:selected.sha256}};
    }
    if(action==='file')return this.#file(workspace,args.workspace,args,watches);
    if(action==='file_release'){
      await this.#reads.release(args.workspace,args.readId);
      return {workspace:args.workspace,exportId:args.exportId,readId:args.readId,state:'RELEASED'};
    }
    if(action==='json')return this.#json(workspace,args,watches);
    if(action==='receive'||action==='watch_receive'){
      const target=(this.#config.receivers??{})[args.receiver];
      need(target,'SOROBAN_EVENTS_RECEIVER_NOT_CONFIGURED','Select an existing declared receiving alias.');
      need(target!==args.workspace,'SOROBAN_EVENTS_RECEIVER_CONFLICT','Receive into its separate configured workspace.');
      const selected=await this.#manifest(workspace,args.exportId,watches);
      need(selected.sha256===args.expectedManifestSha256,'SOROBAN_EVENTS_MANIFEST_CHANGED');
      const isWatch=action==='watch_receive';
      need(selected.manifest.schema===(isWatch?WATCH_MANIFEST_SCHEMA:MANIFEST_SCHEMA),
        'SOROBAN_EVENTS_EXPORT_KIND','Use watch_receive with a watch revision for an original watch export.');
      const receiving=await this.#open(target),targetRecord=this.#opened(target);
      const input={requestId:args.requestId,expectedRevision:args.expectedRevision,
        sourceDirectory:selected.descriptor.directory,expectedManifestSha256:args.expectedManifestSha256};
      if(isWatch){
        if(args.connectionAlias!==undefined)input.connectionAlias=args.connectionAlias;
        if(args.recoveryConnectionAlias!==undefined)input.recoveryConnectionAlias=args.recoveryConnectionAlias;
        if(args.publication!==undefined)input.publicationDirectory=this.#publication(target,args.publication).directory;
      }
      const pending=isWatch?targetRecord.watches.watchReceive(input):receiving.sourceReceive(input);
      targetRecord.calls.add(pending);
      try{return {receiver:args.receiver,workspace:target,...await pending};}
      finally{targetRecord.calls.delete(pending);}
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
      const pending=(async()=>this.#execute(action,args,await record.opening,record))();
      record.calls.add(pending);
      try{return await pending;}finally{record.calls.delete(pending);}
    }catch(error){
      const detail=this.#redact(error);
      const exposed=Object.assign(new Error(detail.message),{code:detail.code});
      if(error.applied===false)exposed.applied=false;
      if(args.requestId)exposed.requestId=args.requestId;
      throw exposed;
    }
  }
  close(){
    if(!this.#close){
      this.#closing=true;
      const attempt=(async()=>{
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
