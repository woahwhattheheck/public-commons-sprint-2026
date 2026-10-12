// MIT. Complete customer workbench over the existing native console Workspace.
import { hash, stable, requireValue, plain, id, now } from '../storage.mjs';
import { clone, buyerConfig, bindingFacts, humanAmount } from '../config.mjs';
import { purchaseView } from '../buyer.mjs';
import { storedResponse } from '../merchant.mjs';
import { parseContract, buildCustomerRequest, compareContracts, fetchMerchantContract,
  customerConfigurationTemplate } from './contract.mjs';
import { parseCustomerBundle, createCustomerBundle } from './export.mjs';
import { customerConfiguration, attachCustomer, readOriginalCustomerPurchase,
  customerPurchaseView, customerResponseReady } from './client.mjs';

export const WORKBENCH_SCHEMA='stellar-forge.mpp-customer-workbench.v1';
const keys=(value,allowed,code)=>requireValue(plain(value) && Object.keys(value).every(key=>allowed.includes(key)),code);
const bindingKey=purchaseId=>'customer-purchase:'+id(purchaseId);
const preparationKey=purchaseId=>'customer-workbench-preparation:'+id(purchaseId);
export function customerWorkbenchProfile(input,directory) {
  keys(input,['schema','contract','configuration'],'MPP_CUSTOMER_WORKBENCH_PROFILE_INVALID');
  requireValue(input.schema===undefined || input.schema===WORKBENCH_SCHEMA,'MPP_CUSTOMER_WORKBENCH_VERSION');
  requireValue(plain(input.configuration) && (input.configuration.workspace===undefined ||
    input.configuration.workspace===directory),'MPP_CUSTOMER_WORKSPACE_MISMATCH');
  const contract=parseContract(input.contract);
  return {schema:WORKBENCH_SCHEMA,contract,
    configuration:customerConfiguration({...input.configuration,workspace:directory},contract)};
}
export async function readCustomerDocument(input) {
  if(typeof input==='string')input=JSON.parse(input);
  requireValue(plain(input),'MPP_CUSTOMER_DOCUMENT_REQUIRED');
  if(input.schema==='stellar-forge.mpp-customer-bundle.v1') {
    const bundle=parseCustomerBundle(input),contract=parseContract(bundle.files[0].content);
    const expected=await createCustomerBundle({contract});
    requireValue(bundle.sha256===expected.sha256,'MPP_CUSTOMER_COMPANION_SOURCE_CHANGED');
    return contract;
  }
  return parseContract(input);
}
async function selectedProfile(workspace,expectedProfileId) {
  const metadata=await workspace.metadata();
  requireValue(metadata.customer,'MPP_CUSTOMER_CONFIGURATION_REQUIRED',409);
  requireValue(typeof expectedProfileId==='string' && expectedProfileId===metadata.customer,
    'MPP_CUSTOMER_PROFILE_CHANGED',409);
  const profile=customerWorkbenchProfile(await workspace.read('profiles',metadata.customer),workspace.root);
  requireValue(hash(stable(profile))===metadata.customer,'MPP_CUSTOMER_PROFILE_CHANGED',409);
  return profile;
}
async function draftFor(workspace,contract,metadata) {
  const old=metadata.customer?await workspace.read('profiles',metadata.customer):null;
  const buyer=metadata.buyer?await workspace.read('profiles',metadata.buyer):null;
  const seed=old?.configuration??buyer;
  const configuration={...customerConfigurationTemplate(contract),workspace:workspace.root};
  if(seed) {
    for(const key of ['operator','signer','dependencyRoot','rpcUrl'])if(seed[key])configuration[key]=clone(seed[key]);
    if(seed.transport?.origin===contract.origin)configuration.transport=clone(seed.transport);
    if(old)configuration.assetLimits=configuration.assetLimits.map(limit=>{
      const previous=old.configuration.assetLimits.find(row=>row.network===limit.network &&
        row.currency===limit.currency && row.decimals===limit.decimals);
      return previous?clone(previous):limit;
    });
  }
  return {draft:{schema:WORKBENCH_SCHEMA,contract,configuration},
    difference:old?compareContracts(old.contract,contract):null,revision:metadata.revision};
}
function originalConfiguration(workspace,original,row) {
  const profile=buyerConfig(row.profile);
  return customerConfiguration({workspace:workspace.root,dependencyRoot:profile.dependencyRoot,
    operator:profile.operator,signer:profile.signer,assetLimits:[{
      network:profile.expect.network,currency:profile.expect.currency,decimals:profile.expect.decimals,
      maxAtomic:profile.expect.maxAtomic,maxFeeStroops:profile.expect.maxFeeStroops}],
    ...(profile.rpcUrl?{rpcUrl:profile.rpcUrl}:{}),...(profile.transport?{transport:profile.transport}:{})},original);
}
export async function customerPurchaseAction({workspace,purchaseId,action,environment=process.env}) {
  requireValue(['inspect','execute','resume','finalize'].includes(action),'MPP_CUSTOMER_ACTION_INVALID');
  const original=await readOriginalCustomerPurchase(workspace,purchaseId);
  const session=await attachCustomer({workspace,contract:original.original,
    configuration:originalConfiguration(workspace,original.original,original.row),environment});
  try {return await session.purchase(purchaseId)[action]();}finally{await session.close();}
}
export async function customerResource({workspace,purchaseId}) {
  const original=await readOriginalCustomerPurchase(workspace,purchaseId);
  requireValue(customerResponseReady(original.row),'MPP_CUSTOMER_RESPONSE_PENDING',409);
  const row=original.row;
  return {response:storedResponse(row.response),receipt:clone(row.receipt),transaction:row.transaction,
    accounting:clone(row.finality??{outcome:'PENDING'}),bytes:row.response.bytes,sha256:row.response.sha256,
    contractSha256:original.original.sha256,offerId:original.binding.offerId};
}
export async function customerResourcePreview(options) {
  const result=await customerResource(options),response=result.response;
  const bytes=Buffer.from(await response.arrayBuffer()),limit=16384;
  let preview;
  try {
    const complete=new TextDecoder('utf8',{fatal:true}).decode(bytes);
    requireValue(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(complete),'MPP_BINARY_RESOURCE');
    preview={kind:'text',text:complete.slice(0,limit),truncated:complete.length>limit};
  } catch {preview={kind:'binary',text:null,truncated:bytes.length>limit};}
  return {status:response.status,headers:Object.fromEntries(response.headers),receipt:result.receipt,
    transaction:result.transaction,accounting:result.accounting,bytes:result.bytes,sha256:result.sha256,
    contractSha256:result.contractSha256,offerId:result.offerId,preview};
}
export function createCustomerWorkbench({workspace,environment=process.env}={}) {
  requireValue(workspace?.root && typeof workspace.profile==='function','MPP_WORKSPACE_REQUIRED');
  async function prepareOriginal(preparation) {
    requireValue(preparation?.schema==='stellar-forge.mpp-workbench-preparation.v1',
      'MPP_CUSTOMER_ORIGINAL_PREPARATION_REQUIRED',409);
    const profile=customerWorkbenchProfile(preparation.profile,workspace.root);
    requireValue(hash(stable(profile))===preparation.profileId &&
      preparation.purchaseId===preparation.options.purchaseId &&
      stable(bindingFacts(buildCustomerRequest(profile.contract,preparation.offerId,{
        ...(preparation.options.query!==undefined?{query:preparation.options.query}:{}),
        ...(Object.hasOwn(preparation.options,'json')?{json:preparation.options.json}:{})
      })))===stable(preparation.request),'MPP_CUSTOMER_PREPARATION_CHANGED',409);
    const session=await attachCustomer({workspace,...profile,environment});
    try{return await (await session.prepare(preparation.offerId,preparation.options)).inspect();}
    finally{await session.close();}
  }
  return Object.freeze({
    intake:async document=>{
      const contract=await readCustomerDocument(document);
      return draftFor(workspace,contract,await workspace.metadata());
    },
    fetch:async({origin,transport})=>{
      const contract=await fetchMerchantContract(origin,{transport});
      const result=await draftFor(workspace,contract,await workspace.metadata());
      if(transport)result.draft.configuration.transport=clone(transport);
      return result;
    },
    configure:async({profile,revision})=>{
      const normalized=customerWorkbenchProfile(profile,workspace.root);
      return workspace.configure('customer',normalized,revision);
    },
    preview:async({profileId,offerId,inputs={}})=>{
      const profile=await selectedProfile(workspace,profileId);
      keys(inputs,['query','json'],'MPP_CUSTOMER_INPUT_INVALID');
      const request=buildCustomerRequest(profile.contract,offerId,inputs);
      const offer=profile.contract.offers.find(row=>row.id===offerId);
      const limit=profile.configuration.assetLimits.find(row=>row.network===offer.payment.network &&
        row.currency===offer.payment.currency && row.decimals===offer.payment.decimals);
      requireValue(limit && BigInt(offer.payment.amountAtomic)<=BigInt(limit.maxAtomic),
        'MPP_CUSTOMER_OFFER_OVER_LIMIT',409);
      return {profileId,contractSha256:profile.contract.sha256,offer:clone(offer),request,
        binding:bindingFacts(request),price:humanAmount(offer.payment.amountAtomic,offer.payment.decimals),
        limit:clone(limit)};
    },
    prepare:async({profileId,offerId,options})=>{
      const profile=await selectedProfile(workspace,profileId);
      keys(options,['purchaseId','query','json','challengeId'],'MPP_CUSTOMER_PREPARATION_INVALID');
      const purchaseId=id(options.purchaseId),inputs={
        ...(options.query!==undefined?{query:options.query}:{}),
        ...(Object.hasOwn(options,'json')?{json:options.json}:{})};
      const request=buildCustomerRequest(profile.contract,offerId,inputs);
      const offer=profile.contract.offers.find(row=>row.id===offerId);
      const limit=profile.configuration.assetLimits.find(row=>row.network===offer.payment.network &&
        row.currency===offer.payment.currency && row.decimals===offer.payment.decimals);
      requireValue(limit && BigInt(offer.payment.amountAtomic)<=BigInt(limit.maxAtomic),
        'MPP_CUSTOMER_OFFER_OVER_LIMIT',409);
      if(options.challengeId!==undefined)requireValue(typeof options.challengeId==='string' &&
        options.challengeId.length>0 && options.challengeId.length<=512,'MPP_CUSTOMER_CHALLENGE_ID_INVALID');
      const preparation={schema:'stellar-forge.mpp-workbench-preparation.v1',purchaseId,profileId,
        profile,offerId,options:clone(options),request:bindingFacts(request)};
      await workspace.update('reports',preparationKey(purchaseId),current=>{
        if(current) {
          const {createdAt,updatedAt,...identity}=current;
          requireValue(stable(identity)===stable(preparation),'MPP_CUSTOMER_PURCHASE_ID_ALREADY_BOUND',409);
          return {op:'noop',result:null};
        }
        return {op:'set',value:{...preparation,createdAt:now(),updatedAt:now()},result:null};
      });
      return prepareOriginal(preparation);
    },
    retryPreparation:async purchaseId=>{
      const preparation=await workspace.read('reports',preparationKey(purchaseId));
      requireValue(preparation?.purchaseId===purchaseId,'MPP_CUSTOMER_ORIGINAL_PREPARATION_REQUIRED',409);
      return prepareOriginal(preparation);
    },
    action:(purchaseId,action)=>customerPurchaseAction({workspace,purchaseId,action,environment}),
    resource:purchaseId=>customerResource({workspace,purchaseId}),
    resourcePreview:purchaseId=>customerResourcePreview({workspace,purchaseId}),
    refresh:async({profileId})=>{
      const profile=await selectedProfile(workspace,profileId);
      const contract=await fetchMerchantContract(profile.contract.origin,{transport:profile.configuration.transport});
      return draftFor(workspace,contract,await workspace.metadata());
    },
    snapshot:async({offset=0,limit=50}={})=>{
      requireValue(Number.isSafeInteger(offset)&&offset>=0 && Number.isInteger(limit)&&limit>=1&&limit<=100,
        'MPP_CUSTOMER_LIST_OPTIONS_INVALID');
      const metadata=await workspace.metadata();
      const profile=metadata.customer?await workspace.read('profiles',metadata.customer):null;
      const reports=await workspace.list('reports');
      const bindings=reports.filter(row=>row.schema==='stellar-forge.mpp-customer-purchase.v1');
      const preparationRows=reports.filter(row=>row.schema==='stellar-forge.mpp-workbench-preparation.v1');
      const preparations=new Set(preparationRows.map(row=>row.purchaseId));
      const bound=new Set(bindings.map(row=>row.purchaseId));
      for(const row of preparationRows)if(!bound.has(row.purchaseId))bindings.push({
        purchaseId:row.purchaseId,contractSha256:row.profile.contract.sha256,offerId:row.offerId,
        createdAt:row.createdAt,updatedAt:row.updatedAt,originalContract:row.profile.contract});
      bindings.sort((left,right)=>(right.updatedAt??right.createdAt??'').localeCompare(left.updatedAt??left.createdAt??''));
      const rows=[];
      for(const binding of bindings.slice(offset,offset+limit)) {
        const record=await workspace.read('purchases',binding.purchaseId);
        const saved=await workspace.read('reports','customer-contract:'+binding.contractSha256);
        const contract=saved?.contract??binding.originalContract;
        const customer={contractSha256:binding.contractSha256,offerId:binding.offerId,
          merchant:contract?.title,origin:contract?.origin,
          activeContractChanged:Boolean(profile && profile.contract.sha256!==binding.contractSha256)};
        if(!record){rows.push({id:binding.purchaseId,phase:'PREPARATION_INCOMPLETE',resourceReady:false,
          retryPreparation:preparations.has(binding.purchaseId),customer});continue;}
        try {rows.push(customerPurchaseView(await readOriginalCustomerPurchase(workspace,binding.purchaseId),profile?.contract));}
        catch(error) {rows.push({...purchaseView(record),phase:'CONTRACT_REVIEW_REQUIRED',resourceReady:false,
          customer:{...customer,error:error.code??'MPP_CUSTOMER_PURCHASE_IDENTITY_CHANGED'}});}
      }
      return {schema:WORKBENCH_SCHEMA,workspace:workspace.root,revision:metadata.revision,
        profileId:metadata.customer??null,profile:profile??null,purchases:{items:rows,total:bindings.length,
          nextOffset:offset+limit<bindings.length?offset+limit:null}};
    },
    isCustomerPurchase:async purchaseId=>Boolean(await workspace.read('reports',bindingKey(purchaseId)))
  });
}
