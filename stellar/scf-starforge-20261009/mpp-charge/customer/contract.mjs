// MIT. Public native MPP contract, exact customer request and OpenAPI projection.
import { merchantConfig, terms, publicURL, requestConfig, clone } from '../config.mjs';
import { versions } from '../runtime.mjs';
import { hash, stable, plain, requireValue, id } from '../storage.mjs';
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';

export const CUSTOMER_API_VERSION='stellar-forge.mpp-customer.v1';
export const CONTRACT_SCHEMA='stellar-forge.mpp-customer-contract.v1';
export const MAX_CONTRACT_BYTES=512*1024;
const keys=(value,allowed,code)=>{
  requireValue(plain(value) && Object.keys(value).every(k=>allowed.includes(k)),code);
};
export function merchantContract(profile) {
  const config=merchantConfig(profile);
  const core={schema:CONTRACT_SCHEMA,title:config.title,origin:config.publicOrigin,
    realm:new URL(config.publicOrigin).hostname,profileId:hash(stable(config)),
    payment:{method:'stellar',intent:'charge',mode:'pull',credentialType:'transaction'},
    runtime:{...versions},offers:config.routes.map(route=>({
      id:route.id,method:route.method,path:route.path,url:config.publicOrigin+route.path,
      description:route.description,payment:{...route.payment},
      request:{body:route.method==='GET'?'none':'optional-json',query:'string-map'}
    }))};
  return {...core,sha256:hash(stable(core))};
}
export function parseContract(input,{expectedSha256}={}) {
  if(typeof input==='string' || input instanceof Uint8Array) {
    requireValue(Buffer.byteLength(input)<=MAX_CONTRACT_BYTES,'MPP_CONTRACT_TOO_LARGE');
    input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(Buffer.from(input)));
  }
  keys(input,['schema','title','origin','realm','profileId','payment','runtime','offers','sha256'],'MPP_CONTRACT_INVALID');
  requireValue(Buffer.byteLength(JSON.stringify(input))<=MAX_CONTRACT_BYTES &&
    input.schema===CONTRACT_SCHEMA && typeof input.title==='string' &&
    input.title.length>0 && input.title.length<=200 &&
    /^[a-f0-9]{64}$/.test(input.profileId),'MPP_CONTRACT_IDENTITY_INVALID');
  const origin=publicURL(input.origin+'/').origin;
  requireValue(origin===input.origin && input.realm===new URL(origin).hostname,'MPP_CONTRACT_ORIGIN_INVALID');
  requireValue(stable(input.payment)===stable({method:'stellar',intent:'charge',mode:'pull',credentialType:'transaction'}) &&
    stable(input.runtime)===stable(versions),'MPP_CONTRACT_RUNTIME_UNSUPPORTED');
  requireValue(Array.isArray(input.offers) && input.offers.length>0 && input.offers.length<=64,'MPP_CONTRACT_OFFERS_INVALID');
  const ids=new Set(),routes=new Set();
  const offers=input.offers.map(offer=>{
    keys(offer,['id','method','path','url','description','payment','request'],'MPP_CONTRACT_OFFER_INVALID');
    requireValue(['GET','POST'].includes(offer.method) && typeof offer.path==='string' &&
      /^\/[A-Za-z0-9/_-]*$/.test(offer.path) && !offer.path.startsWith('/_mpp') &&
      offer.url===origin+offer.path && !ids.has(offer.id) &&
      !routes.has(offer.method+' '+offer.path),'MPP_CONTRACT_ROUTE_INVALID');
    ids.add(id(offer.id));routes.add(offer.method+' '+offer.path);
    requireValue(typeof offer.description==='string' && offer.description.length<=1000,'MPP_CONTRACT_DESCRIPTION_INVALID');
    const payment=terms(offer.payment);
    requireValue(stable(payment)===stable(offer.payment),'MPP_CONTRACT_PAYMENT_FIELDS_INVALID');
    const request={body:offer.method==='GET'?'none':'optional-json',query:'string-map'};
    requireValue(stable(request)===stable(offer.request),'MPP_CONTRACT_INPUT_INVALID');
    return {id:offer.id,method:offer.method,path:offer.path,url:offer.url,description:offer.description,payment,request};
  });
  const core={schema:CONTRACT_SCHEMA,title:input.title,origin,realm:input.realm,profileId:input.profileId,
    payment:clone(input.payment),runtime:{...versions},offers};
  const digest=hash(stable(core));
  requireValue(digest===input.sha256 && (!expectedSha256 || expectedSha256===digest),'MPP_CONTRACT_DIGEST_MISMATCH');
  return {...core,sha256:digest};
}
export function buildCustomerRequest(contract,offerId,inputs={}) {
  contract=parseContract(contract);
  const offer=contract.offers.find(value=>value.id===offerId);
  requireValue(offer,'MPP_CUSTOMER_OFFER_NOT_FOUND',404);
  keys(inputs,['query','json'],'MPP_CUSTOMER_INPUT_INVALID');
  const url=new URL(offer.url);
  if(inputs.query!==undefined) {
    requireValue(plain(inputs.query) && Object.keys(inputs.query).length<=64,'MPP_CUSTOMER_QUERY_INVALID');
    for(const name of Object.keys(inputs.query).sort()) {
      requireValue(name.length>0 && name.length<=128 && !/[\u0000-\u001f\u007f]/.test(name),'MPP_CUSTOMER_QUERY_NAME_INVALID');
      const values=Array.isArray(inputs.query[name])?inputs.query[name]:[inputs.query[name]];
      requireValue(values.length>0 && values.length<=64,'MPP_CUSTOMER_QUERY_VALUES_INVALID');
      for(const value of values) {
        requireValue(typeof value==='string' && value.length<=4096 && !/[\u0000-\u001f\u007f]/.test(value),
          'MPP_CUSTOMER_QUERY_VALUE_INVALID');
        url.searchParams.append(name,value);
      }
    }
  }
  requireValue(url.href.length<=8192,'MPP_CUSTOMER_URL_TOO_LONG');
  return requestConfig({url:url.href,method:offer.method,...(Object.hasOwn(inputs,'json')?{json:inputs.json}:{})});
}
export function contractOpenAPI(input) {
  const contract=parseContract(input),paths={};
  for(const offer of contract.offers) {
    const operation={operationId:offer.id,summary:offer.description || offer.id,
      security:[{MPP:[]}],
      'x-stellar-mpp':{method:'stellar',intent:'charge',mode:'pull',...offer.payment,
        contractSha256:contract.sha256},
      responses:{
        '200':{description:'Paid resource. Application content uses its declared response media type.',
          headers:{'Payment-Receipt':{description:'Native unpadded base64url JSON payment receipt.',schema:{type:'string'}}},
          content:{'*/*':{schema:{}}}},
        '202':{description:'Original payment or delivery is pending. Retain and resume the same purchase.'},
        '402':{description:'Native payment challenge for this exact request.',
          headers:{'WWW-Authenticate':{description:'Original dynamic MPP Payment challenge.',schema:{type:'string'}}}},
        '409':{description:'The original purchase, scope or configuration needs operator review.'}
      }};
    if(offer.method==='POST') operation.requestBody={
      description:'JSON application input. Required fields are defined by the merchant application.',
      required:false,content:{'application/json':{schema:{}}}};
    (paths[offer.path]??={})[offer.method.toLowerCase()]=operation;
  }
  return {openapi:'3.1.0',info:{title:contract.title,version:contract.sha256.slice(0,12),
    description:'Native Stellar MPP Charge. Each exact request obtains its own dynamic challenge.'},
    servers:[{url:contract.origin}],paths,
    components:{securitySchemes:{MPP:{type:'http',scheme:'Payment',
      description:'Native MPP credential obtained after reviewing the actual HTTP 402 challenge.'}}},
    'x-stellar-mpp-contract':{url:contract.origin+'/_mpp/contract',sha256:contract.sha256,
      profileId:contract.profileId,runtime:contract.runtime}};
}
export function compareContracts(before,after) {
  before=parseContract(before);after=parseContract(after);
  const old=new Map(before.offers.map(o=>[o.id,o])),current=new Map(after.offers.map(o=>[o.id,o]));
  const changes=[];
  if(before.origin!==after.origin) changes.push({kind:'merchant',field:'origin',before:before.origin,after:after.origin});
  if(before.realm!==after.realm) changes.push({kind:'merchant',field:'realm',before:before.realm,after:after.realm});
  for(const [offerId,offer] of old) {
    const next=current.get(offerId);
    if(!next){changes.push({kind:'removed',offerId,before:offer});continue;}
    const fields=[];
    for(const key of ['method','path','url','description','request'])if(stable(offer[key])!==stable(next[key]))
      fields.push({field:key,before:offer[key],after:next[key]});
    for(const key of ['network','currency','recipient','amountAtomic','decimals'])if(offer.payment[key]!==next.payment[key])
      fields.push({field:'payment.'+key,before:offer.payment[key],after:next.payment[key]});
    if(fields.length)changes.push({kind:'changed',offerId,fields});
  }
  for(const [offerId,offer] of current)if(!old.has(offerId))changes.push({kind:'added',offerId,after:offer});
  return {before:before.sha256,after:after.sha256,changed:before.sha256!==after.sha256,
    profileChanged:before.profileId!==after.profileId,changes};
}
export async function fetchMerchantContract(origin,{transport}={}) {
  const target=publicURL(origin+'/');requireValue(target.origin===origin,'MPP_CONTRACT_ORIGIN_INVALID');
  const fetchImpl=createPublicHttpsFetch({timeoutMs:30000,trustedProxy:transport??null});
  const response=await fetchImpl(origin+'/_mpp/contract',{method:'GET',redirect:'manual'});
  requireValue(response.status===200,'MPP_CONTRACT_HTTP_STATUS',502);
  const reader=response.body?.getReader();requireValue(reader,'MPP_CONTRACT_BODY_REQUIRED',502);
  const chunks=[];let size=0;
  try {while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;
    requireValue(size<=MAX_CONTRACT_BYTES,'MPP_CONTRACT_TOO_LARGE');chunks.push(Buffer.from(part.value));}}
  catch(error){await reader.cancel().catch(()=>{});throw error;}
  const contract=parseContract(Buffer.concat(chunks));
  requireValue(contract.origin===origin,'MPP_CONTRACT_ORIGIN_MISMATCH');
  return contract;
}

export function customerConfigurationTemplate(input) {
  const contract=parseContract(input),limits=new Map();
  for(const offer of contract.offers) {
    const key=offer.payment.network+'\n'+offer.payment.currency,current=limits.get(key);
    requireValue(!current || current.decimals===offer.payment.decimals,'MPP_CONTRACT_ASSET_DECIMALS_CONFLICT');
    if(!current || BigInt(offer.payment.amountAtomic)>BigInt(current.maxAtomic))limits.set(key,{
      network:offer.payment.network,currency:offer.payment.currency,decimals:offer.payment.decimals,
      maxAtomic:offer.payment.amountAtomic,maxFeeStroops:'100000'});
  }
  return {schema:CUSTOMER_API_VERSION,workspace:'/private/mpp-customer-workspace',
    dependencyRoot:'/private/mpp-dependencies',
    operator:{python:'/usr/bin/python3',ledger:'/private/governor/ledger.json',
      policy:'/private/governor/policy.json',actor:'customer',service:'merchant'},
    signer:{payer:'ACTUAL_STELLAR_PAYER_ACCOUNT',keyEnv:'MPP_CUSTOMER_SIGNER'},
    assetLimits:[...limits.values()]};
}
