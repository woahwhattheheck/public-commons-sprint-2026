// MIT. Original authenticated Woo client + catalog packet receiving.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {isAbsolute, resolve} from 'node:path';
import {writeBytes} from '../sf88-operator-buyer-cli/node/store.mjs';
import {compileMerchant} from './seller.mjs';
import {canonical, basketDigest, validateBasketCatalog} from './basket.mjs';
import {fields, publicUrl, reference} from './buyer.mjs';

export const CATALOG_PLAN = 'stellar-forge.sf104.catalog-plan.v1';
export const CATALOG_WORKSPACE = 'stellar-forge.sf104.catalog-workspace.v1';
export const CATALOG_HANDOFF = 'stellar-forge.sf104.catalog-handoff.v1';
export const CATALOG_CONFIG = 'stellar-forge.sf104.merchant.v3';
export const MAX_CATALOG_BYTES = 16 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/, UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
export const catalogCanonical = canonical;
export const catalogDigest = basketDigest;
function need(ok, code, message = code) { if (!ok) throw Object.assign(new Error(message), {code}); }
const identity = id => { need(UUID.test(id ?? ''), 'WOO_CATALOG_ID_REQUIRED'); return id; };
const page = value => { need(Number.isSafeInteger(value) && value >= 1 && value <= 100000, 'WOO_CATALOG_PAGE_INVALID'); return value; };
const errorCode = value => /^[A-Za-z0-9_]{1,100}$/.test(value ?? '') ? value : 'WOO_CATALOG_REQUEST_REFUSED';
function stamped(value, schema) { need(object(value) && value.schema === schema, 'WOO_CATALOG_RESPONSE_INVALID'); return value; }
function bound(value) { need(Buffer.byteLength(JSON.stringify(value)) <= MAX_CATALOG_BYTES, 'WOO_CATALOG_PACKET_TOO_LARGE'); return value; }
function sealed(value, schema) {
  stamped(value,schema); bound(value);
  const content = clone(value); delete content.sha256;
  need(HASH.test(value.sha256 ?? '') && basketDigest(content) === value.sha256, 'WOO_CATALOG_PACKET_CHANGED');
  return value;
}
function routeKey(route) { const value=clone(route); delete value.description; return basketDigest(value); }
function currentRoute(route) {
  fields(route,['productId','routeId','url','method','expect','description'],'WOO_CATALOG_ROUTE_FIELDS_INVALID');
  need(reference(route.productId),'WOO_CATALOG_PRODUCT_REQUIRED');
  // Original merchant compiler remains the full route/payment validator.
  return route;
}
export function validateCatalogHandoff(value) {
  sealed(value,CATALOG_HANDOFF);
  fields(value,['schema','projectId','editionId','storeOrigin','createdAt','admissionUrl','selectedProductIds',
    'routes','routeVersions','baskets','retainedOrders','settings','delivery','sha256'],'WOO_CATALOG_HANDOFF_FIELDS_INVALID');
  identity(value.projectId);identity(value.editionId);
  const store=publicUrl(value.storeOrigin,'WOO_CATALOG_STORE_REQUIRED');
  need(store.origin===value.storeOrigin && store.pathname==='/' && !store.search,'WOO_CATALOG_STORE_REQUIRED');
  const admission=publicUrl(value.admissionUrl,'WOO_CATALOG_ADMISSION_REQUIRED');
  need(admission.origin===store.origin && !admission.search &&
    admission.pathname.endsWith('/wp-json/stellar-forge/v1/checkout-admission'),'WOO_CATALOG_ADMISSION_REQUIRED');
  need(Array.isArray(value.selectedProductIds) && value.selectedProductIds.length>=1 && value.selectedProductIds.length<=64 &&
    value.selectedProductIds.every(reference) && new Set(value.selectedProductIds).size===value.selectedProductIds.length,
    'WOO_CATALOG_PRODUCT_SELECTION_INVALID');
  const selected=new Set(value.selectedProductIds);
  need(Array.isArray(value.routes) && value.routes.length<=64 && value.routes.every(r=>object(r)&&selected.has(r.productId)),
    'WOO_CATALOG_CURRENT_ROUTES_INVALID');
  need(Array.isArray(value.routeVersions)&&value.routeVersions.length<=256&&Array.isArray(value.baskets)&&value.baskets.length<=256,
    'WOO_CATALOG_VERSION_LIMIT');
  for(const route of [...value.routes,...value.routeVersions])currentRoute(route);
  need(new Set(value.routes.map(r=>r.productId)).size===value.routes.length,'WOO_CATALOG_DUPLICATE_PRODUCT');
  for(const catalog of value.baskets)need(validateBasketCatalog(catalog).storeOrigin===store.origin,'WOO_CATALOG_STORE_CHANGED');
  const retained=new Set(value.routeVersions.map(routeKey));
  need(value.routes.every(r=>retained.has(routeKey(r))),'WOO_CATALOG_CURRENT_VERSION_MISSING');
  need(Array.isArray(value.retainedOrders)&&value.retainedOrders.length<=20000,'WOO_CATALOG_RETAINED_ORDERS_INVALID');
  for(const row of value.retainedOrders)need(object(row)&&reference(row.orderReference)&&HASH.test(row.snapshotSha256??'')&&
    HASH.test(row.versionSha256??'')&&typeof row.availableNow==='boolean','WOO_CATALOG_RETAINED_ORDER_INVALID');
  return clone(value);
}
export function validateCatalogWorkspace(value) {
  sealed(value,CATALOG_WORKSPACE);
  need(object(value.project)&&UUID.test(value.project.id??'')&&UUID.test(value.project.currentEdition??'')&&
    Number.isSafeInteger(value.project.revision)&&value.project.revision>=1&&Array.isArray(value.records)&&value.records.length<=1000,
    'WOO_CATALOG_WORKSPACE_INVALID');
  const records=new Map();
  for(const row of value.records){
    need(object(row)&&UUID.test(row.id??'')&&!records.has(row.id)&&
      ['edition','review','application','source','request'].includes(row.kind)&&object(row.value)&&
      row.value.projectId===value.project.id,'WOO_CATALOG_HISTORY_INVALID');
    need(row.value.id===row.id||row.kind==='request'&&row.value.requestId===row.id,'WOO_CATALOG_HISTORY_ID_CHANGED');
    if(row.kind==='edition')need(row.value.plan?.schema===CATALOG_PLAN&&basketDigest(row.value.plan)===row.value.planSha256,
      'WOO_CATALOG_EDITION_CHANGED');
    if(row.kind==='source'){
      need(typeof row.value.base64==='string'&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(row.value.base64),
        'WOO_CATALOG_SOURCE_INVALID');
      const bytes=Buffer.from(row.value.base64,'base64');
      need(bytes.length===row.value.bytes && createBytesDigest(bytes)===row.value.sha256,'WOO_CATALOG_SOURCE_CHANGED');
    }
    if(row.kind==='application'){
      const h=validateCatalogHandoff(row.value.handoff);
      need(h.projectId===value.project.id&&h.editionId===row.value.editionId,'WOO_CATALOG_APPLICATION_SOURCE_CHANGED');
    }
    records.set(row.id,row);
  }
  need(records.get(value.project.currentEdition)?.kind==='edition','WOO_CATALOG_CURRENT_EDITION_MISSING');
  if(value.project.latestApplication)need(records.get(value.project.latestApplication)?.kind==='application','WOO_CATALOG_APPLICATION_MISSING');
  for(const row of records.values()){
    if(['review','application'].includes(row.kind))need(records.get(row.value.editionId)?.kind==='edition','WOO_CATALOG_HISTORY_EDITION_MISSING');
    if(row.kind==='application')need(records.get(row.value.reviewId)?.kind==='review'&&
      records.get(row.value.requestId)?.kind==='request','WOO_CATALOG_APPLICATION_HISTORY_MISSING');
  }
  return clone(value);
}
// Use the same native crypto implementation as all original retained inputs.
import {createHash} from 'node:crypto';
export const createBytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');

