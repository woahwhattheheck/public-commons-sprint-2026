// MIT. Original native GridFabric workspaces through the maintained merchant host.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {dirname,resolve,basename} from 'node:path';
import {exact,line,identifier} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {GridFabricClientError,GRIDFABRIC_CONNECTION_SCHEMA,gridFabricOperations,gridFabricToolName,
  gridFabricFileId,validateGridFabricOperation,SHA256,UUID,plain,need} from '../sdk/contract.mjs';
import {connectGridFabricOperator} from '../sdk/http-client.mjs';
import {createGridFabricFileSource} from '../sdk/download.mjs';
import {gridFabricExtraToolFields,gridFabricMerchantTools} from './catalog.mjs';

export {gridFabricMerchantTools};
const failure=(code,message,details={})=>new GridFabricClientError(code,message,details);
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink,s.uid].join(':');
const nativeNames=new Map(Object.keys(gridFabricOperations).map(operation=>[gridFabricToolName(operation),operation]));
function path(value,base) {
  need(typeof value==='string'&&value&&!/[\0\r\n]/.test(value),'GRIDFABRIC_CONFIGURATION','Declare the original host path.');
  return resolve(base,value);
}
function aliases(value,label) {
  if(value===undefined)return {};
  need(plain(value),'GRIDFABRIC_CONFIGURATION','Declare '+label+' aliases as an object.');
  for(const name of Object.keys(value))identifier(name,label+' alias');
  return value;
}
function hash(value){need(SHA256.test(value??''),'GRIDFABRIC_FILE_IDENTITY','Select the complete original SHA256.');return value;}
function size(value,minimum=0){need(Number.isSafeInteger(value)&&value>=minimum,'GRIDFABRIC_FILE_IDENTITY','Select the complete original byte count.');return value;}
function canonicalFile(value){const selected=gridFabricFileId(value);need(selected.fileId===value,'GRIDFABRIC_FILE_IDENTITY','Use the declared complete file_SHA256 or export_UUID.');return value;}
async function configurationBytes(path) {
  const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try {
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size<=4194304n&&
      (process.platform==='win32'||(before.mode&0o077n)===0n&&before.nlink===1n&&before.uid===BigInt(process.getuid())),
      'GRIDFABRIC_CONFIGURATION_PRIVATE','Use a complete ordinary private workspace configuration.');
    const bytes=await handle.readFile(),named=await lstat(path,{bigint:true}),after=await handle.stat({bigint:true});
    need(bytes.length<=4194304&&named.isFile()&&!named.isSymbolicLink()&&stamp(before)===stamp(after)&&
      stamp(before)===stamp(named)&&await realpath(path)===path,'GRIDFABRIC_CONFIGURATION_CHANGED',
      'The original host workspace configuration changed while it was read.');
    return bytes;
  }finally{await handle.close();}
}
export async function readGridFabricWorkspaceConfiguration(configuration) {
  configuration=resolve(configuration);
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await configurationBytes(configuration)));
  exact(value,['schema','workspaces'],['schema','workspaces']);
  need(value.schema===GRIDFABRIC_CONNECTION_SCHEMA&&plain(value.workspaces)&&Object.keys(value.workspaces).length,
    'GRIDFABRIC_CONFIGURATION','Declare the existing original GridFabric workspaces.');
  const base=dirname(configuration),workspaces=Object.create(null);
  for(const [alias,input]of Object.entries(value.workspaces)) {
    identifier(alias,'Workspace alias');
    exact(input,['label','connectionFile','workspaceId','workspace','sourceSha256','files','receivingSiblings','maximumResponseBytes','timeoutMs'],
      ['connectionFile','workspaceId','workspace']);
    need(typeof input.workspaceId==='string'&&input.workspaceId&&!/[\0\r\n]/.test(input.workspaceId),
      'GRIDFABRIC_CONFIGURATION','Bind the original native workspace identity.');
    const files=Object.create(null),receivingSiblings=Object.create(null);
    for(const [alias,source]of Object.entries(aliases(input.files,'file'))) {
      exact(source,['path','name','kind','bytes','sha256','mimeType'],['path','kind','bytes','sha256']);
      need(['source','archive'].includes(source.kind),'GRIDFABRIC_CONFIGURATION','Declare an original source file or portable archive.');
      const selected=path(source.path,base),name=source.name??basename(selected);
      need(typeof name==='string'&&name&&!/[\0\r\n\\/]/.test(name)&&!['.','..'].includes(name),
        'GRIDFABRIC_CONFIGURATION','Declare a plain original filename.');
      const mimeType=source.mimeType??(source.kind==='archive'?'application/gzip':'application/json');
      need(typeof mimeType==='string'&&mimeType&&!/[\0\r\n]/.test(mimeType),
        'GRIDFABRIC_CONFIGURATION','Declare the original file media type.');
      files[alias]={path:selected,name,kind:source.kind,bytes:size(source.bytes,source.kind==='archive'?1:0),
        sha256:hash(source.sha256),mimeType};
    }
    for(const [alias,target]of Object.entries(aliases(input.receivingSiblings,'receiving'))) {
      exact(target,['name'],['name']);
      need(typeof target.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,100}$/.test(target.name)&&!['.','..'].includes(target.name),
        'GRIDFABRIC_CONFIGURATION','Declare the original sibling workspace name.');
      receivingSiblings[alias]={name:target.name};
    }
    if(input.maximumResponseBytes!==undefined)size(input.maximumResponseBytes,1024);
    if(input.timeoutMs!==undefined)size(input.timeoutMs,1);
    workspaces[alias]={label:line(input.label??alias,'Workspace label'),connectionFile:path(input.connectionFile,base),
      workspaceId:input.workspaceId,workspace:path(input.workspace,base),files,receivingSiblings,
      ...(input.sourceSha256===undefined?{}:{sourceSha256:hash(input.sourceSha256)}),
      ...(input.maximumResponseBytes===undefined?{}:{maximumResponseBytes:input.maximumResponseBytes}),
      ...(input.timeoutMs===undefined?{}:{timeoutMs:input.timeoutMs})};
  }
  return {schema:GRIDFABRIC_CONNECTION_SCHEMA,workspaces};
}
export class MerchantGridFabricWorkspaces {
  #config;#clients=new Map();#sources=new Map();#pending=new Set();#closing=false;#closed;
  constructor(config){this.#config=config;}
  get summary() {
    return {configured:Boolean(this.#config.gridFabricWorkspaces),ownership:'EXISTING_GRIDFABRIC_OPERATOR',
      workspaces:Object.entries(this.#config.gridFabricWorkspaces?.workspaces??{}).map(([workspace,value])=>({
        workspace,label:value.label,workspace_id:value.workspaceId,attached:this.#clients.has(workspace),
        files:Object.entries(value.files??{}).map(([file,item])=>({file,kind:item.kind,name:item.name,bytes:item.bytes,sha256:item.sha256})),
        receivingSiblings:Object.keys(value.receivingSiblings??{})
      }))};
  }
  #definition(workspace) {
    identifier(workspace,'Workspace alias');
    const definition=this.#config.gridFabricWorkspaces?.workspaces?.[workspace];
    need(definition,'GRIDFABRIC_NOT_CONFIGURED','Choose the original workspace declared by this host.');
    return definition;
  }
  async #client(workspace) {
    const value=this.#definition(workspace);
    if(!this.#clients.has(workspace)) {
      const pending=connectGridFabricOperator({connectionFile:value.connectionFile,expectedWorkspaceId:value.workspaceId,
        expectedWorkspace:value.workspace,...(value.sourceSha256===undefined?{}:{expectedSourceSha256:value.sourceSha256}),
        ...(value.maximumResponseBytes===undefined?{}:{maximumResponseBytes:value.maximumResponseBytes}),
        ...(value.timeoutMs===undefined?{}:{timeoutMs:value.timeoutMs})});
      this.#clients.set(workspace,pending);
      pending.catch(()=>{if(this.#clients.get(workspace)===pending)this.#clients.delete(workspace);});
    }
    return this.#clients.get(workspace);
  }
  async #source(workspace,fileId,expectedSha256) {
    canonicalFile(fileId);if(expectedSha256!==undefined)hash(expectedSha256);
    const key=JSON.stringify([workspace,fileId]);
    if(!this.#sources.has(key)) {
      const pending=(async()=>createGridFabricFileSource({client:await this.#client(workspace),fileId,expectedSha256}))();
      this.#sources.set(key,pending);
      pending.catch(()=>{if(this.#sources.get(key)===pending)this.#sources.delete(key);});
    }
    const source=await this.#sources.get(key);
    need(expectedSha256===undefined||source.manifest.native_file.sha256===expectedSha256,
      'GRIDFABRIC_FILE_CHANGED','The native file differs from the reviewed SHA256.');
    return source;
  }
  async #execute(name,args) {
    if(name==='merchant_gridfabric_workspaces'){exact(args,[]);return this.summary;}
    const {workspace,...input}=args,definition=this.#definition(workspace),client=await this.#client(workspace);
    const native=reply=>({workspace,native:reply.value,raw_text:reply.raw_text,http_status:reply.http_status,
      headers:reply.headers,raw_headers:reply.raw_headers});
    const operation=nativeNames.get(name);
    if(operation){validateGridFabricOperation(operation,input);return native(await client.callRaw(operation,input));}
    if(name==='merchant_gridfabric_status')return {ownership:'EXISTING_GRIDFABRIC_OPERATOR',connection:client.identity,
      ...native(await client.callRaw('state',{}))};
    if(name==='merchant_gridfabric_reopen') {
      const connection=await client.reopen();
      for(const key of this.#sources.keys())if(JSON.parse(key)[0]===workspace)this.#sources.delete(key);
      return {reattached:true,connection,...native(await client.callRaw('state',{}))};
    }
    if(name==='merchant_gridfabric_file_info')return {workspace,native:await client.fileInfo(canonicalFile(input.fileId))};
    if(name==='merchant_gridfabric_file_manifest') {
      const source=await this.#source(workspace,input.exportId,input.expectedSha256);
      return {workspace,...await source.call(name,{exportId:input.exportId}),
        manifest:source.manifest,manifestSha256:source.manifestSha256};
    }
    if(name==='merchant_gridfabric_file') {
      const source=await this.#source(workspace,input.exportId);return {workspace,...await source.call(name,input)};
    }
    if(name==='merchant_gridfabric_upload') {
      identifier(input.file,'File alias');
      const file=definition.files?.[input.file];
      need(file&&file.kind==='source'&&file.sha256===hash(input.expectedSha256)&&file.bytes===size(input.expectedBytes),
        'GRIDFABRIC_FILE_CHANGED','Repeat the reviewed original source file, byte count and digest.');
      return {file:input.file,...native(await client.uploadFile({file:file.path,name:file.name,mimeType:file.mimeType,
        expectedBytes:file.bytes,expectedSha256:file.sha256}))};
    }
    if(name==='merchant_gridfabric_receive') {
      identifier(input.file,'Archive alias');identifier(input.destination,'Receiving alias');
      const file=definition.files?.[input.file],destination=definition.receivingSiblings?.[input.destination];
      need(file&&file.kind==='archive'&&destination&&file.sha256===hash(input.expectedSha256)&&
        file.bytes===size(input.expectedBytes,1)&&UUID.test(input.request_id??''),
        'GRIDFABRIC_FILE_CHANGED','Repeat the reviewed archive, declared sibling and retained request UUID.');
      return {file:input.file,destination:input.destination,...native(await client.receiveArchive({file:file.path,
        expectedBytes:file.bytes,expectedSha256:file.sha256,name:destination.name,requestId:input.request_id}))};
    }
    throw failure('GRIDFABRIC_TOOL_UNKNOWN','Choose a declared original GridFabric operation.');
  }
  async call(name,args={}) {
    need(!this.#closing,'GRIDFABRIC_CLIENT_CLOSING','This GridFabric borrower is closing.');
    need(plain(args),'GRIDFABRIC_SDK_INPUT','Supply the declared operation fields.');
    const operation=nativeNames.get(name);
    if(operation)exact(args,['workspace',...Object.keys(gridFabricOperations[operation].inputSchema.properties)],
      ['workspace',...gridFabricOperations[operation].inputSchema.required]);
    else {
      const fields=gridFabricExtraToolFields[name];need(fields,'GRIDFABRIC_TOOL_UNKNOWN','Choose a declared original operation.');
      exact(args,fields,fields.filter(field=>!(name==='merchant_gridfabric_file_manifest'&&field==='expectedSha256')));
    }
    const task=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(task);
    try{return await task;}
    catch(caught) {
      const error=caught instanceof Error?caught:failure('GRIDFABRIC_NATIVE_ERROR',String(caught));
      const details={...(plain(error.details)?error.details:{}),schema:'commons.gridfabric-native-tool-error.v1'};
      if(args.workspace!==undefined)details.workspace=args.workspace;
      for(const key of ['native_operation','http_status','request_id','raw_text','body_base64','native_error','headers','raw_headers',
        'uncertain','accepted','receiving','recovery','expected','observed','file_id','offset','expected_sha256','expected_bytes'])
        if(error[key]!==undefined)details[key]=error[key];
      error.details=details;throw error;
    }finally{this.#pending.delete(task);}
  }
  close() {
    this.#closing=true;
    if(!this.#closed)this.#closed=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const results=await Promise.allSettled([...this.#clients.values()].map(async pending=>(await pending).close()));
      this.#sources.clear();
      need(results.every(result=>result.status==='fulfilled'),'GRIDFABRIC_CLOSE_INCOMPLETE','An owned HTTP attachment is still closing.');
      this.#clients.clear();
    })().catch(error=>{this.#closed=null;throw error;});
    return this.#closed;
  }
}
