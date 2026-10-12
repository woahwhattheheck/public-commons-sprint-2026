// MIT. API-pass customer workspace configuration; original Buyer and SF101 own execution authority.
import {fileURLToPath} from 'node:url';
import {join,resolve,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {BuyerError,object,need,readJson,writeJson,privateDirectory} from '../../../sf88-operator-buyer-cli/node/store.mjs';

export const CONFIG_SCHEMA='stellar-forge.sf101.api-pass-workspace-config.v1';
export const STATE_SCHEMA='stellar-forge.sf101.api-pass-workspace.v1';
export const LAUNCH_SCHEMA='stellar-forge.sf101.api-pass-workspace-launch.v1';
export const MAX_BODY_BYTES=1024*1024;
export const MAX_RESULT_BYTES=4*1024*1024;
export const MAX_PROFILES=200;
export const MAX_CALLS=5000;
export const MAX_TASKS=10000;
export const ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const HASH=/^[a-f0-9]{64}$/;
export const now=()=>new Date().toISOString();
export const clone=value=>structuredClone(value);
export const digest=value=>createHash('sha256').update(value).digest('hex');
export const canonical=value=>Array.isArray(value)?value.map(canonical):object(value)?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const fingerprint=value=>digest(JSON.stringify(canonical(value)));
export const fail=(code,status=400)=>{throw Object.assign(new BuyerError(code),{status});};
export const check=(condition,code,status=400)=>{if(!condition)fail(code,status);};
export function absolute(value){
 check(typeof value==='string'&&isAbsolute(value)&&resolve(value)===value&&value!=='/'&&!value.includes('\0'),'ABSOLUTE_NORMALIZED_PRIVATE_PATH_REQUIRED');
 return value;
}
export function label(value,max=160,optional=false){
 check(typeof value==='string'&&value.trim().length<=max&&(optional||value.trim().length>0)&&!/[\u0000-\u001f\u007f]/.test(value),'INVALID_WORKSPACE_LABEL');
 return value.trim();
}
export function gatewayOrigin(value){
 check(typeof value==='string','API_GATEWAY_ORIGIN_REQUIRED');
 let url;try{url=new URL(value);}catch{fail('API_GATEWAY_ORIGIN_REQUIRED');}
 check(!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'&&
  (url.protocol==='https:'||url.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)),
  'HTTPS_OR_LOOPBACK_GATEWAY_REQUIRED');
 return url.origin;
}
export function claimName(value){
 check(typeof value==='string'&&/^[A-Z][A-Z0-9_]{1,64}$/.test(value),'INVALID_CLAIM_ENV');return value;
}
export function compileConfig(value){
 check(object(value)&&value.schema===CONFIG_SCHEMA,'API_PASS_WORKSPACE_CONFIG_REQUIRED');
 const directory=absolute(value.directory);
 const runtimeDirectory=absolute(value.runtimeDirectory??fileURLToPath(new URL('../../../sf88-operator-buyer-cli/',import.meta.url)).replace(/\/$/,''));
 const buyerStateDirectory=absolute(value.buyerStateDirectory??join(directory,'buyer'));
 const inboxDirectory=absolute(value.inboxDirectory??join(directory,'purchase-inbox'));
 const buyerWorkspace=value.buyerWorkspace===undefined||value.buyerWorkspace===null?null:absolute(value.buyerWorkspace);
 check(directory!==runtimeDirectory&&directory!==buyerStateDirectory&&directory!==inboxDirectory,'WORKSPACE_AUTHORITY_DIRECTORIES_MUST_DIFFER');
 if(buyerWorkspace!==null)check(directory!==buyerWorkspace&&!directory.startsWith(buyerWorkspace+'/'),'ORIGINAL_BUYER_WORKSPACE_MUST_BE_SEPARATE');
 const claimEnvs=value.claimEnvs??['SF101_CLAIM_TOKEN'];
 check(Array.isArray(claimEnvs)&&claimEnvs.length>0&&claimEnvs.length<=32,'CLAIM_ENV_LIST_REQUIRED');
 const names=[...new Set(claimEnvs.map(claimName))];
 const python=value.python??process.env.STARFORGE_PYTHON??'python3';
 check(typeof python==='string'&&python.length>0&&python.length<=4096&&!python.includes('\0'),'PYTHON_EXECUTABLE_REQUIRED');
 return Object.freeze({schema:CONFIG_SCHEMA,directory,runtimeDirectory,buyerStateDirectory,inboxDirectory,buyerWorkspace,
  claimEnvs:Object.freeze(names),python,title:label(value.title??'API passes')});
}
export function authority(config){
 return {runtimeDirectory:config.runtimeDirectory,buyerStateDirectory:config.buyerStateDirectory,inboxDirectory:config.inboxDirectory,buyerWorkspace:config.buyerWorkspace};
}
export async function readConfig(path){return compileConfig(await readJson(absolute(path),65536));}
export async function writeConfig(path,input){
 const config=compileConfig(input);await privateDirectory(absolute(path).slice(0,absolute(path).lastIndexOf('/')));
 await writeJson(path,config,{exclusive:true});return config;
}
export function allowedClaim(config,value){const name=claimName(value);check(config.claimEnvs.includes(name),'CLAIM_ENV_NOT_CONFIGURED',403);return name;}
export function inputBytes(value){
 check(value===null||typeof value==='string','BASE64_REQUEST_BODY_REQUIRED');
 if(value===null)return null;
 check(value.length<=Math.ceil(MAX_BODY_BYTES/3)*4,'REQUEST_TOO_LARGE',413);
 const body=Buffer.from(value,'base64');
 check(body.length<=MAX_BODY_BYTES&&body.toString('base64')===value,'CANONICAL_BASE64_REQUEST_BODY_REQUIRED');
 return body;
}
export function queryPairs(value=[]){
 check(Array.isArray(value)&&value.length<=100,'QUERY_PAIRS_REQUIRED');
 const pairs=value.map(row=>{
  check(Array.isArray(row)&&row.length===2&&row.every(part=>typeof part==='string'&&part.length<=4096&&!part.includes('\0')),'QUERY_PAIRS_REQUIRED');
  return [...row];
 });
 check(Buffer.byteLength(JSON.stringify(pairs))<=32768,'QUERY_INPUT_TOO_LARGE');return pairs;
}
export function requestId(value){check(typeof value==='string'&&ID.test(value),'STABLE_REQUEST_ID_REQUIRED');return value;}
export function uuid(value){check(typeof value==='string'&&UUID.test(value),'WORKSPACE_ID_REQUIRED');return value;}
export function contentType(value='application/octet-stream'){
 check(typeof value==='string'&&value.length>0&&value.length<=255&&/^[\x20-\x7e]+$/.test(value),'INVALID_CONTENT_TYPE');return value;
}