/** Injected only by the original createMerchantClient. It owns Basic credentials,
 * public-HTTPS protection, transport bounds and optional explicit local runtime. */
export function createCatalogMethods({requestUrl,siteUrl}) {
  need(typeof requestUrl==='function'&&typeof siteUrl==='string','WOO_CATALOG_ORIGINAL_CLIENT_REQUIRED');
  const root=siteUrl+'/wp-json/stellar-forge/v1/merchant/catalog';
  async function get(path,schema,limit=MAX_CATALOG_BYTES){
    const value=await requestUrl(root+path,undefined,{maxBytes:limit});
    return stamped(value,schema);
  }
  const catalogProject=async id=>{
    const value=await get('/projects/'+identity(id),'stellar-forge.sf104.catalog-view.v1');
    need(value.project?.id===id&&value.edition?.projectId===id&&Array.isArray(value.history),'WOO_CATALOG_PROJECT_CHANGED');
    return value;
  };
  const catalogRequest=async id=>{
    const value=await get('/requests/'+identity(id),'stellar-forge.sf104.catalog-request-status.v1');
    need(typeof value.found==='boolean'&&(!value.found||value.receipt?.requestId===id),'WOO_CATALOG_REQUEST_CHANGED');
    return value;
  };
  const catalogMutate=async request=>{
    need(object(request)&&UUID.test(request.requestId??'')&&['create','save','review','apply','import'].includes(request.action),
      'WOO_CATALOG_REQUEST_REQUIRED');
    let returned;
    try { returned=await requestUrl(root,request,{maxBytes:MAX_CATALOG_BYTES,timeoutMs:60000}); }
    catch(error){error.unknown=!['WOO_OPERATOR_AUTH_REQUIRED','WOO_OPERATOR_AUTH_REFUSED'].includes(error.code);throw error;}
    const {httpStatus,response}=returned;
    if(httpStatus!==200)throw Object.assign(new Error(response?.message||'The catalog request was refused.'),
      {code:errorCode(response?.code),httpStatus,unknown:httpStatus>=500});
    need(object(response)&&response.receipt?.requestId===request.requestId&&
      response.receipt.inputSha256===basketDigest(request),'WOO_CATALOG_REQUEST_CHANGED');
    return response;
  };
  const catalogExport=async(id,{kind='workspace',applicationId}={})=>{
    need(['workspace','seller'].includes(kind),'WOO_CATALOG_EXPORT_KIND_INVALID');
    const query=new URLSearchParams({kind});if(applicationId)query.set('applicationId',identity(applicationId));
    const value=await requestUrl(root+'/projects/'+identity(id)+'/export?'+query,undefined,{maxBytes:MAX_CATALOG_BYTES});
    const verified=kind==='workspace'?validateCatalogWorkspace(value):validateCatalogHandoff(value);
    need((kind==='workspace'?verified.project.id:verified.projectId)===id,'WOO_CATALOG_EXPORT_PROJECT_CHANGED');
    return verified;
  };
  return Object.freeze({
    catalogStatus:()=>get('/status','stellar-forge.sf104.catalog-status.v1',65536),
    catalogProjects:({page:current=1,limit=20}={})=>{
      need(Number.isSafeInteger(limit)&&limit>=1&&limit<=50,'WOO_CATALOG_LIMIT_INVALID');
      return get('/projects?'+new URLSearchParams({page:String(page(current)),limit:String(limit)}),'stellar-forge.sf104.catalog-projects.v1');
    },
    catalogProducts:({page:current=1,limit=20,q=''}={})=>{
      need(Number.isSafeInteger(limit)&&limit>=1&&limit<=50&&typeof q==='string'&&q.length<=120,'WOO_CATALOG_PRODUCT_QUERY_INVALID');
      return get('/products?'+new URLSearchParams({page:String(page(current)),limit:String(limit),q}),'stellar-forge.sf104.catalog-products.v1');
    },
    catalogProject,catalogRequest,catalogMutate,catalogExport,
    catalogRecord:async id=>{
      const value=await get('/records/'+identity(id),'stellar-forge.sf104.catalog-record.v1',32*1024*1024);
      need(value.record?.id===id||value.record?.requestId===id,'WOO_CATALOG_RECORD_CHANGED');return value;
    },
  });
}

