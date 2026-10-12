// MIT. Crossref products compiled through the original SF30 offers and route engine.
import {readFile,lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {compileHttpSellerOffer} from '../seller.mjs';
import {compileSellerRoutes} from '../resource-server.mjs';
import {compileSellerOpenApi} from '../developer-portal.mjs';
import {need,object,json,sha256,requestFor} from './metadata.mjs';
export const SCHEMA='stellar-forge.crossref-merchant.v1';
function fields(value,names,code){need(object(value)&&Object.keys(value).every(key=>names.includes(key)),code);}
function integer(value,min,max,code){need(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;}
export function compileCrossrefMerchant(input){
  fields(input,['schema','title','publicOrigin','provider','timeoutMs','maxSourceBytes','maxResponseBytes','cacheSeconds','products'],'CROSSREF_CONFIG_FIELDS_INVALID');
  need(input.schema===SCHEMA,'CROSSREF_CONFIG_SCHEMA_INVALID');
  const config=structuredClone(input);
  need(typeof config.title==='string'&&config.title.trim().length>0&&config.title.length<=100&&!/[\x00-\x1f\x7f]/.test(config.title),'CROSSREF_TITLE_INVALID');
  let origin;try{origin=new URL(config.publicOrigin);}catch{need(false,'CROSSREF_PUBLIC_ORIGIN_INVALID');}
  need(origin.protocol==='https:'&&origin.origin===config.publicOrigin&&!origin.username&&!origin.password,'CROSSREF_PUBLIC_ORIGIN_INVALID');
  fields(config.provider,['account','mailtoEnv'],'CROSSREF_PROVIDER_FIELDS_INVALID');
  need(/^[A-Za-z0-9_-]{1,100}$/.test(config.provider.account??''),'CROSSREF_ACCOUNT_REQUIRED');
  if(config.provider.mailtoEnv!==undefined)need(/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(config.provider.mailtoEnv),'CROSSREF_CONTACT_ENV_INVALID');
  config.timeoutMs=integer(config.timeoutMs??45000,1000,110000,'CROSSREF_TIMEOUT_INVALID');
  config.maxSourceBytes=integer(config.maxSourceBytes??4194304,1024,16777216,'CROSSREF_SOURCE_LIMIT_INVALID');
  config.maxResponseBytes=integer(config.maxResponseBytes??16777216,config.maxSourceBytes,16777216,'CROSSREF_RESPONSE_LIMIT_INVALID');
  config.cacheSeconds=integer(config.cacheSeconds??86400,0,604800,'CROSSREF_CACHE_TTL_INVALID');
  need(Array.isArray(config.products)&&config.products.length>0&&config.products.length<=16,'CROSSREF_PRODUCTS_REQUIRED');
  const ids=new Set(),paths=new Set(),products=[],routes=[];
  for(const product of config.products){
    fields(product,['id','kind','path','description','paymentOptions','example'],'CROSSREF_PRODUCT_FIELDS_INVALID');
    need(/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(product.id??'')&&!ids.has(product.id),'CROSSREF_PRODUCT_ID_INVALID');
    need(/^\/[A-Za-z0-9_/-]+$/.test(product.path??'')&&!product.path.includes('//')&&!product.path.startsWith('/_seller/')&&!paths.has(product.path),'CROSSREF_PRODUCT_PATH_INVALID');
    need(['work','updates'].includes(product.kind),'CROSSREF_PRODUCT_KIND_INVALID');
    const example=product.example??{};requestFor(product.kind,example);
    need(!example.dois,'CROSSREF_PRODUCT_SINGLE_DOI_REQUIRED');
    const parameters=[{name:'doi',type:'string',required:true,description:'A complete DOI or doi.org URL. The original DOI path is URL-encoded as one identifier.',example:example.doi}];
    if(product.kind==='updates')parameters.push(
      {name:'rows',type:'string',required:false,description:'Records per page, from 1 to 1000.',example:String(example.rows??1000)},
      {name:'cursor',type:'string',required:false,description:'Use * for the first page, then the exact returned next-cursor.',example:example.cursor??'*'});
    const offer=compileHttpSellerOffer({url:config.publicOrigin+product.path,method:'GET',
      description:product.description,serviceName:'Crossref DOI metadata',tags:['research','crossref'],
      paymentOptions:product.paymentOptions,queryParameters:parameters,mimeType:'application/json'});
    const query=offer.extensions.bazaar.schema.properties.input.properties.queryParams;
    query.properties.doi.maxLength=2048;
    if(query.properties.cursor)query.properties.cursor.maxLength=12000;
    products.push({...product,offer});ids.add(product.id);paths.add(product.path);
    routes.push({id:product.id,path:product.path,offer,validateInput:true,handler:product.id,admit:product.id+'Admission'});
  }
  const service={schema:'stellar-forge.seller-service.v1',publicOrigin:config.publicOrigin,
    handlerTimeoutMs:config.timeoutMs+10000,maxResponseBytes:config.maxResponseBytes,routes};
  compileSellerRoutes(routes.map(({id,offer})=>({id,offer,handler:async()=>({status:503,body:null})})));
  return {config,products,service,inputSha256:sha256(json(config))};
}
export function crossrefOpenApi(compiled,mode='CHALLENGE_ONLY'){
  return compileSellerOpenApi(compileSellerRoutes(compiled.products.map(({id,offer})=>({id,offer,handler:async()=>({status:503,body:null})}))),{mode});
}
export async function readCrossrefConfig(path){
  const file=resolve(path),info=await lstat(file);
  need(info.isFile()&&!info.isSymbolicLink()&&info.size<=1024*1024,'CROSSREF_CONFIG_FILE_INVALID');
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(file)));
  return compileCrossrefMerchant(value);
}
