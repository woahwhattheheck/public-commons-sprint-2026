// MIT. BIM public configuration and provider registry contract.
import {need,object,keys,clone,canonical,text,identity} from './value.mjs';
export const EDITION='bim-stellar-operations-20261013';
export const stamp=()=>new Date().toISOString();
export function frozen(value){const v=clone(value);const walk=x=>{if(x&&typeof x==='object'){for(const child of Object.values(x))walk(child);Object.freeze(x);}return x;};return walk(v);}
function url(value){const u=new URL(text(value,8192));need(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password&&!u.hash,'PUBLIC_URL_REQUIRED');return u.href;}
function publicTree(value){canonical(value);if(value&&typeof value==='object')for(const [k,v]of Object.entries(value)){need(!/^(secret|secretKey|apiKey|api_key|accessToken|sessionToken|refreshToken|privateKey|authorization|password|cookie)$/i.test(k),'SERVER_SECRET_MUST_USE_ALIAS',{field:k});publicTree(v);}return value;}
export function normalizeConfig(input){
 keys(input,['name','network','wallet','providers','executionEnabled'],[]);const c=clone(input);c.name=c.name??'BIM workspace';text(c.name,500);c.executionEnabled=c.executionEnabled===true;
 if(c.network){keys(c.network,['id','kind','chainId','rpcUrl','horizonUrl','passphrase'],['id','kind']);text(c.network.id,200);need(['stellar','evm'].includes(c.network.kind),'NETWORK_KIND');for(const k of ['rpcUrl','horizonUrl'])if(c.network[k])url(c.network[k]);if(c.network.chainId!==undefined)text(c.network.chainId,100);if(c.network.passphrase!==undefined)text(c.network.passphrase,1000);}
 if(c.wallet){keys(c.wallet,['address','networkId','provider'],['address','networkId']);text(c.wallet.address,500);text(c.wallet.networkId,200);if(c.wallet.provider)text(c.wallet.provider,100);}
 c.providers??={};need(object(c.providers),'PROVIDERS_REQUIRED');
 for(const [id,p]of Object.entries(c.providers)){text(id,100);keys(p,['baseUrl','credentialAlias','environment','contractIds','publicConfig'],[]);if(p.baseUrl)url(p.baseUrl);if(p.credentialAlias)need(/^[a-zA-Z0-9._:-]{1,200}$/.test(p.credentialAlias),'CREDENTIAL_ALIAS_REQUIRED');if(p.environment)text(p.environment,100);if(p.contractIds){need(object(p.contractIds),'CONTRACT_IDS_REQUIRED');for(const v of Object.values(p.contractIds))text(v,500);}if(p.publicConfig)publicTree(p.publicConfig);}
 return c;
}
export function registry(adapters){
 need(Array.isArray(adapters),'PROVIDER_ADAPTERS_REQUIRED');const actions=new Map(),catalogue=[];
 for(const adapter of adapters){need(typeof adapter?.execute==='function','ADAPTER_EXECUTE_REQUIRED');for(const original of adapter.catalogue??adapter.actions??[]){const d=clone(original);text(d.id,200);need(!actions.has(d.id)&&['read','prepare','external-write','local'].includes(d.mode),'ACTION_DESCRIPTOR_REQUIRED',{id:d.id});need(d.mode!=='external-write'||typeof adapter.prepare==='function','EXTERNAL_ACTION_PREPARE_REQUIRED');canonical(d);catalogue.push(d);actions.set(d.id,{descriptor:d,adapter});}}
 return {adapters,catalogue:frozen(catalogue),sha256:identity(catalogue),get(id){const row=actions.get(id);need(row,'ACTION_NOT_FOUND',{actionId:id});return row;}};
}
export function allowedOrigins(config,descriptor){const out=new Set(descriptor.origins??[]);for(const v of [config.network?.rpcUrl,config.network?.horizonUrl,...Object.values(config.providers??{}).map(p=>p.baseUrl)])if(v)out.add(new URL(v).origin);return out;}
export function errorRecord(error,{redact=value=>value,exchangeIds=[]}={}){
 const code=typeof error?.code==='string'&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.code)?error.code:'OPERATION_FAILED';
 const selected=typeof error?.publicMessage==='string'?error.publicMessage:code;
 const message=redact(selected).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g,' ').slice(0,8000);
 return {code,message,details:{exchangeIds:[...new Set(exchangeIds)]}};
}
export function methodEnvelope(e){keys(e,['requestId','expectedRevision','method','args']);need(typeof e.requestId==='string'&&/^[a-zA-Z0-9._:-]{1,200}$/.test(e.requestId),'REQUEST_ID_REQUIRED');need(Number.isSafeInteger(e.expectedRevision)&&e.expectedRevision>=0,'REVISION_REQUIRED');text(e.method,100);need(object(e.args),'ARGS_REQUIRED');canonical(e);return e;}