/** Preserve the original private destination and all unselected current routes.
 * Old terms remain configured; the original authenticated order lookup chooses
 * the exact frozen version, so a retained version cannot change a new order. */
export function receiveCatalogHandoff(value,{existingConfig=null,outbox,secretEnv,timeoutMs}={}) {
  const packet=validateCatalogHandoff(value);
  let original=null;
  if(existingConfig!==null){
    original=compileMerchant(existingConfig);
    need(original.storeOrigin===packet.storeOrigin&&original.admissionUrl===packet.admissionUrl,'WOO_CATALOG_EXISTING_STORE_CHANGED');
    need(outbox===undefined||resolve(outbox)===original.outbox,'WOO_CATALOG_KEEP_ORIGINAL_OUTBOX');
    need(secretEnv===undefined||secretEnv===original.secretEnv,'WOO_CATALOG_KEEP_ORIGINAL_SECRET_BINDING');
  }
  const destination=original?.outbox??outbox;
  need(typeof destination==='string'&&isAbsolute(destination)&&resolve(destination)===destination,'WOO_CATALOG_OUTBOX_REQUIRED');
  const selected=new Set(packet.selectedProductIds);
  const routes=[...(existingConfig?.routes??[]).filter(r=>!selected.has(r.productId)),...packet.routes];
  const versions=new Map();
  for(const route of [...(existingConfig?.routes??[]),...(existingConfig?.routeVersions??[]),...packet.routeVersions,...routes])
    versions.set(routeKey(route),clone(route));
  const baskets=new Map();
  for(const catalog of [...(existingConfig?.baskets??[]),...packet.baskets])baskets.set(catalog.catalogDigest,clone(catalog));
  need(versions.size<=256&&baskets.size<=256,'WOO_CATALOG_VERSION_LIMIT',
    'This handoff exceeds 256 retained route or basket versions. Keep the current configuration and review the exact old-order inventory before removing a version.');
  const config={schema:CATALOG_CONFIG,storeOrigin:packet.storeOrigin,admissionUrl:packet.admissionUrl,
    secretEnv:original?.secretEnv??secretEnv??'SF98_WEBHOOK_SECRET',outbox:destination,
    timeoutMs:timeoutMs??original?.timeoutMs??5000,routes,routeVersions:[...versions.values()],baskets:[...baskets.values()]};
  bound(config);const compiled=compileMerchant(config);
  return {config,compiled,handoffSha256:packet.sha256,projectId:packet.projectId,editionId:packet.editionId,
    selectedProductIds:packet.selectedProductIds,retainedOrders:packet.retainedOrders};
}
export async function readCatalogBytes(path,limit=MAX_CATALOG_BYTES) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'WOO_CATALOG_ABSOLUTE_FILE_REQUIRED');
  const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await file.stat({bigint:true});
    need(before.isFile()&&before.size>0n&&before.size<=BigInt(limit),'WOO_CATALOG_FILE_INVALID');
    const chunks=[];let size=0;
    for(;;){const chunk=Buffer.allocUnsafe(Math.min(65536,limit-size+1));const {bytesRead}=await file.read(chunk,0,chunk.length,null);
      if(!bytesRead)break;size+=bytesRead;need(size<=limit,'WOO_CATALOG_FILE_TOO_LARGE');chunks.push(chunk.subarray(0,bytesRead));}
    const bytes=Buffer.concat(chunks,size);const after=await file.stat({bigint:true});
    need(bytes.length<=limit&&BigInt(bytes.length)===before.size&&before.dev===after.dev&&before.ino===after.ino&&
      before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'WOO_CATALOG_FILE_CHANGED');
    return bytes;
  }finally{await file.close();}
}
export function parseCatalogJson(bytes){return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
export async function writeCatalogFile(path,bytes,{reuse=false}={}) {
  need(typeof path==='string'&&isAbsolute(path)&&resolve(path)===path,'WOO_CATALOG_ABSOLUTE_FILE_REQUIRED');
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=32*1024*1024,'WOO_CATALOG_FILE_TOO_LARGE');
  try{await writeBytes(path,bytes,{exclusive:true});}
  catch(error){
    if(error.code!=='EEXIST'||!reuse)throw error;
    const prior=await readCatalogBytes(path,32*1024*1024);
    need(prior.equals(bytes),'WOO_CATALOG_EXISTING_FILE_CHANGED');
    return {path,bytes:bytes.length,sha256:createBytesDigest(bytes),reused:true};
  }
  return {path,bytes:bytes.length,sha256:createBytesDigest(bytes),reused:false};
}
export async function writeCatalogConfiguration(path,received) {
  const bytes=Buffer.from(JSON.stringify(received.config,null,2)+'\n');
  need(bytes.length<=MAX_CATALOG_BYTES,'WOO_CATALOG_CONFIG_TOO_LARGE');
  const file=await writeCatalogFile(path,bytes,{reuse:true});
  return {status:'WOO_CATALOG_CONFIG_PREPARED',...file,handoffSha256:received.handoffSha256,
    projectId:received.projectId,editionId:received.editionId,currentRoutes:received.config.routes.length,
    retainedRouteVersions:received.config.routeVersions.length,basketVersions:received.config.baskets.length,
    outbox:received.config.outbox,secretEnv:received.config.secretEnv,networkRequests:0};
}
