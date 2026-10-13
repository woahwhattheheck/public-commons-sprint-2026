// SPDX-License-Identifier: MIT
// Merchant attachment to the complete original Collaborative Document application.
import {constants} from 'node:fs';
import {open,realpath,lstat} from 'node:fs/promises';
import {dirname,resolve,basename} from 'node:path';
import {createHash} from 'node:crypto';
import {collaborativeTools} from './tools.mjs';
import {CollaborativeFiles,present} from './files.mjs';
import {CollaborativeRequests} from './requests.mjs';
import {MAX_RETAINED_CHUNK_BYTES} from '../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
import {CollaborativeClient,need,plain,exact,absolute,identifier,digest,integer,hash,readJson,privateDirectory,inside,MAX_JSON,MAX_FILE,CHUNK}
  from './connection.mjs';
export const COLLABORATIVE_HOST_SCHEMA='stellar-forge.collaborative-documents-host.v1';
const schemas=new Map(collaborativeTools((name,description,properties,required)=>({name,properties,required})).map(v=>[v.name,v]));
const alias=v=>{need(typeof v==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),'COLLABORATIVE_ALIAS','Choose a host-declared alias.');return v;};
const label=(value,fallback)=>{
  value=value??fallback;need(typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=240&&!/[\x00-\x1f\x7f]/.test(value),
    'COLLABORATIVE_LABEL','Use a readable host label.');return value;
};
const same=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
async function inputDescriptor(path,bytes){
  path=absolute(path);need(await realpath(path)===path,'COLLABORATIVE_INPUT_PATH','Select a canonical original source file.');
  const fd=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{const s=await fd.stat();need(s.isFile()&&s.size===bytes,'COLLABORATIVE_INPUT_CHANGED','The declared complete source byte count changed.',409);return s;}finally{await fd.close();}
}
export async function readCollaborativeDocumentsConfiguration(path){
  const source=await readJson(path,1024*1024),raw=source.value,base=dirname(source.path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  need(raw.schema===COLLABORATIVE_HOST_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,
    'COLLABORATIVE_HOST_CONFIGURATION','Declare one to 32 original customer workspaces.');
  const workspaces=Object.create(null),connections=new Map(),bindings=new Set();
  for(const[name,v]of Object.entries(raw.workspaces)){
    alias(name);exact(v,['label','directory','connectionFile','actorId','inputs'],['directory','connectionFile']);
    const directory=absolute(resolve(base,v.directory)),connectionFile=absolute(resolve(base,v.connectionFile));
    await privateDirectory(dirname(directory));await privateDirectory(dirname(connectionFile));
    try{await privateDirectory(directory);}catch(e){if(e.code!=='ENOENT')throw e;}
    need(!inside(directory,connectionFile)&&connectionFile!==source.path&&(!connections.has(connectionFile)||connections.get(connectionFile)===directory),
      'COLLABORATIVE_HOST_LAYOUT','Keep each private connection outside its single original workspace.');
    const binding=JSON.stringify([directory,connectionFile,v.actorId??null]);
    need(!bindings.has(binding),'COLLABORATIVE_HOST_LAYOUT','Give each exact original workspace/connection/actor binding one alias.');
    connections.set(connectionFile,directory);bindings.add(binding);
    if(v.actorId!==undefined)identifier(v.actorId,'host actor');
    need(v.inputs===undefined||plain(v.inputs)&&Object.keys(v.inputs).length<=256,'COLLABORATIVE_INPUTS','Declare at most 256 complete source files.');
    const inputs=Object.create(null);
    for(const[key,input]of Object.entries(v.inputs??{})){
      alias(key);exact(input,['label','file','sha256','bytes','filename','mediaType'],['file','sha256','bytes','filename','mediaType']);
      digest(input.sha256);integer(input.bytes,'source bytes',MAX_FILE,1);
      const file=absolute(resolve(base,input.file));need(file!==connectionFile,'COLLABORATIVE_HOST_LAYOUT','Keep original inputs separate from the generated connection.');
      need(typeof input.filename==='string'&&input.filename===basename(input.filename)&&input.filename.length>0&&input.filename.length<=240&&
        !/[\x00-\x1f\x7f\\]/.test(input.filename),'COLLABORATIVE_FILENAME','Use a plain original source filename.');
      need(typeof input.mediaType==='string'&&input.mediaType.length>=1&&input.mediaType.length<=200&&!/[\r\n]/.test(input.mediaType),
        'COLLABORATIVE_MEDIA_TYPE','Use the original source media type.');
      await inputDescriptor(file,input.bytes);
      inputs[key]={label:label(input.label,key),file,sha256:input.sha256,bytes:input.bytes,filename:input.filename,mediaType:input.mediaType};
    }
    workspaces[name]={label:label(v.label,name),directory,connectionFile,...(v.actorId===undefined?{}:{actorId:v.actorId}),inputs};
  }
  return{configuration:source.path,sha256:source.sha256,workspaces};
}
export class MerchantCollaborativeWorkspaces{
  #config;#clients=new Map();#files;#requests;#tail=Promise.resolve();#pending=new Set();#closing=false;#closed=null;
  constructor(config){this.#config=config;this.#files=new CollaborativeFiles(config.exportsDirectory,{authorize:(alias,selection)=>this.#authorize(alias,selection)});this.#requests=new CollaborativeRequests(this.#files);}
  get summary(){return{configured:Boolean(this.#config.collaborativeDocuments),connected:[...this.#clients.keys()],pending:this.#pending.size,closing:this.#closing,
    retainedReads:this.#files.summary};}
  #scope(name){
    const selected=this.#config.collaborativeDocuments?.workspaces?.[alias(name)];
    need(selected,'COLLABORATIVE_WORKSPACE_NOT_CONFIGURED','Choose a host-declared original workspace.',404);
    return{...selected,alias:name};
  }
  #client(scope){const c=this.#clients.get(scope.alias);need(c,'COLLABORATIVE_WORKSPACE_DISCONNECTED','Connect the original managed application.',409);return c;}
  #view(scope){
    const client=this.#clients.get(scope.alias);
    return{workspace:scope.alias,label:scope.label,state:client?'CONNECTED':'DISCONNECTED',...(client?client.connection:{}),
      inputs:Object.entries(scope.inputs).map(([sourceInput,v])=>({sourceInput,label:v.label,sha256:v.sha256,bytes:v.bytes,filename:v.filename,mediaType:v.mediaType}))};
  }
  async #access(scope,response,selection){
    const client=this.#client(scope),info=selection.operation==='info'?response:await client.info(),session=info.value;
    const actor=session.actor;
    need(session.instanceId===client.connection.instanceId&&actor?.id===client.connection.actor.id,
      'COLLABORATIVE_ACTOR_CHANGED','Reconnect the exact original actor and installation.',409);
    const view=response?.value?.view??response?.value;
    const documents=Array.isArray(view?.documents)?view.documents:[];
    const projects=Array.isArray(view?.projects)?view.projects:[];
    const readOperations=new Set(['info','projects','project','documents','persistence']);
    return{instanceId:session.instanceId,actorId:actor.id,roles:[...actor.roles].sort(),tenantIds:[...actor.tenantIds].sort(),
      operatorOnly:Boolean(session.permissions.operate)||!readOperations.has(selection.operation),
      projectId:selection.projectId??null,documentIds:documents.map(d=>d.id),
      projectIds:projects.map(p=>p.id),documentId:selection.documentId??null};
  }
  async #authorize(alias,selection){
    const scope=this.#scope(alias),client=this.#client(scope),access=selection?.access;
    need(access&&access.instanceId===client.connection.instanceId&&access.actorId===client.connection.actor.id,
      'COLLABORATIVE_RETAINED_AUTHORITY','This retained snapshot belongs to another original installation or actor.',403);
    const current=(await client.info()).value,actor=current.actor;
    need(current.instanceId===access.instanceId&&actor?.id===access.actorId&&
      JSON.stringify([...actor.roles].sort())===JSON.stringify(access.roles)&&
      JSON.stringify([...actor.tenantIds].sort())===JSON.stringify(access.tenantIds),
      'COLLABORATIVE_RETAINED_AUTHORITY','The current original actor scope differs from this retained snapshot.',403);
    if(access.operatorOnly){
      need(current.permissions.operate,'COLLABORATIVE_OPERATOR_REQUIRED','The retained administrative source requires the original current operator.',403);
    }else{
      if(access.projectIds.length){
        const projects=(await client.projects()).value.projects,allowed=new Set(projects.map(p=>p.id));
        need(access.projectIds.every(id=>allowed.has(id)),'COLLABORATIVE_RETAINED_PROJECT_SCOPE','A retained project is no longer visible to the original actor.',403);
      }
      if(access.projectId){
        await client.project({projectId:access.projectId});
        if(access.documentIds.length){
          const documents=(await client.documents({projectId:access.projectId})).value.documents,allowed=new Set(documents.filter(d=>d.access!=='none').map(d=>d.id));
          need(access.documentIds.every(id=>allowed.has(id)),'COLLABORATIVE_RETAINED_DOCUMENT_SCOPE','A retained document is no longer authorized by its current tenant/document grant.',403);
        }
      }
    }
    // Even an operator needs an explicit original grant to read live persistence.
    if(access.documentId)await client.persistence({projectId:access.projectId,documentId:access.documentId});
    return current;
  }
  async #retain(scope,response,selection,{request=null}={}){
    selection={...selection,access:request?.access??await this.#access(scope,response,selection)};
    let retained,retentionFailure=null,confirmationFailure=null;
    try{retained=await this.#files.retain(scope.alias,response,selection);}
    catch(error){if(!request)throw error;retentionFailure={code:error.code??'COLLABORATIVE_RETAIN_FAILED',message:'The original action returned successfully; retain its complete response by replaying the identical original request.'};}
    if(request)try{await this.#requests.confirm(request,response,retained);}
    catch(error){confirmationFailure={code:error.code??'COLLABORATIVE_CONFIRM_FAILED',message:'The original action returned successfully; the original request remains available for exact replay.'};}
    return{workspace:scope.alias,...(retained??{originalStatus:response.status,value:present(response.value),sha256:response.sha256,bytes:response.bytes.length}),
      ...(request?{requestId:request.requestId,originalOutcome:'CONFIRMED',originalRequest:request.originalRequest}:{}),
      ...(retentionFailure?{retentionFailure}:{}),...(confirmationFailure?{confirmationFailure}:{})};
  }
  async #mutation(scope,client,operation,input,dispatch){
    const record=await this.#requests.prepare(scope.alias,client.connection,operation,input,await this.#access(scope,{value:input},{operation:'original-request',projectId:input.projectId??null}));
    let response;try{response=await dispatch();}
    catch(error){
      // The original engine can commit before an HTTP error (for example grant
      // rechecking or job launch). Preserve this exact actor-bound request on every error.
      error.details={...error.details,requestId:record.requestId,originalRequest:record.originalRequest,
        recovery:'Read or replay this complete original request with the same actor, request ID and payload.'};throw error;
    }
    return this.#retain(scope,response,{operation,requestId:input.requestId,projectId:input.projectId??null},{request:record});
  }
  async #uploadInput(scope,client,args){
    const input=scope.inputs[alias(args.sourceInput)];digest(args.expectedSourceSha256);identifier(args.uploadId,'upload ID');
    need(input&&input.sha256===args.expectedSourceSha256,'COLLABORATIVE_INPUT_SELECTION','Choose the declared original source and full SHA-256.',409);
    need(await realpath(input.file)===input.file,'COLLABORATIVE_INPUT_CHANGED','The original source path changed.',409);
    const fd=await open(input.file,constants.O_RDONLY|constants.O_NOFOLLOW),buffer=Buffer.alloc(CHUNK);
    let response;
    try{
      const before=await fd.stat();need(before.isFile()&&before.size===input.bytes,'COLLABORATIVE_INPUT_CHANGED','The complete source size changed.',409);
      const h=createHash('sha256');let position=0;
      while(position<input.bytes){
        const{bytesRead}=await fd.read(buffer,0,Math.min(buffer.length,input.bytes-position),position);
        need(bytesRead>0,'COLLABORATIVE_INPUT_CHANGED','The complete source ended early.',409);
        h.update(buffer.subarray(0,bytesRead));position+=bytesRead;
      }
      need(h.digest('hex')===input.sha256&&same(before,await fd.stat()),'COLLABORATIVE_INPUT_CHANGED','The selected original source changed before upload.',409);
      response=await client.uploadStart({uploadId:args.uploadId,filename:input.filename,mediaType:input.mediaType,bytes:input.bytes,sha256:input.sha256});
      let state=response.value;
      need(state.id===args.uploadId&&state.bytes===input.bytes&&state.sha256===input.sha256,'COLLABORATIVE_UPLOAD_CHANGED','The original actor-bound upload selects different bytes.',409);
      integer(state.offset,'original upload offset',input.bytes);position=state.offset;
      while(!state.complete&&position<input.bytes){
        need(same(before,await fd.stat()),'COLLABORATIVE_INPUT_CHANGED','The selected source changed during upload. Continue only with its original full bytes.',409);
        const size=Math.min(CHUNK,input.bytes-position);let read=0;
        while(read<size){const r=await fd.read(buffer,read,size-read,position+read);need(r.bytesRead>0,'COLLABORATIVE_INPUT_CHANGED','The selected source ended during upload.',409);read+=r.bytesRead;}
        const bytes=buffer.subarray(0,size);
        response=await client.uploadChunk({uploadId:args.uploadId,start:position,total:input.bytes,sha256:hash(bytes),bytes});
        state=response.value;need(state.offset===position+size,'COLLABORATIVE_UPLOAD_OFFSET','Continue from the original committed upload offset.',409);position=state.offset;
      }
      need(same(before,await fd.stat()),'COLLABORATIVE_INPUT_CHANGED','The original source changed before upload completion.',409);
      response=await client.uploadFinish(args.uploadId);
    }catch(error){
      error.details={...error.details,uploadId:args.uploadId,sourceInput:args.sourceInput,expectedSourceSha256:input.sha256,
        recovery:'Read the same actor-bound upload status and repeat upload_input with this exact source and upload ID.'};throw error;
    }finally{await fd.close();}
    return this.#retain(scope,response,{operation:'upload_input',uploadId:args.uploadId,sourceInput:args.sourceInput,sha256:input.sha256});
  }
  async #dispatch(name,args){
    const schema=schemas.get(name);need(schema,'COLLABORATIVE_TOOL_UNKNOWN','Choose a declared Collaborative Document tool.');
    exact(args,Object.keys(schema.properties),schema.required);
    if(name==='merchant_collaboration_status'&&args.workspace===undefined)
      return{...this.summary,workspaces:Object.entries(this.#config.collaborativeDocuments?.workspaces??{}).map(([name,v])=>this.#view({...v,alias:name}))};
    const scope=this.#scope(args.workspace);
    if(name==='merchant_collaboration_status')return this.#view(scope);
    if(name==='merchant_collaboration_connect'){
      const client=await CollaborativeClient.connect(scope.connectionFile,{directory:scope.directory,actorId:scope.actorId,expectedLaunchId:args.expectedLaunchId});
      const old=this.#clients.get(scope.alias);
      try{if(old){await old.close();await this.#files.disconnect(scope.alias);}}
      catch(error){await client.close();throw error;}
      this.#clients.set(scope.alias,client);
      return{...this.#view(scope),native:await this.#retain(scope,await client.info(),{operation:'info'})};
    }
    if(name==='merchant_collaboration_disconnect'){
      const client=this.#clients.get(scope.alias);
      need(!client||client.connection.launchId===args.launchId,'COLLABORATIVE_INSTANCE_CHANGED','Disconnect the selected launch.',409);
      await client?.close();await this.#files.disconnect(scope.alias);this.#clients.delete(scope.alias);
      return{workspace:scope.alias,launchId:args.launchId,state:'DISCONNECTED'};
    }
    const{workspace,...input}=args;
    if(name==='merchant_collaboration_files')return this.#files.list(scope.alias,input);
    if(name==='merchant_collaboration_file')return this.#files.read(scope.alias,input);
    if(name==='merchant_collaboration_file_release'){await this.#files.release(scope.alias,args.readId);return{workspace:scope.alias,readId:args.readId,released:true};}
    if(name==='merchant_collaboration_inspect')return this.#files.inspect(scope.alias,input);
    if(name==='merchant_collaboration_requests'){
      const info=(await this.#client(scope).info()).value;need(info.permissions.operate,'COLLABORATIVE_OPERATOR_REQUIRED','Original mutation requests are private operator records.',403);
      const page=await this.#requests.list(scope.alias,input);
      need(page.requests.every(r=>r.actorId===info.actor.id&&r.instanceId===info.instanceId),'COLLABORATIVE_RETAINED_AUTHORITY','The retained request page belongs to another original actor or installation.',403);
      return page;
    }
    const client=this.#client(scope);
    switch(name){
      case'merchant_collaboration_browser':await client.info();return{workspace:scope.alias,url:client.connection.origin+'/',...client.connection};
      case'merchant_collaboration_info':return this.#retain(scope,await client.info(),{operation:'info'});
      case'merchant_collaboration_projects':return this.#retain(scope,await client.projects(),{operation:'projects'});
      case'merchant_collaboration_project':return this.#retain(scope,await client.project(input),{operation:'project',...input});
      case'merchant_collaboration_create':return this.#mutation(scope,client,name,input,()=>client.create(input));
      case'merchant_collaboration_action':return this.#mutation(scope,client,name,input,()=>client.action(input));
      case'merchant_collaboration_upload_begin':return this.#retain(scope,await client.uploadStart(input),{operation:'upload_begin',uploadId:input.uploadId});
      case'merchant_collaboration_upload_status':return this.#retain(scope,await client.uploadStatus(args.uploadId),{operation:'upload_status',uploadId:args.uploadId});
      case'merchant_collaboration_upload_chunk':{
        need(typeof args.base64==='string'&&args.base64.length<=4*Math.ceil(MAX_RETAINED_CHUNK_BYTES/3),
          'COLLABORATIVE_CHUNK','Use a complete base64 chunk of at most 196608 bytes.');
        const bytes=Buffer.from(args.base64,'base64');
        need(bytes.length>0&&bytes.length<=MAX_RETAINED_CHUNK_BYTES&&bytes.toString('base64')===args.base64,
          'COLLABORATIVE_CHUNK','Use canonical base64 for this complete original chunk.');
        const{base64,...chunk}=input;
        return this.#retain(scope,await client.uploadChunk({...chunk,bytes}),{operation:'upload_chunk',uploadId:args.uploadId,start:args.start,sha256:args.sha256});
      }
      case'merchant_collaboration_upload_finish':return this.#retain(scope,await client.uploadFinish(args.uploadId),{operation:'upload_finish',uploadId:args.uploadId});
      case'merchant_collaboration_upload_input':return this.#uploadInput(scope,client,args);
      case'merchant_collaboration_request':return this.#retain(scope,await client.request(input),{operation:'native-request',...input});
      case'merchant_collaboration_documents':return this.#retain(scope,await client.documents(input),{operation:'documents',...input});
      case'merchant_collaboration_persistence':return this.#retain(scope,await client.persistence(input),{operation:'persistence',...input});
      case'merchant_collaboration_artifact':return this.#files.artifact(scope.alias,client,args.selection,{sha256:args.expectedSha256,bytes:args.expectedBytes,
        ...(args.filename===undefined?{}:{filename:args.filename}),...(args.mediaType===undefined?{}:{mediaType:args.mediaType})},await this.#access(scope,{value:{}},{operation:'artifact',projectId:args.selection.projectId}));
      default:need(false,'COLLABORATIVE_TOOL_UNKNOWN','Choose a declared Collaborative Document tool.');
    }
  }
  async call(name,args={}){
    need(!this.#closing,'COLLABORATIVE_MCP_CLOSING','The original application attachment is closing.',409);
    const operation=this.#tail.then(()=>this.#dispatch(name,args));this.#tail=operation.catch(()=>{});this.#pending.add(operation);
    try{return await operation;}finally{this.#pending.delete(operation);}
  }
  close(){
    if(this.#closed)return this.#closed;this.#closing=true;
    return this.#closed=(async()=>{await Promise.allSettled([...this.#pending]);
      await Promise.all([...this.#clients.values()].map(c=>c.close()));await this.#files.close();this.#clients.clear();
    })().catch(error=>{this.#closed=null;throw error;});
  }
}
export {collaborativeTools} from './tools.mjs';
