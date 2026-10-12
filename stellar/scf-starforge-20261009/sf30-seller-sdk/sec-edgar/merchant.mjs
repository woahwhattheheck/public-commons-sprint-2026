// MIT. Original SF30 seller, native Stellar factory and operator lifecycle.
import {startSellerService} from '../serve.mjs';
import {openEdgarStore} from './source.mjs';
import {validateEdgarQuery,fail} from './config.mjs';

const unavailable=error=>({status:error.status??503,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
  body:{error:error.code??'EDGAR_SOURCE_UNAVAILABLE',message:error.code?error.message:'The selected company-data edition is unavailable.'}});
export async function edgarNativeFactory(facilitator,{allowLocalFacilitator=false}={}){
  if(!facilitator)return null;
  let url;try{url=new URL(facilitator);}catch{fail('Use the configured facilitator URL.');}
  const local=allowLocalFacilitator&&url.protocol==='http:'&&url.hostname==='127.0.0.1';
  if((!local&&url.protocol!=='https:')||url.username||url.password||url.search||url.hash)
    fail('Use HTTPS for the facilitator or explicitly select its loopback listener.');
  const [{HTTPFacilitatorClient},{createNativeSellerServer}]=await Promise.all([
    import('@x402/core/server'),import('../native-factory.mjs')
  ]);
  return routes=>createNativeSellerServer(routes,{facilitatorClient:new HTTPFacilitatorClient({url:url.href.replace(/\/$/,'')})});
}
export async function createEdgarSource(compiled,{storeDirectory}={}){
  if(!storeDirectory)fail('Select the merchant’s existing edition store.');
  const store=await openEdgarStore(storeDirectory);
  let closed=false;const handlers=Object.create(null),pending=new Set();
  try{
    // Load each complete source before opening the seller. A mixed edition cannot
    // become an advertised route while a different source silently serves it.
    for(const product of compiled.products)await store.query(product.editionId,product,product.example);
    async function request(productId,query,{signal}={}){
      if(closed)fail('The company-data source is closed.',503,'EDGAR_STORE_CLOSED');
      const product=compiled.products.find(p=>p.id===productId);
      if(!product)fail('Choose a configured company-data product.');
      signal?.throwIfAborted();
      const operation=store.query(product.editionId,product,query);
      pending.add(operation);
      try{const result=await operation;signal?.throwIfAborted();return result;}
      finally{pending.delete(operation);}
    }
    for(const product of compiled.products){
      handlers[product.id+'Admission']=async context=>{
        try{
          if(closed)fail('The company-data source is closed.',503,'EDGAR_STORE_CLOSED');
          validateEdgarQuery(product,context.query??{});
          // Previewing the exact requested page also rejects a foreign cursor
          // before the original seller asks the buyer to authorize that page.
          await request(product.id,context.query??{},{signal:context.signal});
          return true;
        }catch(error){return unavailable(error);}
      };
      handlers[product.id]=async context=>{
        try{const {status,headers,body}=await request(product.id,context.query??{},{signal:context.signal});return {status,headers,body};}
        catch(error){return unavailable(error);}
      };
    }
    return {store,handlers,request,async snapshot(){
      return {schema:'stellar-forge.sec-edgar-source-status.v1',inputSha256:compiled.inputSha256,
        products:await Promise.all(compiled.products.map(async p=>({id:p.id,path:p.path,edition:(await store.getEdition(p.editionId)).record})))};
    },async close(){closed=true;await Promise.allSettled([...pending]);await store.close();}};
  }catch(error){await store.close();throw error;}
}
export async function startEdgarMerchant(compiled,{storeDirectory,nativeFactory=null,port=0,operationsPort,
  maxInFlight=64,drainGraceMs=60000,availabilityDirectory,historyDirectory,navigationOrigin}={}){
  let source,seller,operations,closing;
  async function close(){return closing??=(async()=>{
    let error,result;try{result=await seller?.close();}catch(e){error=e;}
    try{await operations?.close();}catch(e){error??=e;}
    try{await source?.close();}catch(e){error??=e;}
    if(error)throw error;return {seller:result??null,sourceClosed:true};
  })();}
  try{
    source=await createEdgarSource(compiled,{storeDirectory});
    seller=await startSellerService({config:compiled.service,handlers:source.handlers,nativeFactory,port,
      maxInFlight,drainGraceMs,availabilityDirectory});
    if(operationsPort!==undefined){
      const {startSellerOperations}=await import('../operations/server.mjs');
      operations=await startSellerOperations(seller,{port:operationsPort,historyDirectory,...(navigationOrigin?{navigationOrigin}:{})});
    }
    return {seller,source,operations,close,inputSha256:compiled.inputSha256,async snapshot(){
      return {merchantUrl:seller.url,mode:seller.mode,operationsUrl:operations?.url??null,
        lifecycle:seller.lifecycle.snapshot(),source:await source.snapshot()};
    }};
  }catch(error){await close().catch(()=>{});throw error;}
}

