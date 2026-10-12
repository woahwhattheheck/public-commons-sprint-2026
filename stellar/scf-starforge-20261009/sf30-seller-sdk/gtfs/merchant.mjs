// MIT. Fleet authoring over the same original GTFS model, publisher and browser.
import { lstat, realpath, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, basename, resolve, isAbsolute, join } from 'node:path';
import { exact, failure, identifier, line, plain, privateSupportDirectory, writePrivate } from '../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import { readJson, digest } from '../postgres/publisher/files.mjs';
import { openGtfsWorkspace, readGtfsInputFile, GTFS_UUID } from './workspace.mjs';
import { startGtfsWorkspaceServer } from './server.mjs';
import { gtfsWorkspaceTools } from './catalog.mjs';

export { gtfsWorkspaceTools };
export const GTFS_CONNECTION_SCHEMA='stellar-forge.gtfs-workspace-connection.v1';
const pathValue=(value,base)=>{
  if(typeof value!=='string'||!value||value.includes('\0'))throw failure('CONFIGURATION_ERROR','Declare the original host path.');
  return isAbsolute(value)?resolve(value):resolve(base,value);
};
const definitions=new Map(gtfsWorkspaceTools((name,description,properties,required)=>[name,{properties,required}]));
const nativeId=value=>{if(!GTFS_UUID.test(value??''))throw failure('INVALID_PARAMS','Use the original workspace/request UUID.');return value;};
const privateKeys=new Set(['directory','sourceFile','targetDirectory','publisherDirectory','archive','archivePath','archiveFile',
  'exportsDirectory','releaseDirectory','releaseStore','packageDirectory','datasetDirectory','receiptFile','sourceDirectory','output']);
