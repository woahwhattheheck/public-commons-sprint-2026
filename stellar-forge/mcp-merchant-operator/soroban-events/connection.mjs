// MIT. Host-selected original event workspaces and receive destinations.
import {realpath} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileBytes,privateSupportDirectory} from '../host-files.mjs';
import {CONNECTION_SCHEMA,ALIAS,need,plain,exact,text,checked,decode,digest} from './contracts.mjs';

export async function readSorobanEventsConfiguration(file,{environment=process.env}={}){
  file=resolve(text(file,'connection path',4096));
  const bytes=await fileBytes(file,1024*1024),raw=decode(bytes);
  exact(raw,['schema','workspaces','receivers'],['schema','workspaces']);
  need(raw.schema===CONNECTION_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>0&&
    Object.keys(raw.workspaces).length<=32,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Declare 1–32 original event workspaces.');
  const workspaces=Object.create(null),directories=new Set(),base=dirname(file);
  for(const [alias,input]of Object.entries(raw.workspaces)){
    checked(alias,ALIAS,'workspace alias');
    exact(input,['label','directory','rpcUrl','network','headers','headerEnv','allowHttp'],['directory']);
    const directory=resolve(base,text(input.directory,'workspace directory',4096));
    let canonical=directory;
    try{await privateSupportDirectory(directory);canonical=await realpath(directory);
      need(canonical===directory,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Use each original canonical workspace directory.');}
    catch(error){if(error.code!=='ENOENT')throw error;}
    need(!directories.has(canonical),'SOROBAN_EVENTS_CONFIGURATION_INVALID','Each original directory has one workspace alias.');
    directories.add(canonical);
    let connection;
    if(input.rpcUrl!==undefined||input.network!==undefined){
      need(typeof input.rpcUrl==='string'&&['stellar:testnet','stellar:pubnet'].includes(input.network),
        'SOROBAN_EVENTS_CONFIGURATION_INVALID','Select the actual RPC URL and Stellar network together.');
      let url;try{url=new URL(input.rpcUrl);}catch{need(false,'SOROBAN_EVENTS_CONFIGURATION_INVALID','Invalid RPC URL.');}
      need(!url.username&&!url.password&&!url.hash&&
        (url.protocol==='https:'||input.allowHttp===true&&url.protocol==='http:'),
        'SOROBAN_EVENTS_CONFIGURATION_INVALID','Use the original HTTPS RPC endpoint or an explicitly enabled local HTTP source.');
      need(input.allowHttp===undefined||typeof input.allowHttp==='boolean','SOROBAN_EVENTS_CONFIGURATION_INVALID');
      need(input.headers===undefined||plain(input.headers),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
      const headers=Object.create(null);
      for(const [name,value]of Object.entries(input.headers??{})){
        need(!Object.keys(headers).some(key=>key.toLowerCase()===name.toLowerCase())&&/^[!#$%&'*+\-.^_\x60|~0-9A-Za-z]+$/.test(name)&&
          typeof value==='string'&&value.length<=16384&&!/[\r\n]/.test(value),
          'SOROBAN_EVENTS_CONFIGURATION_INVALID','Invalid private RPC header.');
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
        headers[name]=value;
      }
      connection={rpcUrl:url.href,network:input.network,headers,...(input.allowHttp===undefined?{}:{allowHttp:input.allowHttp})};
    }else need(input.headers===undefined&&input.headerEnv===undefined&&input.allowHttp===undefined,
      'SOROBAN_EVENTS_CONFIGURATION_INVALID','RPC options require the original endpoint and network.');
    workspaces[alias]={label:text(input.label??alias,'workspace label'),directory:canonical,...(connection?{connection}:{})};
  }
  need(raw.receivers===undefined||plain(raw.receivers),'SOROBAN_EVENTS_CONFIGURATION_INVALID');
  const receivers=Object.create(null);
  for(const [alias,workspace]of Object.entries(raw.receivers??{})){
    checked(alias,ALIAS,'receiver alias');checked(workspace,ALIAS,'receiving workspace');
    need(Object.hasOwn(workspaces,workspace),'SOROBAN_EVENTS_CONFIGURATION_INVALID','Receivers select configured workspace aliases.');
    receivers[alias]=workspace;
  }
  return {workspaces,receivers,connectionSha256:digest(bytes)};
}
