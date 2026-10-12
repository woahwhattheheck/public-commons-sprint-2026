// MIT. Host-selected connections to original native MPP consoles and customer files.
import { dirname, resolve, join } from 'node:path';
import { regular, privateDirectory, digest, canonical, plain } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

export const MPP_CONNECTION_SCHEMA='stellar-forge.merchant-mpp-connection.v1';
export const MPP_REVIEW_SCHEMA='stellar-forge.merchant-mpp-customer-review.v1';
export const MAX_MPP_CHUNK_BYTES=49152;
export const stable=value=>JSON.stringify(canonical(value));
export function fail(code,message=code) {throw Object.assign(new Error(message),{code});}
export function need(value,code,message) {if(!value)fail(code,message);}
export function exact(value,allowed,required=[]) {
  need(plain(value) && Object.keys(value).every(key=>allowed.includes(key)) &&
    required.every(key=>Object.hasOwn(value,key)),'INVALID_PARAMS','Use the declared native MPP fields.');
}
export function alias(value,label='Alias') {
  need(typeof value==='string' && /^[a-z][a-z0-9_-]{0,63}$/.test(value),'INVALID_PARAMS',label+' must be a declared lowercase alias.');
  return value;
}
export function nativeId(value) {
  need(typeof value==='string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(value),'INVALID_PARAMS','Use the original native MPP purchase ID.');
  return value;
}
export function sha(value) {
  need(typeof value==='string' && /^[a-f0-9]{64}$/.test(value),'INVALID_PARAMS','Use the original SHA256.');
  return value;
}
export function label(value) {
  need(typeof value==='string' && value.length>0 && value.length<=200 && !/[\r\n\0]/.test(value),
    'CONFIGURATION_ERROR','Use a short display label.');
  return value;
}
function hostPath(value,base) {
  need(typeof value==='string' && value && !/[\0\r\n]/.test(value),'CONFIGURATION_ERROR','Use an explicit host path.');
  return resolve(base,value);
}
const decode=bytes=>JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
export function consoleOrigin(value) {
  let url;try{url=new URL(value);}catch{fail('CONFIGURATION_ERROR','Use the original loopback MPP console origin.');}
  need(typeof value==='string' && value===url.origin && url.protocol==='http:' &&
    url.hostname==='127.0.0.1' && url.port && !url.username && !url.password,
    'CONFIGURATION_ERROR','Use the original http://127.0.0.1:PORT console origin without credentials or a path.');
  return value;
}
export function publicConfiguration(value) {
  if(!value)return null;
  return {payer:value.signer?.payer,operator:{actor:value.operator?.actor,service:value.operator?.service},
    assetLimits:value.assetLimits,rpcUrl:value.rpcUrl??null,
    runtimeConfigured:Boolean(value.dependencyRoot),signerConfigured:Boolean(value.signer?.keyEnv),
    governorConfigured:Boolean(value.operator?.python && value.operator?.ledger && value.operator?.policy),
    transport:value.transport?{origin:value.transport.origin,proxyConfigured:true}:null};
}
export function workspaceIdentity(workspace,createdAt) {
  return digest(stable({schema:'stellar-forge.mpp-console-identity.v1',workspace,createdAt}));
}
export async function readMppConfiguration(path) {
  path=resolve(path);
  const bytes=await regular(path,2*1024*1024),raw=decode(bytes);
  exact(raw,['schema','consoles'],['schema','consoles']);
  need(raw.schema===MPP_CONNECTION_SCHEMA && plain(raw.consoles) &&
    Object.keys(raw.consoles).length>0 && Object.keys(raw.consoles).length<=16,
    'CONFIGURATION_ERROR','Declare one to sixteen original native MPP consoles.');
  const base=dirname(path),consoles=Object.create(null);
  for(const [key,input] of Object.entries(raw.consoles)) {
    alias(key,'Console alias');
    exact(input,['label','origin','tokenEnv','workspace','customers'],['origin','tokenEnv','workspace','customers']);
    need(typeof input.tokenEnv==='string' && /^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(input.tokenEnv),
      'CONFIGURATION_ERROR','Select the console token by its environment-variable name.');
    const workspace=await privateDirectory(hostPath(input.workspace,base));
    const metadata=decode(await regular(join(workspace,'workspace.json'),4096));
    need(metadata.schema==='stellar-forge.mpp-workspace.v1' && typeof metadata.createdAt==='string' &&
      Number.isFinite(Date.parse(metadata.createdAt)),'CONFIGURATION_ERROR','Select the original retained native MPP workspace.');
    need(plain(input.customers) && Object.keys(input.customers).length>0 && Object.keys(input.customers).length<=32,
      'CONFIGURATION_ERROR','Declare one to thirty-two customer configuration files.');
    const customers=Object.create(null);
    for(const [customer,row] of Object.entries(input.customers)) {
      alias(customer,'Customer alias');
      exact(row,['label','configuration'],['configuration']);
      const original=await regular(hostPath(row.configuration,base),2*1024*1024),configuration=decode(original);
      exact(configuration,['schema','workspace','operator','signer','dependencyRoot','assetLimits','rpcUrl','transport'],
        ['workspace','operator','signer','dependencyRoot','assetLimits']);
      need(configuration.workspace===workspace,'CONFIGURATION_ERROR','The customer file must select this original console workspace.');
      customers[customer]={label:label(row.label??customer),configuration,
        configurationSha256:digest(original)};
    }
    consoles[key]={label:label(input.label??key),origin:consoleOrigin(input.origin),tokenEnv:input.tokenEnv,
      workspace,createdAt:metadata.createdAt,identity:workspaceIdentity(workspace,metadata.createdAt),customers};
  }
  return {schema:MPP_CONNECTION_SCHEMA,selectionSha256:digest(bytes),consoles};
}
