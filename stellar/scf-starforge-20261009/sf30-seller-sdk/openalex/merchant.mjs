// MIT. Original SF30 payment and operator service with an OpenAlex application handler.
import {startSellerService} from '../serve.mjs';
import {createOpenAlexSource} from './source.mjs';
import {fail} from './config.mjs';

export async function openAlexNativeFactory(facilitator,{allowLocalFacilitator=false}={}){
  if(!facilitator)return null;
  let url;try{url=new URL(facilitator);}catch{fail('Use the configured facilitator URL.');}
  const local=allowLocalFacilitator&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
  if((!local&&url.protocol!=='https:')||url.username||url.password||url.search||url.hash)fail('Use HTTPS for the facilitator or an explicitly enabled local loopback endpoint.');
  const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([import('@x402/core/server'),import('../native-factory.mjs')]);
  return routes=>createNativeSellerServer(routes,{facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')})});
}
export async function startOpenAlexMerchant(compiled,{budgetDirectory,nativeFactory=null,port=8432,operationsPort,
  maxInFlight=64,drainGraceMs=60000,availabilityDirectory,historyDirectory,navigationOrigin,env=process.env}={}){
  let source=null,seller=null,operations=null,closing;
  async function close(){return closing??=(async()=>{
    let failure,result;
    try{result=await seller?.close();}catch(e){failure=e;}
    try{await operations?.close();}catch(e){failure??=e;}
    try{await source?.close();}catch(e){failure??=e;}
    if(failure)throw failure;return {seller:result??null,sourceClosed:true};
  })();}
  try{
    if(nativeFactory)source=await createOpenAlexSource(compiled,{budgetDirectory,env});
    const handlers=Object.create(null);
    for(const p of compiled.products){
      handlers[p.id]=source?.handlers[p.id]??(()=>{throw new Error('CHALLENGE_ONLY');});
      handlers[p.id+'Admission']=source?.handlers[p.id+'Admission']??(()=>true);
    }
    seller=await startSellerService({config:compiled.service,handlers,nativeFactory,port,maxInFlight,drainGraceMs,availabilityDirectory});
    if(operationsPort!==undefined){
      const {startSellerOperations}=await import('../operations/server.mjs');
      operations=await startSellerOperations(seller,{port:operationsPort,historyDirectory,...(navigationOrigin?{navigationOrigin}:{})});
    }
    return {seller,source,operations,close,inputSha256:compiled.inputSha256,async snapshot(){
      return {inputSha256:compiled.inputSha256,merchantUrl:seller.url,mode:seller.mode,operationsUrl:operations?.url??null,
        lifecycle:seller.lifecycle.snapshot(),source:source?await source.snapshot():null};
    }};
  }catch(error){await close().catch(()=>{});throw error;}
}
