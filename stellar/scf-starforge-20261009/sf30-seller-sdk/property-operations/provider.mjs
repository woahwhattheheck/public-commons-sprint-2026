// MIT. Source-owned agent attachment to the original Socrata Property Operations owner.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {propertyWorkspaceTools} from '../../../../stellar-forge/mcp-merchant-operator/catalog/property-workspace.mjs';
import {createPropertyOperationsClient,readPropertyConnection,PropertyClientError} from './client.mjs';
export const PROPERTY_CONNECTION_SCHEMA='stellar-forge.property-workspaces.v1';
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,ENV=/^[A-Za-z_][A-Za-z0-9_]*$/,HASH=/^[a-f0-9]{64}$/;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const fail=(code,message)=>Object.assign(new Error(message),{code});
const need=(ok,message)=>{if(!ok)throw fail('PROPERTY_CONFIGURATION',message);};
const exact=(value,keys,required=[])=>need(object(value)&&Object.keys(value).every(k=>keys.includes(k))&&required.every(k=>Object.hasOwn(value,k)),'Supply only the complete declared configuration fields.');
function text(value,label,max=4096) {
  need(typeof value==='string'&&value.trim()&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value),'Use a nonempty '+label+'.');return value;
}
async function privateJSON(file) {
  const h=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const s=await h.stat();need(s.isFile()&&s.size<=1024*1024&&
      (process.platform==='win32'||(s.mode&0o077)===0&&(!process.getuid||s.uid===process.getuid())),'Use a private, owned JSON configuration file.');
    const raw=await h.readFile();need(raw.length<=1024*1024,'The complete configuration exceeds 1 MiB.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }finally{await h.close();}
}
export async function readPropertyWorkspaceConfiguration(file) {
  file=resolve(file);const raw=await privateJSON(file);
  exact(raw,['schema','workspaces','files'],['schema','workspaces']);
  need(raw.schema===PROPERTY_CONNECTION_SCHEMA&&object(raw.workspaces)&&Object.keys(raw.workspaces).length>0&&Object.keys(raw.workspaces).length<=32,'Declare 1–32 original workspaces.');
  const workspaces=Object.create(null),files=Object.create(null);
  for(const [alias,v]of Object.entries(raw.workspaces)) {
    need(ALIAS.test(alias),'Use an original workspace alias.');
    exact(v,['label','directory','urlFile','urlEnv','expectedCreatedAt','expectedPropertyId','timeoutMs'],['directory','expectedCreatedAt']);
    need((v.urlFile===undefined)!==(v.urlEnv===undefined),'Choose one existing private URL file or environment reference.');
    if(v.urlEnv!==undefined)need(ENV.test(v.urlEnv),'Use the selected URL environment variable name.');
    need(typeof v.expectedCreatedAt==='string'&&Number.isFinite(Date.parse(v.expectedCreatedAt)),'Retain the original immutable outer createdAt value.');
    if(v.expectedPropertyId!==undefined)need(v.expectedPropertyId===null||/^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/.test(v.expectedPropertyId),'Use the original property identity.');
    need(v.timeoutMs===undefined||Number.isSafeInteger(v.timeoutMs)&&v.timeoutMs>=1&&v.timeoutMs<=3600000,'Timeout must be 1–3600000 milliseconds.');
    workspaces[alias]={label:text(v.label??alias,'workspace label',256),directory:resolve(dirname(file),text(v.directory,'original workspace directory')),
      ...(v.urlFile===undefined?{urlEnv:v.urlEnv}:{urlFile:resolve(dirname(file),text(v.urlFile,'original connection file'))}),
      expectedCreatedAt:v.expectedCreatedAt,expectedPropertyId:v.expectedPropertyId??null,timeoutMs:v.timeoutMs??300000};
  }
  need(raw.files===undefined||object(raw.files)&&Object.keys(raw.files).length<=1000,'Declare at most 1000 original property input files.');
  for(const [alias,v]of Object.entries(raw.files??{})) {
    need(ALIAS.test(alias),'Use a host file alias.');exact(v,['path','bytes','sha256','label'],['path','bytes','sha256']);
    need(Number.isSafeInteger(v.bytes)&&v.bytes>=0&&v.bytes<=64*1024*1024&&HASH.test(v.sha256),'Retain the complete original input byte count and SHA-256.');
    files[alias]={path:resolve(dirname(file),text(v.path,'original host file')),bytes:v.bytes,sha256:v.sha256,label:text(v.label??alias,'file label',256)};
  }
  return {schema:PROPERTY_CONNECTION_SCHEMA,workspaces,files};
}
/** Complete-file verification is performed again immediately before native import invocation. */
export async function verifyPropertyHostFile(configuration,alias,{bytes,sha256}={}) {
  const selected=configuration?.files?.[alias];
  if(!selected||selected.bytes!==bytes||selected.sha256!==sha256)
    throw fail('PROPERTY_HOST_FILE_CHANGED','Select the declared original file alias and its exact byte/hash identity.');
  const h=await open(selected.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before=await h.stat({bigint:true}),signature=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode].join(':');
    need(before.isFile()&&before.size===BigInt(bytes),'The selected complete host file changed.');
    const hash=createHash('sha256'),buffer=Buffer.alloc(256*1024);let offset=0;
    while(offset<bytes){const part=await h.read(buffer,0,Math.min(buffer.length,bytes-offset),offset);
      need(part.bytesRead>0,'The original host file ended early.');hash.update(buffer.subarray(0,part.bytesRead));offset+=part.bytesRead;}
    need(hash.digest('hex')===sha256&&signature(await h.stat({bigint:true}))===signature(before),'The complete original host file changed while reading.');
    return {...selected,alias};
  }finally{await h.close();}
}
export class PropertyWorkspaceConnections {
  #config;#identities=new Map();#pending=new Set();#closing=false;#closePromise;
  constructor(config){this.#config=config;}
  get configuration(){return this.#config.propertyWorkspaces;}
  get summary(){
    return {configured:Boolean(this.configuration),closing:this.#closing,
      workspaces:Object.entries(this.configuration?.workspaces??{}).map(([workspace,v])=>({
        workspace,label:v.label,createdAt:v.expectedCreatedAt,propertyId:this.#identities.get(workspace)??v.expectedPropertyId,
        connection:v.urlFile?'ORIGINAL_PRIVATE_FILE':'ORIGINAL_PRIVATE_ENVIRONMENT'})),
      files:Object.entries(this.configuration?.files??{}).map(([alias,v])=>({alias,label:v.label,bytes:v.bytes,sha256:v.sha256}))};
  }
  async #connection(alias){
    if(typeof alias!=='string'||!ALIAS.test(alias))throw fail('INVALID_PARAMS','Select an original configured workspace alias.');
    const selected=this.configuration?.workspaces?.[alias];
    if(!selected)throw fail('PROPERTY_WORKSPACE_NOT_CONFIGURED','Choose a workspace from merchant_property_workspaces.');
    const launch=selected.urlFile?await readPropertyConnection(selected.urlFile):{url:process.env[selected.urlEnv]};
    if(launch.createdAt!==undefined&&launch.createdAt!==selected.expectedCreatedAt)
      throw fail('PROPERTY_WORKSPACE_CHANGED','The private launch file names another original workspace.');
    const client=createPropertyOperationsClient({url:launch.url,expectedCreatedAt:selected.expectedCreatedAt,
      expectedPropertyId:this.#identities.get(alias)??selected.expectedPropertyId,timeoutMs:selected.timeoutMs});
    try {const state=await client.status();if(state.property.id!==null)this.#identities.set(alias,state.property.id);
      return {client,state,selected};}
    catch(error){try{await client.close();}catch(closeError){error.closeError=closeError;}throw error;}
  }
  withWorkspace(alias,callback){
    if(this.#closing)return Promise.reject(fail('PROPERTY_WORKSPACES_CLOSING','Finish closing this borrowed agent attachment.'));
    const job=Promise.resolve().then(async()=>{
      const bound=await this.#connection(alias);let originalError;
      try{return await callback(bound);}
      catch(error){originalError=error;if(error instanceof PropertyClientError)error.details={
        status:error.status,action:error.action,key:error.key,uncertain:error.uncertain,result:error.result};
        throw error;}
      finally{
        if(bound.client.propertyId!==null)this.#identities.set(alias,bound.client.propertyId);
        try{await bound.client.close();}catch(error){if(originalError)originalError.closeError=error;else throw error;}
      }
    });
    this.#pending.add(job);job.then(()=>this.#pending.delete(job),()=>this.#pending.delete(job));return job;
  }
  close(){this.#closing=true;return this.#closePromise??=Promise.allSettled([...this.#pending]).then(()=>undefined);}
}
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'property-workspaces',family:'propertyWorkspaces',title:'Property Operations',
  order:1140,catalogOrder:1140,configKey:'propertyWorkspaces',summary:true,dependencies:[],concurrency:'provider',maxRequestBytes:2*1024*1024,
  configuration:{input:'propertyWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>readPropertyWorkspaceConfiguration(hostPath(value))},
  tools:propertyWorkspaceTools,
  instructions:[{order:1140,prefix:'merchant_property_',text:'Use the original property workspace and complete saved native request. Prepare with one key, retain the returned envelope, then invoke. Read the original operation after a lost response. An issued vendor request is recovered from retained evidence, never automatically resent. Original source exports, property resources, publisher reviews/releases and customer sessions remain native. File aliases are host-selected; vendor credential values never belong in tool inputs.'}],
  load:()=>import('../../../../stellar-forge/mcp-merchant-operator/property-workspace.mjs'),
  create:(module,config)=>new module.MerchantPropertyWorkspaces(config),
  initialize:options=>import('./initialize.mjs').then(m=>m.initializePropertyWorkspaceMerchant(options)),
});
