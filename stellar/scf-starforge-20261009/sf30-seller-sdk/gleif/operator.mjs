// SPDX-License-Identifier: MIT
import { dirname,resolve } from 'node:path';
import { readJson,absolute,object } from '../postgres/publisher/files.mjs';
import { GleifClient } from './client.mjs';
import { SCHEMA,need } from './core.mjs';
import { ACTION_TOOLS } from './operator-tools.mjs';
export { gleifMerchantTools } from './operator-tools.mjs';
export const OPERATOR_SCHEMA=SCHEMA+'.operator';
const alias=value=>need(typeof value==='string'&&/^[a-z0-9][a-z0-9_-]{0,63}$/.test(value),'GLEIF_ALIAS');
export async function readGleifOperatorConfiguration(path) {
  path=absolute(path);const value=await readJson(path);need(value.schema===OPERATOR_SCHEMA&&object(value.workspaces)&&Object.keys(value.workspaces).length>0,'GLEIF_OPERATOR_CONFIGURATION');
  const workspaces=Object.create(null);
  for(const[name,entry]of Object.entries(value.workspaces)){alias(name);need(object(entry)&&typeof entry.connectionFile==='string'&&typeof entry.workspaceId==='string'&&/^[a-f0-9]{64}$/.test(entry.workspaceIdentity??''),'GLEIF_OPERATOR_BINDING');
    workspaces[name]={connectionFile:absolute(resolve(dirname(path),entry.connectionFile)),workspaceId:entry.workspaceId,workspaceIdentity:entry.workspaceIdentity,label:entry.label??name};}
  return {schema:OPERATOR_SCHEMA,workspaces};
}
export class MerchantGleif {
  constructor(config){need(config?.schema===OPERATOR_SCHEMA,'GLEIF_OPERATOR_CONFIGURATION');this.config=config;this.clients=new Map();this.closed=false;}
  get summary(){return {schema:OPERATOR_SCHEMA,workspaces:Object.entries(this.config.workspaces).map(([workspace,v])=>({workspace,label:v.label,workspaceId:v.workspaceId,connected:this.clients.has(workspace),instanceId:this.clients.get(workspace)?.binding.instanceId??null}))};}
  async call(name,args={}) {
    need(!this.closed&&object(args),'GLEIF_OPERATOR_CLOSED');
    if(name==='merchant_gleif_workspaces')return this.summary;
    alias(args.workspace);const selected=this.config.workspaces[args.workspace];need(selected,'GLEIF_ALIAS_NOT_FOUND');
    if(name==='merchant_gleif_connect'){
      let client=this.clients.get(args.workspace);if(client)await client.verify();
      else{client=await GleifClient.connect(selected.connectionFile);try{need(client.binding.workspaceId===selected.workspaceId&&client.binding.workspaceIdentity===selected.workspaceIdentity,'GLEIF_OPERATOR_BINDING_CHANGED');need(!this.closed,'GLEIF_OPERATOR_CLOSED');this.clients.set(args.workspace,client);}catch(error){client.close();throw error;}}
      return {workspace:args.workspace,workspaceId:client.binding.workspaceId,instanceId:client.binding.instanceId,sourceSha256:client.binding.sourceIdentity?.sha256};
    }
    const client=this.clients.get(args.workspace);need(client&&client.binding.instanceId===args.instanceId,'GLEIF_CURRENT_CONNECTION','Connect to the original current project instance.',409);
    if(name==='merchant_gleif_disconnect'){client.close();this.clients.delete(args.workspace);return {workspace:args.workspace,disconnected:true};}
    const {workspace,instanceId,requestId,expectedRevision,...input}=args;
    if(ACTION_TOOLS[name])return client.start({id:requestId,action:ACTION_TOOLS[name],input,...(expectedRevision===undefined?{}:{expectedRevision})});
    if(name==='merchant_gleif_status')return client.status();
    if(name==='merchant_gleif_rows')return client.rows(input.captureId,{...(input.offset===undefined?{}:{offset:input.offset}),...(input.limit===undefined?{}:{limit:input.limit}),...(input.search===undefined?{}:{search:input.search})});
    if(name==='merchant_gleif_compare')return client.compare(input.before,input.after);
    if(name==='merchant_gleif_monitoring_preview')return client.monitoringPreview(input);
    if(name==='merchant_gleif_operation')return client.operation(input.id);
    if(name==='merchant_gleif_resume'){const record=await client.operation(input.id);return client.start({id:record.id,action:record.action,input:record.input});}
    if(name==='merchant_gleif_pause')return client.pause(input.id);
    if(name==='merchant_gleif_query')return client.query(input.id,input.query??'');
    if(name==='merchant_gleif_project_file')return client.packageFile();
    if(name==='merchant_gleif_file'){need(input.limit===undefined||input.limit<=65536,'GLEIF_FILE_CHUNK');return client.chunk(input.sha256,input.offset??0,input.limit??65536);}
    need(false,'GLEIF_TOOL','Choose a registered company research operation.');
  }
  close(){this.closed=true;for(const client of this.clients.values())client.close();this.clients.clear();}
}
