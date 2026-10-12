// MIT. Original Woo merchant inside the existing retained Applications lifecycle.
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { inspectMerchantRuntime } from '../../sf46-release/runtime-package.mjs';
import { inspectDeliveryLease } from '../../sf98-merchant-delivery/delivery-lock.mjs';
import { readBytes, parse, sha256 } from '../../sf102-cube-paid-query-adapter/onboarding/files.mjs';
import { absolute, need, plain } from './storage.mjs';
import { APPLICATION_PROVIDER_SCHEMA, observeApplicationStartup } from './application-provider.mjs';

const SOURCE='stellar/scf-starforge-20261009/sf104-woocommerce-merchant-bridge/';
const STARTUP='stellar-forge.sf104.managed-startup.v1';
const LAUNCH='woo-managed-launch.json',BINDING='woo-managed-binding.json';
const HASH=/^[a-f0-9]{64}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const same=(a,b)=>hash(a)===hash(b);
const field=(name,label,type='path',required=false,description='')=>({name,label,type,required,description});
export function wooApplication(common) {
  return {id:'woo-merchant',command:'woo-managed',title:'WooCommerce merchant',terminal:false,
    requiredSource:SOURCE+'managed.mjs',
    description:'Run the original Woo seller and its exclusive settlement-notice worker together. Reopen the same outbox, inspect fulfillment, and manage orders and refunds in WordPress.',
    fields:[
      field('merchantConfig','Original Woo merchant configuration','path',true,
        'Select merchant.json from the original setup packet. It retains fixed routes or exported basket catalogs and the original outbox.'),
      field('facilitator','Original native facilitator','text',true,
        'Use the merchant’s existing credential-free HTTPS facilitator URL.'),
      field('sellerPort','Seller ingress port','port',false,
        'Set the loopback port selected by your existing HTTPS ingress. Zero selects a currently available port.'),
      field('allowLocalFacilitator','Use an explicit local development facilitator','boolean',false,
        'Allows only http://127.0.0.1. This identifies a local development service, not a public-chain execution.'),
      ...common,
    ]};
}
function navOrigin(raw) {
  if(raw===undefined||raw===null)return null;
  let url;try{url=new URL(raw);}catch{need(false,'APPLICATION_WOO_NAVIGATION_INVALID');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.origin===raw&&
    url.pathname==='/'&&!url.search&&!url.hash&&!url.username&&!url.password&&
    Number(url.port||80)>0&&Number(url.port||80)<=65535,
    'APPLICATION_WOO_NAVIGATION_INVALID','Use the actual original loopback Applications origin');
  return url.origin;
}
export async function prepareWooApplication(settings,{inputPath,runtimeDirectory,
  applicationEnvironment,navigationOrigin=null}={}) {
  const runtime=await inspectMerchantRuntime(runtimeDirectory,{load:false});
  const modulePath=join(runtime.sourceRoot,SOURCE,'managed.mjs');
  const inputs=[await inputPath(modulePath,'file'),await inputPath(settings.merchantConfig,'file')];
  const original=await import(pathToFileURL(modulePath).href);
  const reviewed=await original.reviewWooManaged({configFile:settings.merchantConfig,
    facilitator:settings.facilitator,allowLocalFacilitator:settings.allowLocalFacilitator===true});
  const config=inputs[1];
  need(config.sha256===reviewed.selection.configSha256,'APPLICATION_WOO_CONFIG_CHANGED');
  const outbox=await inputPath(reviewed.selection.outbox,'directory',true,true);
  inputs.push(outbox);
  const retained=new Set(inputs.map(item=>item.path));
  for(const source of reviewed.source.files) {
    const path=resolve(runtime.sourceRoot,SOURCE,source.path);
    if(retained.has(path))continue;
    const file=await inputPath(path,'file');
    need(file.sha256===source.sha256,'APPLICATION_WOO_SOURCE_CHANGED');
    inputs.push(file);retained.add(path);
  }
  if(reviewed.binding)inputs.push(await inputPath(reviewed.binding.path,'file',false,true));
  const environment=await applicationEnvironment(settings.environmentFile);
  const secret=environment.environment[reviewed.selection.secretEnv];
  need(typeof secret==='string'&&Buffer.byteLength(secret)>=32&&Buffer.byteLength(secret)<=1024,
    'APPLICATION_WOO_SECRET_REQUIRED','Set '+reviewed.selection.secretEnv+' in the selected private environment file or existing host environment');
  const sellerPort=settings.sellerPort??0;
  need(Number.isSafeInteger(sellerPort)&&sellerPort>=0&&sellerPort<=65535,'APPLICATION_WOO_SELLER_PORT_INVALID');
  const args=['serve','--config',settings.merchantConfig,'--facilitator',reviewed.selection.facilitator,
    '--seller-port',String(sellerPort),'--expected-config-sha256',reviewed.selection.configSha256,
    '--expected-source-sha256',reviewed.source.sha256,
    '--expected-selection-sha256',hash(reviewed.selection)];
  if(settings.allowLocalFacilitator===true)args.push('--allow-local-facilitator');
  const origin=navOrigin(navigationOrigin);
  if(origin)args.push('--operations-navigation-origin',origin);
  return {args,inputs,createDirectories:outbox.exists?[]:[outbox.path],
    resourceKey:hash({family:'woo-merchant',outbox:outbox.path}),
    identity:{...reviewed.selection,source:reviewed.source,
      originalOutboxBinding:reviewed.binding?.value.id??null,navigationOrigin:origin}};
}
function option(request,name,optional=false) {
  need(Array.isArray(request.args)&&request.args[0]==='serve','APPLICATION_WOO_STARTUP_CHANGED');
  const matches=request.args.flatMap((value,index)=>value===name?[index]:[]);
  if(optional&&!matches.length)return null;
  need(matches.length===1&&typeof request.args[matches[0]+1]==='string','APPLICATION_WOO_STARTUP_CHANGED');
  return request.args[matches[0]+1];
}
function local(raw,port,{path='/',fragment=false}={}) {
  let url;try{url=new URL(raw);}catch{need(false,'APPLICATION_WOO_LISTENER_CHANGED');}
  need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&!url.username&&!url.password&&!url.search&&
    url.pathname===path&&(fragment?/^#[A-Za-z0-9_-]+$/.test(url.hash):!url.hash)&&
    Number(url.port||80)>0&&Number(url.port||80)<=65535&&
    (port===0||Number(url.port||80)===port),'APPLICATION_WOO_LISTENER_CHANGED');
  return url.href;
}
async function privateJson(path) {
  return parse(await readBytes(absolute(path),{max:65536,privateFile:true}),'original Woo managed record');
}
export async function wooStartup(request,operationDirectory,text,context={}) {
  if(request.command!=='woo-managed'||request.args?.[0]!=='serve'||!request.applicationId||
    typeof text!=='string'||text.length>16384||!text.startsWith('{'))return null;
  let value;try{value=JSON.parse(text);}catch{return null;}
  if(!plain(value)||value.schema!==STARTUP||value.status!=='WOO_MANAGED_READY')return null;
  absolute(operationDirectory);
  const configFile=absolute(option(request,'--config')),
    configSha256=option(request,'--expected-config-sha256'),
    sourceSha256=option(request,'--expected-source-sha256'),
    selectionSha256=option(request,'--expected-selection-sha256');
  need([configSha256,sourceSha256,selectionSha256].every(item=>HASH.test(item))&&
    value.configFile===configFile&&value.configSha256===configSha256&&
    value.sourceSha256===sourceSha256&&value.selectionSha256===selectionSha256,
    'APPLICATION_WOO_STARTUP_CHANGED');
  const bytes=await readBytes(configFile,{max:2097152});
  need(sha256(bytes)===configSha256,'APPLICATION_WOO_CONFIG_CHANGED');
  const raw=parse(bytes,'original Woo merchant config');
  need(['stellar-forge.sf104.merchant.v1','stellar-forge.sf104.merchant.v2'].includes(raw.schema),
    'APPLICATION_WOO_CONFIG_CHANGED');
  const outbox=absolute(raw.outbox);
  need(value.outbox===outbox,'APPLICATION_WOO_OUTBOX_CHANGED');
  const saved=await privateJson(join(outbox,LAUNCH));
  need(same(value,saved),'APPLICATION_WOO_LAUNCH_CHANGED');
  const binding=await privateJson(join(outbox,BINDING));
  const admission=new URL(raw.admissionUrl??new URL(raw.storeOrigin).origin+'/wp-json/stellar-forge/v1/checkout-admission');
  const suffix='/wp-json/stellar-forge/v1/checkout-admission';
  need(admission.protocol==='https:'&&admission.pathname.endsWith(suffix),'APPLICATION_WOO_CONFIG_CHANGED');
  const base=admission.pathname.slice(0,-suffix.length),deliveryUrl=admission.origin+base+'/wp-json/stellar-forge/v1/settlement';
  const scope={storeOrigin:new URL(raw.storeOrigin).origin,admissionUrl:admission.href,deliveryUrl,outbox};
  need(binding.schema==='stellar-forge.sf104.managed-outbox.v1'&&binding.id===value.outboxBindingId&&
    binding.scopeSha256===hash(scope)&&same(binding.scope,scope),'APPLICATION_WOO_OUTBOX_CHANGED');
  const lease=await inspectDeliveryLease(outbox);
  need(lease.active&&same(lease.owner,value.deliveryOwner)&&
    Number.isSafeInteger(context.pid)&&context.pid>0&&Number.isSafeInteger(value.pid)&&value.pid>0&&
    (value.pid===context.pid||value.ppid===context.pid)&&value.deliveryOwner.pid===value.pid,
    'APPLICATION_WOO_CHILD_CHANGED');
  need(plain(value.source)&&Array.isArray(value.source.files)&&
    value.source.sha256===sourceSha256&&hash(value.source.files)===sourceSha256,
    'APPLICATION_WOO_SOURCE_CHANGED');
  const port=Number(option(request,'--port',true)??0),sellerPort=Number(option(request,'--seller-port'));
  need([port,sellerPort].every(n=>Number.isSafeInteger(n)&&n>=0&&n<=65535),'APPLICATION_WOO_PORT_INVALID');
  const url=local(value.url,port),seller=local(value.seller,sellerPort);
  const navigationOrigin=navOrigin(option(request,'--operations-navigation-origin',true));
  need(value.operationsNavigationOrigin===navigationOrigin,'APPLICATION_WOO_NAVIGATION_CHANGED');
  const fulfillment=local(value.fulfillment,Number(new URL(url).port||80),{path:'/fulfillment'});
  const controls=value.deliveryControls===null?null:
    local(value.deliveryControls,Number(new URL(url).port||80),{path:'/fulfillment',fragment:true});
  return {url,links:[{label:'Original fulfillment',url:controls??fulfillment}],original:{
    schema:STARTUP,launchId:value.launchId,configFile,configSha256,sourceSha256,
    outbox,outboxBindingId:binding.id,storeOrigin:scope.storeOrigin,admissionUrl:admission.href,
    deliveryUrl,secretEnv:raw.secretEnv??'SF98_WEBHOOK_SECRET',facilitator:option(request,'--facilitator'),
    adminUrl:admission.origin+base+'/wp-admin/admin.php?page=sf98-woocommerce',
    seller,deliveryOwner:value.deliveryOwner,pid:value.pid,navigationOrigin,
    mode:value.mode,routeCount:raw.routes.length,basketCatalogs:raw.baskets?.length??0}};
}

// The maintained registry owns catalog loading and stdout persistence. This
// adapter preserves the same original preparation, identity and startup checks.
export default {
  schema: APPLICATION_PROVIDER_SCHEMA,
  id: 'woo-managed',
  catalog({common}) { return [wooApplication(common)]; },
  async prepare(type,settings,context) {
    const original=await prepareWooApplication(settings,context);
    return {args:original.args,inputs:original.inputs,createDirectories:original.createDirectories,
      resourceKey:original.resourceKey,woo:original.identity};
  },
  matchRequest(request) { return !request.pythonCommand&&request.command==='woo-managed'; },
  createObserver(request,directory,context) {
    return observeApplicationStartup(request,directory,text=>{
      if(!text.startsWith('{"schema":"stellar-forge.sf104.managed-startup.v1",'))return null;
      return ()=>wooStartup(request,directory,text,context);
    });
  },
};
