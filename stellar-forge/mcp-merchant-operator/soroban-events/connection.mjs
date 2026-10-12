// MIT. Host-selected original event workspaces, watch connections and publications.
import {realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileBytes,privateSupportDirectory} from '../host-files.mjs';
import {CONNECTION_SCHEMA,ALIAS,NATIVE_ALIAS,need,plain,exact,text,checked,decode,digest} from './contracts.mjs';

const connectionKeys=['rpcUrl','network','headers','headerEnv','allowHttp','timeoutMs','maxResponseBytes'];
function rpcConnection(input,environment){
  exact(input,connectionKeys,['rpcUrl','network']);
  need(typeof input.rpcUrl==='string'&&['stellar:testnet','stellar:pubnet'].includes(input.network),
    'SOROBAN_EVENTS_CONFIGURATION_INVALID','Select the actual RPC URL and Stellar network together.');
  let url;try{url=new URL(input.rpcUrl);}catch{need(false,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Invalid RPC URL.');}
  need(!url.username&&!url.password&&!url.hash&&
    (url.protocol==='https:'||input.allowHttp===true&&url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)),
    'SOROBAN_EVENTS_CONFIGURATION_INVALID','Use the original HTTPS RPC endpoint or an explicitly enabled local HTTP source.');
  need(input.allowHttp===undefined||typeof input.allowHttp==='boolean','SOROBAN_EVENTS_CONFIGURATION_INVALID');
  need(input.headers===undefined||plain(input.headers),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
  const headers=Object.create(null);
  for(const [name,value]of Object.entries(input.headers??{})){
    need(!Object.keys(headers).some(key=>key.toLowerCase()===name.toLowerCase())&&/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(name)&&
      typeof value==='string'&&value.length<=16384&&!/[\r\n]/.test(value),
      'SOROBAN_EVENTS_CONFIGURATION_INVALID','Invalid private RPC header.');
    need(!['host','content-length','connection','transfer-encoding'].includes(name.toLowerCase()),
      'SOROBAN_EVENTS_CONFIGURATION_INVALID','The native transport selects framing headers.');
    headers[name]=value;
  }
  need(input.headerEnv===undefined||plain(input.headerEnv),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
  for(const [name,variable]of Object.entries(input.headerEnv??{})){
    need(/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(name)&&typeof variable==='string'&&
      /^[A-Za-z_][A-Za-z0-9_]*$/.test(variable)&&!Object.keys(headers).some(key=>key.toLowerCase()===name.toLowerCase()),
      'SOROBAN_EVENTS_CONFIGURATION_INVALID','Select one existing environment variable per private RPC header.');
    const value=environment[variable];
    need(typeof value==='string'&&value.length>0&&value.length<=16384&&!/[\r\n]/.test(value),
      'SOROBAN_EVENTS_CONFIGURATION_INVALID','A configured RPC header environment variable is unavailable.');
    need(!['host','content-length','connection','transfer-encoding'].includes(name.toLowerCase()),
      'SOROBAN_EVENTS_CONFIGURATION_INVALID','The native transport selects framing headers.');
    headers[name]=value;
  }
  const limits={};
  for(const [key,minimum,maximum]of [['timeoutMs',1000,300000],['maxResponseBytes',1024,256*1024*1024]]){
    if(input[key]!==undefined){
      need(Number.isSafeInteger(input[key])&&input[key]>=minimum&&input[key]<=maximum,
        'SOROBAN_EVENTS_CONFIGURATION_INVALID','Use the original RPC limit for '+key+'.');
      limits[key]=input[key];
    }
  }
  return {rpcUrl:url.href,network:input.network,headers,...limits,...(input.allowHttp===undefined?{}:{allowHttp:input.allowHttp})};
}
async function privatePath(base,value,label){
  const directory=resolve(base,text(value,label,4096));
  try{
    await privateSupportDirectory(directory);
    need(await realpath(directory)===directory,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Use original canonical private directories.');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  return directory;
}
export async function readSorobanEventsConfiguration(file,{environment=process.env}={}){
  file=resolve(text(file,'connection path',4096));
  const bytes=await fileBytes(file,1024*1024),raw=decode(bytes);
  exact(raw,['schema','workspaces','receivers'],['schema','workspaces']);
  need(raw.schema===CONNECTION_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>0&&
    Object.keys(raw.workspaces).length<=32,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Declare 1–32 original event workspaces.');
  const workspaces=Object.create(null),directories=new Set(),base=dirname(file);
  for(const [alias,input]of Object.entries(raw.workspaces)){
    checked(alias,ALIAS,'workspace alias');
    exact(input,['label','directory',...connectionKeys,'connections','publications'],['directory']);
    const directory=await privatePath(base,input.directory,'workspace directory');
    need(!directories.has(directory),'SOROBAN_EVENTS_CONFIGURATION_INVALID','Each original directory has one workspace alias.');
    directories.add(directory);
    const defaultInput=Object.fromEntries(connectionKeys.filter(key=>Object.hasOwn(input,key)).map(key=>[key,input[key]]));
    const connection=Object.keys(defaultInput).length?rpcConnection(defaultInput,environment):undefined;
    need(input.connections===undefined||plain(input.connections),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
    need(Object.keys(input.connections??{}).length<=32,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Declare at most 32 named RPC connections.');
    const connections=Object.create(null);
    for(const [name,value]of Object.entries(input.connections??{})){
      checked(name,NATIVE_ALIAS,'connection alias');
      need(name!=='default'||!connection,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Configure the default RPC connection once.');
      connections[name]=rpcConnection(value,environment);
    }
    need(input.publications===undefined||plain(input.publications),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
    need(Object.keys(input.publications??{}).length<=32,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Declare at most 32 publication destinations.');
    const publications=Object.create(null);
    for(const [name,value]of Object.entries(input.publications??{})){
      checked(name,ALIAS,'publication alias');
      exact(value,['directory','feedId','sourceId','label','description'],['directory']);
      const selected={directory:await privatePath(base,value.directory,'publication directory')};
      for(const key of ['feedId','sourceId'])if(value[key]!==undefined)selected[key]=checked(value[key],NATIVE_ALIAS,'publication '+key);
      for(const key of ['label','description'])if(value[key]!==undefined)
        selected[key]=text(value[key],'publication '+key,key==='description'?2000:200);
      publications[name]=selected;
    }
    workspaces[alias]={label:text(input.label??alias,'workspace label'),directory,
      ...(connection?{connection}:{}),connections,publications};
  }
  for(const workspace of Object.values(workspaces))for(const publication of Object.values(workspace.publications))
    need(!directories.has(publication.directory),'SOROBAN_EVENTS_CONFIGURATION_INVALID',
      'Use a separate original publication directory from the event workspaces.');
  need(raw.receivers===undefined||plain(raw.receivers),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
  const receivers=Object.create(null);
  for(const [alias,workspace]of Object.entries(raw.receivers??{})){
    checked(alias,ALIAS,'receiver alias');checked(workspace,ALIAS,'receiving workspace');
    need(Object.hasOwn(workspaces,workspace),'SOROBAN_EVENTS_CONFIGURATION_INVALID','Receivers select configured workspace aliases.');
    receivers[alias]=workspace;
  }
  return {workspaces,receivers,connectionSha256:digest(bytes)};
}