const physicalFields=new Set(['rows','sample','samples','columns','projection','recipe','authority','row','before','after']);
function view(value) {
  if(Array.isArray(value))return value.map(view);
  if(!plain(value))return value;
  return Object.fromEntries(Object.entries(value).filter(([key,item])=>
    !privateKeys.has(key)&&!(key==='file'&&typeof item==='string'&&isAbsolute(item))).map(([key,item])=>
    [key,physicalFields.has(key)?structuredClone(item):view(item)]));
}
function safeError(issue){
  const code=/^[A-Z][A-Z0-9_]{0,79}$/.test(issue?.code??'')?issue.code:'GTFS_OPERATION_FAILED';
  return failure(code,'Original GTFS operation: '+code+'. Read this original request and the current workspace before continuing.');
}
export async function readGtfsWorkspaceConfiguration(file) {
  file=resolve(file);const raw=await readJson(file,1024*1024);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==GTFS_CONNECTION_SCHEMA||!plain(raw.workspaces)||!Object.keys(raw.workspaces).length||
    Object.keys(raw.workspaces).length>32)throw failure('CONFIGURATION_ERROR','Declare 1–32 existing original GTFS workspaces.');
  const base=dirname(file),seen=new Set(),workspaces=Object.create(null);
  for(const [alias,input] of Object.entries(raw.workspaces)){
    identifier(alias,'GTFS workspace alias');
    exact(input,['directory','workspaceId','label','inputs','exportsDirectory','releaseStore','seller','resource'],['directory','workspaceId']);
    nativeId(input.workspaceId);
    const directory=pathValue(input.directory,base);
    await privateSupportDirectory(directory);
    if(await realpath(directory)!==directory||seen.has(directory))throw failure('CONFIGURATION_ERROR','Use one canonical alias per original private workspace.');
    seen.add(directory);
    const state=await readJson(join(directory,'workspace.json'),16*1024*1024);
    if(state.schema!=='stellar-forge.gtfs-workspace.v1'||state.id!==input.workspaceId)
      throw failure('GTFS_WORKSPACE_ID_CHANGED','The host declaration must name the original saved workspace UUID.');
    if(input.inputs!==undefined&&(!plain(input.inputs)||Object.keys(input.inputs).length>64))
      throw failure('CONFIGURATION_ERROR','Declare at most 64 original ZIP input aliases.');
    const inputs=Object.create(null);
    for(const [name,item] of Object.entries(input.inputs??{})){
      identifier(name,'GTFS input alias');exact(item,['file','label'],['file']);
      inputs[name]={file:pathValue(item.file,base),label:line(item.label??name,'GTFS input label')};
    }
    if(Boolean(input.seller)!==Boolean(input.resource))throw failure('CONFIGURATION_ERROR','Declare the original seller and resource together.');
    for(const name of ['seller','resource'])if(input[name]){
      let url;try{url=new URL(input[name]);}catch{}
      if(!url||!['http:','https:'].includes(url.protocol)||url.username||url.password||url.hash)
        throw failure('CONFIGURATION_ERROR','Use the original credential-free HTTP(S) buyer binding.');
    }
    workspaces[alias]={directory,workspaceId:input.workspaceId,label:line(input.label??alias,'GTFS workspace label'),inputs,
      exportsDirectory:input.exportsDirectory?pathValue(input.exportsDirectory,base):undefined,
      releaseStore:input.releaseStore?pathValue(input.releaseStore,base):null,seller:input.seller??null,resource:input.resource??null};
  }
  return {schema:GTFS_CONNECTION_SCHEMA,workspaces};
}
export class MerchantGtfsWorkspaces {
  #config;#publishers;#entries=new Map();#opening=new Map();#closing=false;#closed;
  constructor(config,publishers){this.#config=config;this.#publishers=publishers;}
  get summary(){
    return {configured:Boolean(this.#config.gtfsWorkspaces),
      workspaces:Object.entries(this.#config.gtfsWorkspaces?.workspaces??{}).map(([workspace,value])=>{
        const entry=this.#entries.get(workspace);
        return {workspace,label:value.label,workspaceId:value.workspaceId,
          state:entry?entry.closing?'CLOSING':'OPEN':this.#opening.has(workspace)?'OPENING':'CLOSED',
          instanceId:entry?.instanceId??null,browserUrl:entry?.service.url??null,
          inputs:Object.keys(value.inputs),releaseConfigured:Boolean(value.releaseStore)};
      })};
  }
  #definition(alias){
    identifier(alias,'GTFS workspace alias');const value=this.#config.gtfsWorkspaces?.workspaces[alias];
    if(!value)throw failure('GTFS_WORKSPACE_NOT_CONFIGURED','Choose a declared original GTFS workspace.');
    return value;
  }
  #entry(alias){
    this.#definition(alias);const value=this.#entries.get(alias);
    if(!value)throw failure('GTFS_WORKSPACE_NOT_OPEN','Open the original GTFS workspace first.');
    if(value.closing)throw failure('GTFS_WORKSPACE_CLOSING','The original workspace is draining.');
    return value;
  }
  async #state(entry,args={}){
    return {workspace:entry.alias,workspaceId:entry.model.id,instanceId:entry.instanceId,browserUrl:entry.service.url,
      native:view(await entry.model.status(args))};
  }
  async #open(alias){
    const input=this.#definition(alias);
    if(this.#entries.has(alias))return this.#state(this.#entry(alias));
    if(this.#opening.has(alias))return this.#opening.get(alias);
    const task=(async()=>{
      let model,service;
      try{
        model=await openGtfsWorkspace({...input,expectedWorkspaceId:input.workspaceId});
        service=await startGtfsWorkspaceServer({workspace:model,port:0});
        if(this.#closing)throw failure('GTFS_WORKSPACE_CLOSING','The merchant operator is closing.');
        const entry={alias,model,service,instanceId:randomUUID(),pending:new Set(),closing:null};
        this.#entries.set(alias,entry);
        try{return await this.#state(entry);}catch(issue){this.#entries.delete(alias);throw issue;}
      }catch(issue){await service?.close().catch(()=>{});await model?.close().catch(()=>{});throw issue;}
    })();
    this.#opening.set(alias,task);
    try{return await task;}finally{this.#opening.delete(alias);}
  }
  #closeEntry(entry){
    if(!entry.closing)entry.closing=(async()=>{
      const results=await Promise.allSettled([entry.service.close(),entry.model.close(),...entry.pending]);
      if(this.#entries.get(entry.alias)===entry)this.#entries.delete(entry.alias);
      if(results.slice(0,2).some(result=>result.status==='rejected'))
        throw failure('GTFS_SHUTDOWN_INCOMPLETE','The original GTFS owner reported incomplete shutdown.');
      return {workspace:entry.alias,instanceId:entry.instanceId,state:'CLOSED'};
    })();
    return entry.closing;
  }
  #input(alias,name){
    identifier(name,'GTFS input alias');const input=this.#definition(alias).inputs[name];
    if(!input)throw failure('GTFS_INPUT_NOT_CONFIGURED','Choose a host-declared original ZIP.');
    return input;
  }
  async #inputs(alias,name){
    const all=this.#definition(alias).inputs;
    if(name===undefined)return {workspace:alias,inputs:Object.entries(all).map(([input,value])=>({input,label:value.label}))};
    const source=this.#input(alias,name),raw=await readGtfsInputFile(source.file);
    return {workspace:alias,input:name,label:source.label,file:{name:basename(source.file),bytes:raw.length,sha256:digest(raw)}};
  }
  async #import(entry,args){
    const selected=this.#input(entry.alias,args.input);
    const input={requestId:args.requestId,expectedRevision:args.expectedRevision,
      payload:{title:args.title,filename:basename(selected.file),feedSha256:args.expectedSha256,feedBytes:args.expectedBytes}};
    // Native same-request recovery gets the first chance to use its complete
    // already-retained ZIP, even when the original host input is now unavailable.
    try{return await entry.model.retainFeed(input);}
    catch(issue){if(!['GTFS_UPLOAD_RETRY_REQUIRED','PRIVATE_FILE_REQUIRED'].includes(issue.code))throw issue;}
    const raw=await readGtfsInputFile(selected.file);
    if(raw.length!==args.expectedBytes||digest(raw)!==args.expectedSha256)
      throw failure('GTFS_INPUT_CHANGED','Inspect the exact original ZIP and byte count again.');
    return entry.model.retainFeed(input,raw);
  }
  async #execute(entry,name,args){
    const {workspace,...input}=args,model=entry.model;
    if(name.startsWith('merchant_gtfs_publisher_')){
      if(!this.#publishers||typeof this.#publishers.callBorrowed!=='function')
        throw failure('GTFS_PUBLISHER_ADAPTER_MISSING','Use the original maintained merchant publisher adapter.');
      const value=await this.#publishers.callBorrowed({alias:workspace,publisher:model.publisher,schedule:model.schedule,
        instanceId:entry.instanceId},name.replace('merchant_gtfs_publisher_','merchant_publisher_'),
        {publisher:workspace,...input});
      return {workspace,workspaceId:model.id,instanceId:entry.instanceId,native:view(value)};
    }
    let value;
    switch(name){
      case 'merchant_gtfs_status':return this.#state(entry,input);
      case 'merchant_gtfs_inputs':return this.#inputs(workspace,input.input);
      case 'merchant_gtfs_import':value=await this.#import(entry,args);break;
      case 'merchant_gtfs_feed':value=await model.feed(input.id);break;
      case 'merchant_gtfs_source_rows':value=await model.sourceRows(input);break;
      case 'merchant_gtfs_edition_create':value=await model.createEdition(input);break;
      case 'merchant_gtfs_edition':value=await model.edition(input.id);break;
      case 'merchant_gtfs_rows':value=await model.rows(input);break;
      case 'merchant_gtfs_compare':value=await model.compareEditions(input);break;
      case 'merchant_gtfs_comparison':value=await model.comparison(input.id);break;
      case 'merchant_gtfs_decision':value=await model.saveDecision(input);break;
      case 'merchant_gtfs_select':value=await model.selectEdition(input);break;
      case 'merchant_gtfs_operation':value=model.operation(input.requestId);break;
      case 'merchant_gtfs_recover':value=await model.recoverRequest(input.requestId);break;
      case 'merchant_gtfs_plan_template':value=await (await import('./cli.mjs')).makeGtfsPlan(model,input.query);break;
      case 'merchant_gtfs_release_prepare':value=await model.prepareRelease(input);break;
      case 'merchant_gtfs_release_stage':value=await model.stageRelease(input);break;
      case 'merchant_gtfs_export':value=await model.exportWorkspace(input);break;
      case 'merchant_gtfs_manifest':value=await model.manifest(input);break;
      case 'merchant_gtfs_file_read':value=await model.readFile(input);break;
      case 'merchant_gtfs_file_release':await model.releaseRead(input.readId);value={readId:input.readId,state:'RELEASED'};break;
      default:throw failure('TOOL_NOT_FOUND','Unknown original GTFS operation.');
    }
    return {workspace,workspaceId:model.id,instanceId:entry.instanceId,native:view(value)};
  }
  async call(name,args={}){
    if(this.#closing)throw failure('GTFS_WORKSPACE_CLOSING','The merchant operator is closing.');
    try{
      const definition=definitions.get(name);
      if(!definition)throw failure('TOOL_NOT_FOUND','Unknown original GTFS tool.');
      exact(args,Object.keys(definition.properties),definition.required);
      if(name==='merchant_gtfs_workspaces')return this.summary;
      if(name==='merchant_gtfs_open')return await this.#open(args.workspace);
      if(name==='merchant_gtfs_close'){
        const entry=this.#entry(args.workspace);
        if(entry.instanceId!==nativeId(args.instanceId))throw failure('GTFS_INSTANCE_CHANGED','Close this process-owned original instance.');
        return await this.#closeEntry(entry);
      }
      const entry=this.#entry(args.workspace),pending=Promise.resolve().then(()=>this.#execute(entry,name,args));
      entry.pending.add(pending);
      try{return await pending;}finally{entry.pending.delete(pending);}
    }catch(issue){throw safeError(issue);}
  }
  close(){
    if(!this.#closed){
      this.#closing=true;
      this.#closed=(async()=>{
        await Promise.allSettled([...this.#opening.values()]);
        const results=await Promise.allSettled([...this.#entries.values()].map(entry=>this.#closeEntry(entry)));
        if(results.some(result=>result.status==='rejected'))throw failure('GTFS_SHUTDOWN_INCOMPLETE','A native GTFS workspace did not finish closing.');
      })();
    }
    return this.#closed;
  }
}
export async function initializeGtfsMerchant({directory,connection,releaseStore,name='GTFS Schedule merchant'}){
  const root=resolve(directory),selectedConnection=resolve(connection),configuration=join(root,'merchant-mcp.json');
  const selected=await readGtfsWorkspaceConfiguration(selectedConnection);
  const original=await import('../../sf82-seller-pilot/releases.mjs');
  const selectedStore=releaseStore?resolve(releaseStore):join(root,'releases');
  if(releaseStore)await original.readReleaseState(selectedStore);
  await mkdir(root,{mode:0o700});
  if(!releaseStore)await original.initReleaseStore(selectedStore);
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  await writePrivate(configuration,{schema:'stellar-forge.merchant-mcp.v1',name:line(name,'Merchant name'),
    releaseStore:selectedStore,exportsDirectory:'./customer-exports',sources:{},gtfsWorkspaceConnection:selectedConnection});
  await (await import('../../../../stellar-forge/mcp-merchant-operator/config.mjs')).readMerchantConfig(configuration);
  return {schema:'stellar-forge.merchant-mcp.v1',state:'INITIALIZED',configuration,gtfsWorkspacesConfigured:true,
    workspaces:Object.entries(selected.workspaces).map(([workspace,value])=>({workspace,workspaceId:value.workspaceId,label:value.label}))};
}
