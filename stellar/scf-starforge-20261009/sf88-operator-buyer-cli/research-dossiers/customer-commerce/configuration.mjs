// MIT. Existing merchant and Buyer application selections belong to the launcher.
import {isAbsolute,resolve,dirname} from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {readResearchHostFile} from '../workspace-files.mjs';
import {parseJson,digest} from '../../node/store.mjs';
import {compileCheckout} from '../../../sf101-merchant-receiver/checkout-config.mjs';
import {readBuyerAgentConfiguration} from '../../../buyer-runbook/agent-client.mjs';
import {plain,fields,alias,text,hash,environmentName,need,copy,fingerprint} from './contracts.mjs';
export const HOST_SCHEMA='sf88-research-customer-commerce-host/v1';
export function absolute(value,base){
 need(typeof value==='string'&&value.length>0&&value.length<=4096&&!/[\0\r\n]/.test(value),
  'RESEARCH_COMMERCE_HOST_PATH_REQUIRED');
 const path=resolve(base??process.cwd(),value);need(path!=='/','RESEARCH_COMMERCE_HOST_PATH_REQUIRED');return path;
}
async function exactFile(path,limit){
 const body=await readResearchHostFile(path,limit,{privateFile:true});
 return {path,bytes:body.length,sha256:digest(body),body,value:parseJson(body)};
}
export async function readCommerceConfiguration(path){
 if(path===null||path===undefined)return {schema:HOST_SCHEMA,path:null,merchants:{},buyers:{},sha256:null};
 path=absolute(path);const saved=await exactFile(path,1024*1024),raw=saved.value;
 fields(raw,['schema','merchants','buyers'],['schema']);
 need(raw.schema===HOST_SCHEMA,'RESEARCH_COMMERCE_HOST_CONFIGURATION_REQUIRED');
 const result={schema:HOST_SCHEMA,path,sha256:saved.sha256,merchants:Object.create(null),buyers:Object.create(null)};
 for(const kind of ['merchants','buyers']){
  const entries=raw[kind]??{};
  need(plain(entries)&&Object.keys(entries).length<=32,'RESEARCH_COMMERCE_HOST_SELECTION_LIMIT');
  for(const [id,row]of Object.entries(entries)){
   alias(id);fields(row,kind==='merchants'?['label','checkoutFile','claimEnv']:['label','agentFile','workspace'],
    kind==='merchants'?['checkoutFile']:['agentFile','workspace']);
   if(row.label!==undefined)text(row.label,160);
   result[kind][id]={label:row.label??id,...(kind==='merchants'?{
    checkoutFile:absolute(row.checkoutFile,dirname(path)),claimEnv:environmentName(row.claimEnv??'SF101_CLAIM_TOKEN')
   }:{agentFile:absolute(row.agentFile,dirname(path)),workspace:alias(row.workspace)})};
  }
 }
 return result;
}
export async function selectedMerchant(configuration,id,{environment=process.env}={}){
 alias(id);const declared=configuration.merchants[id];need(declared,'RESEARCH_COMMERCE_MERCHANT_NOT_CONFIGURED');
 const selected=await exactFile(declared.checkoutFile,131072),compiled=compileCheckout(selected.value);
 const resource=compiled.service.routes[0].offer.resource.url;
 need(new URL(resource).protocol==='https:','RESEARCH_COMMERCE_PUBLIC_HTTPS_MERCHANT_REQUIRED');
 // Normal native SF101 initialization owns these directories; selection is read-only.
 const directories=[];
 for(const path of [compiled.state,compiled.outbox]){
  const stat=await lstat(path);
  need(stat.isDirectory()&&!stat.isSymbolicLink()&&await realpath(path)===path&&
   (!process.getuid||stat.uid===process.getuid())&&(process.platform==='win32'||!(stat.mode&0o077)),
   'RESEARCH_COMMERCE_NATIVE_MERCHANT_DIRECTORY_REQUIRED');
  directories.push({path,device:String(stat.dev),inode:String(stat.ino)});
 }
 const binding={id,label:declared.label,checkoutFile:selected.path,checkoutSha256:selected.sha256,
  checkoutBytes:selected.bytes,claimEnv:declared.claimEnv,directories};
 const secret=environment[declared.claimEnv];
 return {binding,bindingSha256:fingerprint(binding),configuration:selected.value,body:selected.body,compiled,
  view:{id,label:declared.label,checkoutFile:selected.path,checkoutSha256:selected.sha256,
   routeId:compiled.context.routeId,purchaseUrl:resource,payment:copy(compiled.terms),state:compiled.state,outbox:compiled.outbox,
   claimEnv:declared.claimEnv,claimAvailable:typeof secret==='string'&&Buffer.byteLength(secret)>=32&&
    Buffer.byteLength(secret)<=1024&&!/[\x00-\x20\x7f]/.test(secret)}};
}
export async function selectedBuyer(configuration,id){
 alias(id);const declared=configuration.buyers[id];need(declared,'RESEARCH_COMMERCE_BUYER_NOT_CONFIGURED');
 const normalized=await readBuyerAgentConfiguration(declared.agentFile),definition=normalized.workspaces[declared.workspace];
 need(definition,'RESEARCH_COMMERCE_BUYER_WORKSPACE_NOT_CONFIGURED');
 // Retain only this actual selected application. Unrelated source aliases may change.
 const binding={id,label:declared.label,agentFile:declared.agentFile,workspace:declared.workspace,
  directory:definition.directory,launchFile:definition.launchFile,expectedSelectionSha256:definition.expectedSelectionSha256,
  maximumFileBytes:definition.maximumFileBytes,maximumExportBytes:definition.maximumExportBytes,
  maximumExports:definition.maximumExports,operators:copy(definition.operators)};
 return {binding,bindingSha256:fingerprint(binding),definition:copy(definition),
  view:{id,label:declared.label,directory:definition.directory,selectionSha256:definition.expectedSelectionSha256,
   maximumFileBytes:definition.maximumFileBytes,maximumExportBytes:definition.maximumExportBytes}};
}
export async function commerceConfigurationView(configuration,options={}){
 const merchants=[],buyers=[],errors=[];
 for(const id of Object.keys(configuration.merchants))try{merchants.push((await selectedMerchant(configuration,id,options)).view);}
 catch(error){errors.push({kind:'merchant',id,code:error.code??'RESEARCH_COMMERCE_MERCHANT_UNAVAILABLE'});}
 for(const id of Object.keys(configuration.buyers))try{buyers.push((await selectedBuyer(configuration,id)).view);}
 catch(error){errors.push({kind:'buyer',id,code:error.code??'RESEARCH_COMMERCE_BUYER_UNAVAILABLE'});}
 return {schema:HOST_SCHEMA,configurationFile:configuration.path,merchants,buyers,errors};
}
