// MIT. A single retained native facilitator, owned by the commissioned original Jobs lifetime.
import {readServiceFile} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/managed/selection.mjs';
import {canonical,plain} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/jobs/config.mjs';
import {validateConfig} from '../../stellar/scf-starforge-20261009/native-facilitator/config.mjs';
import {createNativeFacilitator} from '../../stellar/scf-starforge-20261009/native-facilitator/runtime.mjs';
import {createNativeSellerServer} from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/native-factory.mjs';
import {documentError} from './contracts.mjs';
function need(value,code){if(!value)throw documentError(code);}
export function createDocumentCommissioningFactory(selection){
  need(plain(selection)&&plain(selection.facilitator)&&plain(selection.payment)&&
    (selection.assemblyPayment===undefined||plain(selection.assemblyPayment)),
    'DOCUMENT_COMMISSION_FACTORY_SELECTION_REQUIRED');
  const chosen=structuredClone(selection),same=(a,b)=>canonical(a)===canonical(b);
  const payments=[chosen.payment,...(chosen.assemblyPayment?[chosen.assemblyPayment]:[])];
  let owner=null;
  async function originalPolicy(){
    const original=await readServiceFile(chosen.facilitator.path,1048576,{privateFile:true});
    need(original.pin.bytes===chosen.facilitator.bytes&&original.pin.sha256===chosen.facilitator.sha256,
      'DOCUMENT_COMMISSION_ORIGINAL_FACILITATOR_CHANGED');
    return validateConfig(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original.bytes)));
  }
  async function begin({environment=process.env}={}){
    need(owner===null,'DOCUMENT_COMMISSION_FACILITATOR_ALREADY_OWNED');
    const current={environment,policy:null,facilitator:null,opening:null,closing:false,closed:null};
    owner=current;
    try{current.policy=await originalPolicy();}
    catch(error){if(owner===current)owner=null;throw error;}
    need(owner===current&&!current.closing,'DOCUMENT_COMMISSION_SERVICE_DRAINING');
  }
  async function nativeFactory(compiled){
    const current=owner;
    need(current&&!current.closing&&current.policy,'DOCUMENT_COMMISSION_SERVICE_OWNER_REQUIRED');
    need(Array.isArray(compiled?.routes)&&compiled.routes.length>0,'DOCUMENT_COMMISSION_NATIVE_ROUTES_REQUIRED');
    for(const route of compiled.routes){
      need(Array.isArray(route.offer?.accepts)&&route.offer.accepts.length>0,'DOCUMENT_COMMISSION_NATIVE_TERMS_CHANGED');
      for(const terms of route.offer.accepts)need(payments.some(selected=>same(terms,selected)),
        'DOCUMENT_COMMISSION_NATIVE_TERMS_CHANGED');
    }
    need(same(await originalPolicy(),current.policy),'DOCUMENT_COMMISSION_ORIGINAL_FACILITATOR_CHANGED');
    need(owner===current&&!current.closing,'DOCUMENT_COMMISSION_SERVICE_DRAINING');
    if(!current.opening)current.opening=createNativeFacilitator(current.policy,{environment:current.environment})
      .then(value=>{current.facilitator=value;return value;});
    const facilitator=await current.opening;
    need(owner===current&&!current.closing,'DOCUMENT_COMMISSION_SERVICE_DRAINING');
    return createNativeSellerServer(compiled,{facilitatorClient:facilitator});
  }
  function close(){
    const current=owner;
    if(!current)return Promise.resolve({drained:true});
    if(current.closed)return current.closed;
    current.closing=true;
    current.closed=(async()=>{
      try{
        // A source opening may still be acquiring the original signer lease.
        if(current.opening)await current.opening.catch(()=>{});
        if(current.facilitator){
          const result=await current.facilitator.drain();
          if(result.drained===false)await current.facilitator.waitForIdle();
        }
        return {drained:true};
      }finally{if(owner===current)owner=null;current.environment=null;}
    })();
    return current.closed;
  }
  return Object.freeze({begin,nativeFactory,close});
}
