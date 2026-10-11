// MIT. Native customer API over the original MPP buyer and original accounting.
import { openWorkspace, hash, stable, plain, requireValue, id, now } from '../storage.mjs';
import { absolute, atomic, buyerConfig, clone, bindingFacts, terms } from '../config.mjs';
import { preparePurchase, executePurchase, finalizePurchase, purchaseView } from '../buyer.mjs';
import { storedResponse } from '../merchant.mjs';
import { exportResponse } from '../server.mjs';
import { CUSTOMER_API_VERSION, parseContract, buildCustomerRequest, compareContracts, fetchMerchantContract } from './contract.mjs';

const keys=(value,allowed,code)=>requireValue(plain(value) && Object.keys(value).every(k=>allowed.includes(k)),code);
const assetKey=value=>value.network+'\n'+value.currency;
const purchaseKey=purchaseId=>'customer-purchase:'+id(purchaseId);
const contractKey=digest=>'customer-contract:'+digest;
export function customerConfiguration(value,inputContract) {
  const contract=parseContract(inputContract);
  keys(value,['schema','workspace','operator','signer','dependencyRoot','assetLimits','rpcUrl','transport'],
    'MPP_CUSTOMER_CONFIGURATION_INVALID');
  requireValue(value.schema===undefined || value.schema===CUSTOMER_API_VERSION,'MPP_CUSTOMER_CONFIGURATION_VERSION');
  requireValue(Array.isArray(value.assetLimits) && value.assetLimits.length>0 && value.assetLimits.length<=64,
    'MPP_CUSTOMER_ASSET_LIMITS_REQUIRED');
  const seen=new Set();
  const assetLimits=value.assetLimits.map(limit=>{
    keys(limit,['network','currency','decimals','maxAtomic','maxFeeStroops'],'MPP_CUSTOMER_ASSET_LIMIT_INVALID');
    const payment=terms({...limit,recipient:contract.offers[0].payment.recipient,amountAtomic:limit.maxAtomic});
    requireValue(!seen.has(assetKey(payment)),'MPP_CUSTOMER_DUPLICATE_ASSET_LIMIT');
    seen.add(assetKey(payment));
    return {network:payment.network,currency:payment.currency,decimals:payment.decimals,
      maxAtomic:payment.amountAtomic,maxFeeStroops:atomic(limit.maxFeeStroops??'100000')};
  });
  const offer=contract.offers.find(o=>assetLimits.some(l=>assetKey(l)===assetKey(o.payment) && l.decimals===o.payment.decimals));
  requireValue(offer,'MPP_CUSTOMER_MATCHING_ASSET_REQUIRED');
  const limit=assetLimits.find(l=>assetKey(l)===assetKey(offer.payment));
  const probe=buyerConfig({intentId:'customer-configuration',request:{url:offer.url,method:offer.method},
    expect:{realm:contract.realm,...offer.payment,maxAtomic:limit.maxAtomic,maxFeeStroops:limit.maxFeeStroops},
    operator:value.operator,signer:value.signer,dependencyRoot:value.dependencyRoot,
    ...(value.rpcUrl?{rpcUrl:value.rpcUrl}:{}),...(value.transport?{transport:value.transport}:{})});
  return {schema:CUSTOMER_API_VERSION,workspace:absolute(value.workspace),operator:probe.operator,
    signer:probe.signer,dependencyRoot:probe.dependencyRoot,assetLimits,
    ...(probe.rpcUrl?{rpcUrl:probe.rpcUrl}:{}),...(probe.transport?{transport:probe.transport}:{})};
}
export { customerConfigurationTemplate } from './contract.mjs';

