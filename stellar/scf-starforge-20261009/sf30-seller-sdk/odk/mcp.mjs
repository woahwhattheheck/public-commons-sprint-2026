// MIT. Typed MCP borrows the original Applications-owned Central listener and source store.
import {dirname,resolve,join} from 'node:path';
import {ODK_ACTION_TOOLS,odkWorkspaceTools} from './mcp-catalog.mjs';
import {CentralRetainedFiles} from './mcp-files.mjs';
import {ODK_CONNECTION_FILENAME,ODK_UUID,odkNeed,odkPlain,odkExact,odkAbsolute,
  odkPrivateDirectory,odkReadPrivateJson,odkFailure,readCentralConnection,odkConnectionView,
  odkRequest,inspectCentralListener} from './connection.mjs';

export const ODK_MCP_CONNECTION_SCHEMA='stellar-forge.odk-workspace-connection.v1';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/;
const COLLECTIONS=['connections','plans','captures','reviews','exports','reports','archives','running'];
const schemas=new Map(odkWorkspaceTools((name,description,properties,required)=>
  ({name,properties,required})).map(value=>[value.name,value]));
function alias(value){
  odkNeed(typeof value==='string'&&ALIAS.test(value),'ODK_ALIAS_INVALID','Choose a declared original host alias.');
  return value;
}
function label(value,fallback){
  const result=value??fallback;
  odkNeed(typeof result==='string'&&result.trim()===result&&result.length>=1&&result.length<=240&&
    !/[\x00-\x1f\x7f]/.test(result),'ODK_CONFIGURATION_INVALID','Use a readable label of 1–240 characters.');
  return result;
}
function page(value,offset=0,limit=50){
  odkNeed(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=1000,
    'ODK_PAGE_INVALID','Choose a nonnegative offset and a page size from 1 to 1000.');
  const result={...value,pages:{}};
  for(const key of COLLECTIONS)if(Array.isArray(value[key])){
    result[key]=value[key].slice(offset,offset+limit);
    result.pages[key]={offset,limit,total:value[key].length,
      nextOffset:offset+limit<value[key].length?offset+limit:null};
  }
  return result;
}
function sourceProfile(value,key){
  odkExact(value,['id','name','url','authEnv','allowLoopback'],['id','name','url','authEnv']);
  odkNeed(typeof value.id==='string'&&value.id.length>=1&&value.id.length<=240&&!/[\x00-\x1f\x7f]/.test(value.id)&&typeof value.authEnv==='string'&&
    /^[A-Za-z_][A-Za-z0-9_]*$/.test(value.authEnv)&&value.authEnv.length<=200&&
    (value.allowLoopback===undefined||typeof value.allowLoopback==='boolean'),
  'ODK_SOURCE_PROFILE_INVALID','Declare the stable original connection ID and existing authorization environment name.');
  let url;try{url=new URL(value.url);}catch{}
  odkNeed(url&&['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash&&!url.search,
    'ODK_SOURCE_PROFILE_INVALID','Declare the original Central base URL without credentials or query.');
  return {...value,name:label(value.name,key)};
}
/** Loading host configuration does not open a writer or call Central. */
export async function readCentralWorkspaceConfiguration(path){
  const source=await odkReadPrivateJson(odkAbsolute(path)),raw=source.value;
  odkExact(raw,['schema','workspaces'],['schema','workspaces']);
  odkNeed(raw.schema===ODK_MCP_CONNECTION_SCHEMA&&odkPlain(raw.workspaces)&&
    Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,
  'ODK_CONFIGURATION_INVALID','Declare 1–32 original Central workspace aliases.');
  const base=dirname(source.path),workspaces=Object.create(null),directories=new Set();
  for(const [name,input]of Object.entries(raw.workspaces)){
    alias(name);
    odkExact(input,['label','directory','workspaceId','connections','merchants','runtimes'],['directory']);
    odkNeed(typeof input.directory==='string'&&input.directory.length>0,
      'ODK_CONFIGURATION_INVALID','Declare the original private workspace directory.');
    const directory=(await odkPrivateDirectory(resolve(base,input.directory))).path;
    odkNeed(!directories.has(directory),'ODK_CONFIGURATION_DUPLICATE','Give the same original workspace one host alias.');
    directories.add(directory);
    odkNeed(input.workspaceId===undefined||ODK_UUID.test(input.workspaceId),
      'ODK_WORKSPACE_ID_INVALID','Select the original workspace UUID when pinning it explicitly.');
    const connections=Object.create(null),merchants=Object.create(null),runtimes=Object.create(null);
    for(const collection of ['connections','merchants','runtimes'])
      odkNeed(input[collection]===undefined||odkPlain(input[collection])&&Object.keys(input[collection]).length<=32,
        'ODK_CONFIGURATION_INVALID','Use up to 32 declared profiles in each original host collection.');
    const sourceIds=new Set();
    for(const [key,value]of Object.entries(input.connections||{})){
      connections[alias(key)]=sourceProfile(value,key);
      odkNeed(!sourceIds.has(value.id),'ODK_SOURCE_PROFILE_DUPLICATE','Give each original native source connection one profile.');
      sourceIds.add(value.id);
    }
    for(const [key,value]of Object.entries(input.merchants||{})){
      alias(key);
      odkExact(value,['label','origin','path','payment','defaultLimit','maxLimit'],['origin','path','payment']);
      odkNeed(typeof value.origin==='string'&&typeof value.path==='string'&&odkPlain(value.payment),
        'ODK_MERCHANT_PROFILE_INVALID','A reviewed merchant profile declares its native origin, route and payment terms.');
      merchants[key]={...value,label:label(value.label,key)};
    }
    for(const [key,value]of Object.entries(input.runtimes||{})){
      alias(key);odkExact(value,['port','facilitator','allowLocalFacilitator']);
      odkNeed((value.port===undefined||Number.isInteger(value.port)&&value.port>=0&&value.port<=65535)&&
        (value.facilitator===undefined||typeof value.facilitator==='string'&&value.facilitator.length>=1&&value.facilitator.length<=4096)&&
        (value.allowLocalFacilitator===undefined||typeof value.allowLocalFacilitator==='boolean'),
      'ODK_RUNTIME_PROFILE_INVALID','Declare the original SF82 dataset port and facilitator options.');
      runtimes[key]=structuredClone(value);
    }
    workspaces[name]={label:label(input.label,name),directory,
      connectionFile:join(directory,ODK_CONNECTION_FILENAME),workspaceId:input.workspaceId||null,
      connections,merchants,runtimes};
  }
  return {workspaces,configuration:source.path,sha256:source.sha256};
}
export class MerchantCentralWorkspaces{
  #config;#connections=new Map();#pending=new Set();#closing=false;#closePromise;#files;
  constructor(config){this.#config=config;this.#files=new CentralRetainedFiles(config.exportsDirectory);}
  get summary(){return {configured:Boolean(this.#config.odkWorkspaces),connected:[...this.#connections.keys()],
    pending:this.#pending.size,closing:this.#closing,...this.#files.summary};}
  #scope(name){
    alias(name);const entry=this.#config.odkWorkspaces?.workspaces?.[name];
    odkNeed(entry,'ODK_WORKSPACE_NOT_CONFIGURED','Choose a configured alias from merchant_odk_status.',404);
    return {...entry,alias:name};
  }
  async #connect(scope,expectedInstanceId){
    const connection=await readCentralConnection(scope.connectionFile,{directory:scope.directory});
    odkNeed(!expectedInstanceId||connection.value.instanceId===expectedInstanceId,
      'ODK_INSTANCE_CHANGED','The original instance differs from the selected one.',409);
    const live=await inspectCentralListener(connection);
    odkNeed(!scope.workspaceId||live.id===scope.workspaceId,'ODK_WORKSPACE_CHANGED',
      'The original live workspace differs from its declared host binding.',409);
    const old=this.#connections.get(scope.alias);
    if(old&&old.sha256!==connection.sha256)await this.#files.disconnect(scope);
    this.#connections.set(scope.alias,connection);
    return {workspace:scope.alias,state:'CONNECTED',...odkConnectionView(connection),native:page(live)};
  }
  async #connection(scope){
    const connection=this.#connections.get(scope.alias);
    odkNeed(connection,'ODK_WORKSPACE_DISCONNECTED','Connect this original Application before operating its source.',409);
    let current;
    try{current=await readCentralConnection(scope.connectionFile,{directory:scope.directory});}
    catch(error){
      if(error.code==='ENOENT')throw odkFailure('ODK_APPLICATION_STOPPED',
        'The original Central application stopped. Open its saved Application and reconnect.',409);
      throw error;
    }
    odkNeed(current.sha256===connection.sha256&&current.value.instanceId===connection.value.instanceId,
      'ODK_CONNECTION_CHANGED','The original Application restarted. Inspect and reconnect before continuing the same operation.',409);
    return connection;
  }
  async #status(args){
    if(args.workspace===undefined)return {...this.summary,
      workspaces:Object.entries(this.#config.odkWorkspaces?.workspaces||{}).map(([workspace,entry])=>({
        workspace,label:entry.label,workspaceId:entry.workspaceId,
        state:this.#connections.has(workspace)?'CONNECTED':'DISCONNECTED',
        sources:Object.entries(entry.connections).map(([profile,value])=>({profile,id:value.id,name:value.name,
          url:value.url,authEnv:value.authEnv,allowLoopback:value.allowLoopback===true})),
        merchants:Object.entries(entry.merchants).map(([profile,value])=>({profile,...value})),
        runtimes:Object.keys(entry.runtimes),
      }))};
    const scope=this.#scope(args.workspace);
    if(!this.#connections.has(scope.alias))return {workspace:scope.alias,label:scope.label,state:'DISCONNECTED'};
    const connection=await this.#connection(scope),live=await inspectCentralListener(connection);
    return {workspace:scope.alias,state:'CONNECTED',...odkConnectionView(connection),
      native:page(live,args.offset??0,args.limit??50)};
  }
  async #action(connection,action,payload,readOnly=false){
    const value=await odkRequest(connection,'/api/actions/'+action,{
      method:'POST',body:payload,readOnly,maximum:64*1024*1024});
    if(value?.ok!==true||!Object.hasOwn(value,'result')){
      const operationId=payload.reportId??payload.exportId??payload.id??null;
      throw Object.assign(odkFailure('ODK_ACTION_RESPONSE_INVALID',
        'The original Central action did not return a complete result.',502,
        {operationId,dispatch:readOnly?'read':'unknown'}),{operationId});
    }
    return value.result;
  }
  async #dispatch(name,args){
    const schema=schemas.get(name);
    odkNeed(schema,'ODK_TOOL_UNKNOWN','Choose a declared original Central tool.');
    odkExact(args,Object.keys(schema.properties),schema.required);
    if(name==='merchant_odk_status')return this.#status(args);
    const scope=this.#scope(args.workspace);
    if(name==='merchant_odk_connect')return this.#connect(scope,args.expectedInstanceId);
    if(name==='merchant_odk_disconnect'){
      const connected=this.#connections.get(scope.alias);
      odkNeed(!connected||connected.value.instanceId===args.instanceId,'ODK_INSTANCE_CHANGED',
        'Use the current connected instance ID.',409);
      await this.#files.disconnect(scope);this.#connections.delete(scope.alias);
      return {workspace:scope.alias,instanceId:args.instanceId,state:'DISCONNECTED'};
    }
    if(name==='merchant_odk_files')return this.#files.list(scope,args.offset,args.limit);
    if(name==='merchant_odk_file')return this.#files.file(scope,args);
    if(name==='merchant_odk_file_release'){
      await this.#files.release(scope,args.readId);return {workspace:scope.alias,readId:args.readId,released:true};
    }
    if(name==='merchant_odk_file_retain'){const prior=await this.#files.find(scope,args);if(prior)return prior;}
    const connection=await this.#connection(scope);
    if(Object.hasOwn(ODK_ACTION_TOOLS,name)){
      const definition=ODK_ACTION_TOOLS[name],{workspace,...payload}=args;
      return this.#action(connection,definition.action,payload,definition.readOnly===true);
    }
    switch(name){
      case 'merchant_odk_browser':
        await inspectCentralListener(connection);
        return {workspace:scope.alias,instanceId:connection.value.instanceId,url:connection.value.url};
      case 'merchant_odk_source_connect':{
        const profile=scope.connections[alias(args.profile)];
        odkNeed(profile,'ODK_SOURCE_NOT_CONFIGURED','Choose a host-declared original Central connection.');
        return this.#action(connection,'connect',structuredClone(profile));
      }
      case 'merchant_odk_capture_status':
        return odkRequest(connection,'/api/captures/'+encodeURIComponent(args.id),{maximum:64*1024*1024});
      case 'merchant_odk_dataset':{
        const profile=scope.merchants[alias(args.profile)];
        odkNeed(profile,'ODK_MERCHANT_NOT_CONFIGURED','Choose the reviewed original merchant terms.');
        const {label,...terms}=profile,{workspace,profile:profileAlias,...payload}=args;
        return this.#action(connection,'exportDataset',{...terms,...payload});
      }
      case 'merchant_odk_release_prepare':{
        const {workspace,runtime,...payload}=args;
        if(runtime!==undefined){
          const selected=scope.runtimes[alias(runtime)];
          odkNeed(selected,'ODK_RUNTIME_NOT_CONFIGURED','Choose a host-declared original SF82 runtime.');
          payload.runtime=structuredClone(selected);
        }
        return this.#action(connection,'prepareRelease',payload);
      }
      case 'merchant_odk_file_retain':return this.#files.retain(scope,connection,args);
      default:throw odkFailure('ODK_TOOL_UNKNOWN','Choose a declared original Central tool.');
    }
  }
  async call(name,args={}){
    odkNeed(!this.#closing,'ODK_MCP_CLOSING','The original Central attachment is closing.',409);
    const operation=this.#dispatch(name,args);this.#pending.add(operation);
    try{return await operation;}finally{this.#pending.delete(operation);}
  }
  close(){
    if(this.#closePromise)return this.#closePromise;this.#closing=true;
    this.#closePromise=(async()=>{
      await Promise.allSettled([...this.#pending]);await this.#files.close();this.#connections.clear();
    })().catch(error=>{this.#closePromise=null;throw error;});
    return this.#closePromise;
  }
}
export {odkWorkspaceTools} from './mcp-catalog.mjs';
