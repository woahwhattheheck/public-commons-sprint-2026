// MIT. Agent attachment to the original authenticated SQL Server browser owner.
import { resolve, dirname } from 'node:path';
import { mssqlWorkspaceTools } from './catalog.mjs';
const MSSQL_TOOL_DEFINITIONS=new Map(mssqlWorkspaceTools((name,description,properties,required)=>({name,properties,required})).map(value=>[value.name,value]));
import { UUID, SHA, ALIAS, exact, need, checked, plain, readBytes, decodeJSON, failure, absolute } from '../workspace/operator-store.mjs';

export const MSSQL_CONNECTION_SCHEMA='stellar-forge.mssql-workspace-connection.v1';
function hostPath(value,base) {
  need(typeof value==='string'&&value&&!value.includes('\0'),'MSSQL_CONNECTION_PATH_INVALID');
  return absolute(resolve(base,value));
}
export async function readMssqlWorkspaceConfiguration(path) {
  path=absolute(path);
  const raw=decodeJSON(await readBytes(path,1048576));
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  need(raw.schema===MSSQL_CONNECTION_SCHEMA&&plain(raw.workspaces)&&
    Object.keys(raw.workspaces).length>=1&&Object.keys(raw.workspaces).length<=32,'MSSQL_CONNECTION_INVALID');
  const base=dirname(path),workspaces=Object.create(null);
  for(const [alias,value] of Object.entries(raw.workspaces)) {
    checked(alias,ALIAS,'workspace alias');
    exact(value,['label','workspaceId','consoleUrlFile','deliveries'],['workspaceId','consoleUrlFile']);
    checked(value.workspaceId,UUID,'workspace UUID');
    need(value.label===undefined||typeof value.label==='string'&&value.label.trim()&&value.label.length<=160&&
      !/[\x00-\x1f\x7f]/.test(value.label),'MSSQL_CONNECTION_LABEL_INVALID');
    const deliveries=Object.create(null);
    need(value.deliveries===undefined||plain(value.deliveries)&&Object.keys(value.deliveries).length<=64,'MSSQL_DELIVERY_CONFIGURATION_INVALID');
    for(const [alias,delivery] of Object.entries(value.deliveries??{})) {
      checked(alias,ALIAS,'receiving directory alias');
      exact(delivery,['directory','manifestSha256'],['directory']);
      deliveries[alias]={directory:hostPath(delivery.directory,base),
        ...(delivery.manifestSha256===undefined?{}:{manifestSha256:checked(delivery.manifestSha256,SHA,'transfer digest')})};
    }
    workspaces[alias]={label:value.label??alias,workspaceId:value.workspaceId,
      consoleUrlFile:hostPath(value.consoleUrlFile,base),deliveries};
  }
  return {schema:MSSQL_CONNECTION_SCHEMA,workspaces};
}
export async function readMssqlResponse(response,maximum=4*1024*1024) {
  const chunks=[];let size=0;
  try {
    for await(const bytes of response.body??[]) {
      size+=bytes.length;need(size<=maximum,'MSSQL_WORKSPACE_RESPONSE_TOO_LARGE');
      chunks.push(bytes);
    }
    return Buffer.concat(chunks,size);
  } catch(error){await response.body?.cancel().catch(()=>{});throw error;}
}
export function mssqlConnectionRecord(raw,expectedWorkspaceId) {
  let value=raw;
  if(value?.schema==='stellar-forge.application-url.v1') {
    need(value.command==='mssql-workspace'&&value.source==='original-command-stdout'&&plain(value.original),
      'MSSQL_WORKSPACE_CONNECTION_INVALID');
    value={...value.original,workspace:value.url};
  }
  need(value?.schema==='stellar-forge.mssql-workspace-startup.v1'&&value.workspaceId===expectedWorkspaceId&&
    UUID.test(value.instanceId??'')&&SHA.test(value.profileId??'')&&
    Number.isSafeInteger(value.pid)&&value.pid>0,'MSSQL_WORKSPACE_CONNECTION_INVALID');
  let url;try{url=new URL(value.workspace);}catch{}
  need(url&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.search&&
    !url.username&&!url.password&&/^#[a-f0-9]{64}$/.test(url.hash)&&
    Number(url.port)>=1&&Number(url.port)<=65535,'MSSQL_WORKSPACE_CONNECTION_INVALID');
  return {origin:url.origin,token:url.hash.slice(1),instanceId:value.instanceId,
    workspaceId:value.workspaceId,profileId:value.profileId,record:value};
}
export class MssqlWorkspaceClient {
  #definition;#selected;
  constructor(definition,{selected}={}){this.#definition=definition;this.#selected=selected;}
  get definition(){return this.#definition;}
  async connection(){
    if(this.#selected)return this.#selected;
    let raw;
    try{raw=decodeJSON(await readBytes(this.#definition.consoleUrlFile,16384));}
    catch(error){throw failure('MSSQL_WORKSPACE_UNAVAILABLE','Start the original saved SQL Server Application and use its current private connection file.',503);}
    return mssqlConnectionRecord(raw,this.#definition.workspaceId);
  }
  async selected(){
    const connection=await this.connection(),client=new MssqlWorkspaceClient(this.#definition,{selected:connection});
    const info=await client.json('/api/info');
    need(info.schema==='stellar-forge.mssql-workspace.v1'&&info.workspaceId===connection.workspaceId&&
      info.instanceId===connection.instanceId&&info.profileId===connection.profileId,
      'MSSQL_WORKSPACE_IDENTITY_CHANGED',undefined,409);
    return client;
  }
  async json(route,body,{signal,timeoutMs=240000}={}) {
    need(typeof route==='string'&&route.startsWith('/api/')&&!/[\x00-\x20#]/.test(route),'MSSQL_WORKSPACE_ROUTE_INVALID');
    const connection=await this.connection(),url=new URL(route,connection.origin);
    need(url.origin===connection.origin&&url.pathname.startsWith('/api/'),'MSSQL_WORKSPACE_ROUTE_INVALID');
    const payload=body===undefined?undefined:JSON.stringify(body);
    need(payload===undefined||Buffer.byteLength(payload)<=524288,'MSSQL_WORKSPACE_REQUEST_TOO_LARGE');
    const timeout=AbortSignal.timeout(timeoutMs),deadline=signal?AbortSignal.any([signal,timeout]):timeout;
    try{
      const response=await fetch(url,{method:payload===undefined?'GET':'POST',redirect:'error',signal:deadline,
        headers:{'x-workspace-token':connection.token,'x-mssql-workspace-id':connection.workspaceId,
          Origin:connection.origin,...(payload===undefined?{}:{'content-type':'application/json'})},
        ...(payload===undefined?{}:{body:payload})});
      const bytes=await readMssqlResponse(response),value=decodeJSON(bytes);
      if(!response.ok){
        const code=/^[A-Z][A-Z0-9_]+$/.test(value?.error??'')?value.error:'MSSQL_WORKSPACE_REJECTED';
        throw failure(code,typeof value.detail==='string'?value.detail:'The original SQL Server workspace returned HTTP '+response.status+'.',response.status);
      }
      return value;
    }catch(error){
      if(error.status)throw error;
      const failureValue=failure('MSSQL_WORKSPACE_INTERRUPTED','Reopen this original review, release or operation UUID to continue.',503);
      if(payload!==undefined)failureValue.outcomeUnknown=true;
      throw failureValue;
    }
  }
  delivery(alias){
    checked(alias,ALIAS,'receiving directory alias');
    const value=this.#definition.deliveries[alias];
    need(value,'MSSQL_DELIVERY_NOT_CONFIGURED');return value;
  }
}

const query=(route,values)=>route+(Object.keys(values).length?'?'+new URLSearchParams(Object.entries(values)
  .filter(([,value])=>value!==undefined).map(([key,value])=>[key,String(value)])):'');
const compact=value=>{
  if(!plain(value))return value;
  const {directory,stateDirectory,sourceFile,...rest}=value;
  return rest;
};
export class MerchantMssqlWorkspaces {
  #config;#clients=new Map();#pending=new Set();#closing=false;#close;
  constructor(config){this.#config=config;}
  get summary(){
    return {configured:Boolean(this.#config.mssqlWorkspaces),ownership:'ORIGINAL_MSSQL_WORKSPACE',
      workspaces:Object.entries(this.#config.mssqlWorkspaces?.workspaces??{}).map(([workspace,value])=>({
        workspace,workspaceId:value.workspaceId,label:value.label,
        deliveries:Object.entries(value.deliveries).map(([delivery,selected])=>({delivery,manifestSha256:selected.manifestSha256??null}))
      }))};
  }
  async #execute(name,args) {
    if(name==='merchant_mssql_workspaces')return this.summary;
    const {workspace,workspaceId,...input}=args;
    checked(workspace,ALIAS,'workspace alias');checked(workspaceId,UUID,'workspace UUID');
    const selected=this.#config.mssqlWorkspaces?.workspaces[workspace];
    need(selected&&selected.workspaceId===workspaceId,'MSSQL_WORKSPACE_NOT_CONFIGURED');
    if(!this.#clients.has(workspace))this.#clients.set(workspace,new MssqlWorkspaceClient(selected));
    const client=await this.#clients.get(workspace).selected();
    let result;
    switch(name){
      case 'merchant_mssql_status':result=await client.json('/api/info');break;
      case 'merchant_mssql_catalog':result=await client.json(input.table===undefined?'/api/catalog':query('/api/table',{name:input.table}));break;
      case 'merchant_mssql_reviews':result=await client.json(query('/api/operator/reviews',input));break;
      case 'merchant_mssql_operations':result=await client.json(query('/api/operator/operations',input));break;
      case 'merchant_mssql_operation':result=await client.json(query('/api/operator/operation',input));break;
      case 'merchant_mssql_review_load':result=await client.json(query('/api/operator/review',input));break;
      case 'merchant_mssql_review':result=await client.json('/api/review',input);break;
      case 'merchant_mssql_preview':result=await client.json('/api/preview',input);break;
      case 'merchant_mssql_prepare':result=await client.json('/api/prepare',input);break;
      case 'merchant_mssql_releases':result=await client.json(query('/api/releases',input));break;
      case 'merchant_mssql_release':result=await client.json(query('/api/release',{id:input.releaseId}));break;
      case 'merchant_mssql_stage':result=await client.json('/api/operator/stage',{...input,store:this.#config.releaseStore});break;
      case 'merchant_mssql_start':result=await client.json('/api/run',input);break;
      case 'merchant_mssql_stop':result=await client.json('/api/stop',input);break;
      case 'merchant_mssql_export':result=await client.json('/api/transfer/export',input);break;
      case 'merchant_mssql_exports':result=await client.json(query('/api/transfer/exports',input));break;
      case 'merchant_mssql_export_manifest':result=await client.json(query('/api/transfer/manifest',input));break;
      case 'merchant_mssql_export_file':result=await client.json(query('/api/transfer/file',input));break;
      case 'merchant_mssql_export_file_release':result=await client.json('/api/transfer/file-release',input);break;
      case 'merchant_mssql_receive':{
        const delivery=client.delivery(input.delivery);
        need(delivery.manifestSha256===undefined||delivery.manifestSha256===input.expectedManifestSha256,
          'MSSQL_DELIVERY_SELECTION_CHANGED',undefined,409);
        result=await client.json('/api/transfer/receive',{directory:delivery.directory,
          expectedManifestSha256:input.expectedManifestSha256,operationId:input.operationId});break;
      }
      default:throw failure('TOOL_NOT_FOUND','Unknown original SQL Server operation.');
    }
    return {workspace,workspaceId,result:compact(result)};
  }
  async call(name,args={}) {
    need(!this.#closing,'MSSQL_AGENT_CLOSING',undefined,503);
    const declaration=MSSQL_TOOL_DEFINITIONS.get(name);
    need(declaration,'TOOL_NOT_FOUND');
    exact(args,Object.keys(declaration.properties),declaration.required);
    const pending=Promise.resolve().then(()=>this.#execute(name,args));this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close(){return this.#close??=(async()=>{this.#closing=true;await Promise.allSettled([...this.#pending]);})();}
}