function profileFor(contract,configuration,offerId,options) {
  keys(options,['purchaseId','query','json','challengeId'],'MPP_CUSTOMER_PREPARATION_INVALID');
  const offer=contract.offers.find(o=>o.id===offerId);requireValue(offer,'MPP_CUSTOMER_OFFER_NOT_FOUND',404);
  const limit=configuration.assetLimits.find(l=>assetKey(l)===assetKey(offer.payment) && l.decimals===offer.payment.decimals);
  requireValue(limit && BigInt(offer.payment.amountAtomic)<=BigInt(limit.maxAtomic),'MPP_CUSTOMER_OFFER_OVER_LIMIT',409);
  if(options.challengeId!==undefined) requireValue(typeof options.challengeId==='string' &&
    options.challengeId.length>0 && options.challengeId.length<=512,'MPP_CUSTOMER_CHALLENGE_ID_INVALID');
  const inputs={...(options.query!==undefined?{query:options.query}:{}),
    ...(Object.hasOwn(options,'json')?{json:options.json}:{})};
  return buyerConfig({intentId:id(options.purchaseId),request:buildCustomerRequest(contract,offerId,inputs),
    expect:{realm:contract.realm,...offer.payment,maxAtomic:offer.payment.amountAtomic,maxFeeStroops:limit.maxFeeStroops},
    operator:configuration.operator,signer:configuration.signer,dependencyRoot:configuration.dependencyRoot,
    ...(configuration.rpcUrl?{rpcUrl:configuration.rpcUrl}:{}),
    ...(configuration.transport?{transport:configuration.transport}:{})});
}
export async function initializeCustomer({contract,configuration}={}) {
  const config=customerConfiguration(configuration,contract);
  const workspace=await openWorkspace(config.workspace,{create:true});
  try {return {workspace:workspace.root,...await workspace.metadata()};} finally {await workspace.close();}
}
export async function connectCustomer({contract:inputContract,configuration:inputConfiguration,environment=process.env}={}) {
  const contract=parseContract(inputContract),configuration=customerConfiguration(inputConfiguration,contract);
  const workspace=await openWorkspace(configuration.workspace);
  let tail=Promise.resolve(),closing=false,closePromise;
  const serial=fn=>{
    requireValue(!closing,'MPP_CUSTOMER_CLOSED');
    const pending=tail.then(fn);tail=pending.catch(()=>{});return pending;
  };
  try {
    const old=await workspace.read('reports',contractKey(contract.sha256));
    if(old) requireValue(parseContract(old.contract).sha256===contract.sha256,'MPP_RETAINED_CUSTOMER_CONTRACT_CHANGED');
    else await workspace.put('reports',contractKey(contract.sha256),{
      schema:'stellar-forge.mpp-retained-customer-contract.v1',contract,createdAt:now(),updatedAt:now()});
    async function loadPurchase(purchaseId) {
      const binding=await workspace.read('reports',purchaseKey(purchaseId));
      requireValue(binding?.schema==='stellar-forge.mpp-customer-purchase.v1','MPP_CUSTOMER_PURCHASE_NOT_FOUND',404);
      const saved=await workspace.read('reports',contractKey(binding.contractSha256));
      requireValue(saved,'MPP_ORIGINAL_CUSTOMER_CONTRACT_REQUIRED',409);
      const original=parseContract(saved.contract,{expectedSha256:binding.contractSha256});
      requireValue(original.origin===contract.origin && original.offers.some(o=>o.id===binding.offerId),
        'MPP_CUSTOMER_MERCHANT_MISMATCH',409);
      const row=await workspace.read('purchases',purchaseId);
      requireValue(row,'MPP_CUSTOMER_PURCHASE_NOT_PREPARED',409);
      requireValue(row.profileId===binding.profileId && hash(stable(buyerConfig(row.profile)))===binding.profileId &&
        stable(row.intent.request)===stable(binding.request),'MPP_CUSTOMER_PURCHASE_IDENTITY_CHANGED',409);
      const expectedScope=hash(stable({schema:'stellar-forge.mpp-scope.v1',profileId:original.profileId,
        route:binding.offerId,...binding.request}));
      let meta;
      try {meta=row.challenge.opaque?JSON.parse(Buffer.from(row.challenge.opaque,'base64url').toString('utf8')):
        row.challenge.meta;} catch {requireValue(false,'MPP_CUSTOMER_NATIVE_SCOPE_INVALID',409);}
      requireValue(meta?._mppx_scope===expectedScope,'MPP_CUSTOMER_NATIVE_CONTRACT_CHANGED',409);
      return {binding,original,row};
    }
    const view=({binding,original,row})=>({...purchaseView(row),customer:{
      contractSha256:original.sha256,offerId:binding.offerId,merchant:original.title,origin:original.origin,
      activeContractChanged:original.sha256!==contract.sha256}});
    function purchase(purchaseId) {
      id(purchaseId);
      return Object.freeze({id:purchaseId,
        inspect:()=>serial(async()=>view(await loadPurchase(purchaseId))),
        execute:()=>serial(async()=>{await loadPurchase(purchaseId);
          await executePurchase({workspace,purchaseId,environment});return view(await loadPurchase(purchaseId));}),
        resume:()=>serial(async()=>{await loadPurchase(purchaseId);
          await executePurchase({workspace,purchaseId,environment,resume:true});return view(await loadPurchase(purchaseId));}),
        finalize:()=>serial(async()=>{await loadPurchase(purchaseId);
          await finalizePurchase({workspace,purchaseId,environment});return view(await loadPurchase(purchaseId));}),
        result:()=>serial(async()=>{
          const {binding,original,row}=await loadPurchase(purchaseId);
          requireValue(row.response?.status>=200 && row.response.status<300 && row.response.status!==202 &&
            row.receipt?.method==='stellar' && row.receipt.status==='success' &&
            row.receipt.reference?.toLowerCase()===row.transaction,'MPP_CUSTOMER_RESPONSE_PENDING',409);
          return {response:storedResponse(row.response),receipt:clone(row.receipt),transaction:row.transaction,
            accounting:clone(row.finality??{outcome:'PENDING'}),contractSha256:original.sha256,
            offerId:binding.offerId,bytes:row.response.bytes,sha256:row.response.sha256};
        }),
        save:destination=>serial(async()=>{const {row}=await loadPurchase(purchaseId);
          requireValue(row.response?.status>=200 && row.response.status<300 && row.response.status!==202 &&
            row.receipt?.method==='stellar' && row.receipt.status==='success' &&
            row.receipt.reference?.toLowerCase()===row.transaction,'MPP_CUSTOMER_RESPONSE_PENDING',409);
          return exportResponse({workspace,group:'purchases',recordId:purchaseId,destination:absolute(destination)});})
      });
    }
    return Object.freeze({
      contract:clone(contract),
      configuration:clone(configuration),
      purchase,
      prepare:(offerId,options)=>serial(async()=>{
        const profile=profileFor(contract,configuration,offerId,options),profileId=hash(stable(profile));
        const key=purchaseKey(profile.intentId),oldBinding=await workspace.read('reports',key);
        const binding={schema:'stellar-forge.mpp-customer-purchase.v1',purchaseId:profile.intentId,
          contractSha256:contract.sha256,offerId,profileId,request:bindingFacts(profile.request)};
        if(oldBinding) requireValue(stable({...oldBinding,createdAt:undefined,updatedAt:undefined})===stable(binding),
          'MPP_CUSTOMER_PURCHASE_ID_ALREADY_BOUND',409);
        else {
          const existing=await workspace.read('purchases',profile.intentId);
          requireValue(!existing || existing.profileId===profileId,'MPP_CUSTOMER_PURCHASE_ID_ALREADY_BOUND',409);
          await workspace.put('reports',key,{...binding,createdAt:now(),updatedAt:now()});
        }
        const original=await workspace.read('purchases',profile.intentId);
        if(original) requireValue(original.profileId===profileId,'MPP_CUSTOMER_PURCHASE_ID_ALREADY_BOUND',409);
        else await preparePurchase({workspace,profile,challengeId:options.challengeId});
        await loadPurchase(profile.intentId);
        return purchase(profile.intentId);
      }),
      list:(options={})=>serial(async()=>{
        keys(options,['offset','limit'],'MPP_CUSTOMER_LIST_OPTIONS_INVALID');
        const offset=options.offset??0,limit=options.limit??50;
        requireValue(Number.isSafeInteger(offset)&&offset>=0&&Number.isInteger(limit)&&limit>=1&&limit<=100,
          'MPP_CUSTOMER_LIST_OPTIONS_INVALID');
        const all=(await workspace.list('reports')).filter(row=>row.schema==='stellar-forge.mpp-customer-purchase.v1');
        const items=[];
        for(const binding of all) {
          const saved=await workspace.read('reports',contractKey(binding.contractSha256));
          if(saved?.contract?.origin!==contract.origin)continue;
          const row=await workspace.read('purchases',binding.purchaseId);
          if(!row) items.push({id:binding.purchaseId,phase:'PREPARATION_INCOMPLETE',
            customer:{contractSha256:binding.contractSha256,offerId:binding.offerId,origin:contract.origin}});
          else {
            try {items.push(view(await loadPurchase(binding.purchaseId)));}
            catch(error) {
              if(!['MPP_CUSTOMER_NATIVE_SCOPE_INVALID','MPP_CUSTOMER_NATIVE_CONTRACT_CHANGED'].includes(error.code))throw error;
              items.push({...purchaseView(row),phase:'CONTRACT_REVIEW_REQUIRED',customer:{
                contractSha256:binding.contractSha256,offerId:binding.offerId,origin:contract.origin,
                activeContractChanged:binding.contractSha256!==contract.sha256,error:error.code}});
            }
          }
        }
        return {items:items.slice(offset,offset+limit),total:items.length,
          nextOffset:offset+limit<items.length?offset+limit:null};
      }),
      refresh:()=>serial(async()=>{
        const current=await fetchMerchantContract(contract.origin,{transport:configuration.transport});
        return {contract:current,difference:compareContracts(contract,current)};
      }),
      close:()=>{
        if(!closePromise){closing=true;closePromise=tail.then(()=>workspace.close());}
        return closePromise;
      }
    });
  } catch(error){await workspace.close();throw error;}
}
