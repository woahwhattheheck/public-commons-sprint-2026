// MIT. Complete typed-client runtime for the original supplier-order MCP tools.
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { supplierOrderPlain, validateSupplierOrderArguments, validateSupplierOrderExportId,
  SUPPLIER_ORDER_CLIENT_METHODS, SUPPLIER_ORDER_PAGED_METHODS, SUPPLIER_ORDER_EXPORT_MANIFEST,
  MAX_SUPPLIER_ORDER_FILE_BYTES, MAX_SUPPLIER_ORDER_MANIFEST_BYTES,
  SUPPLIER_ORDER_DOWNLOAD_STATE_SCHEMA, SUPPLIER_ORDER_DOWNLOAD_RESULT_SCHEMA,
  parseSupplierOrderExportManifest } from './supplier-order-contracts.mjs';
export { SUPPLIER_ORDER_CLIENT_METHODS } from './supplier-order-contracts.mjs';

const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const PREFIX='merchant_supplier_order_';
const downloads=createRetainedDownload({
  manifestName:SUPPLIER_ORDER_EXPORT_MANIFEST,parseManifest:parseSupplierOrderExportManifest,
  validateExportId:validateSupplierOrderExportId,maximumBytes:MAX_SUPPLIER_ORDER_FILE_BYTES,
  maximumManifestBytes:MAX_SUPPLIER_ORDER_MANIFEST_BYTES,
  stateSchema:SUPPLIER_ORDER_DOWNLOAD_STATE_SCHEMA,resultSchema:SUPPLIER_ORDER_DOWNLOAD_RESULT_SCHEMA,
  toolPrefix:PREFIX+'export',errorPrefix:'SUPPLIER_ORDER',clientName:'starforge-supplier-order-client',
  describe:manifest=>({workspaceId:manifest.workspaceId,kind:manifest.kind})
});
const pageIdentity={
  orderItems:['orderId','revision','stateSha256'],orderHistory:['orderId','revision','stateSha256'],
  documentLines:['id','revision','sha256'],draftLines:['draftId','revision','sha256']
};
/** One explicit alias. Construction does not open its native workspace. */
export class SupplierOrderClient {
  #client;#scoped;#options;
  constructor(client,workspace,callOptions={}){
    if(typeof workspace!=='string'||!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(workspace))
      fail('SUPPLIER_ORDER_CLIENT_CONFIGURATION','Select one host-declared supplier-order alias.');
    if(!supplierOrderPlain(client)||typeof client.call!=='function'||typeof client.endpoint!=='string'||
        !client.endpoint.trim()||client.endpoint.length>3800||/[\x00\r\n]/.test(client.endpoint))
      fail('SUPPLIER_ORDER_CLIENT_CONFIGURATION','Use the original client with its exact stable endpoint identity.');
    if(!supplierOrderPlain(callOptions)||Object.keys(callOptions).some(key=>!['requestSignal','timeoutMs'].includes(key)))
      fail('SUPPLIER_ORDER_CLIENT_CONFIGURATION','Use the original call timeout and request signal options.');
    this.workspace=workspace;this.endpoint=client.endpoint;this.#client=client;this.#options=Object.freeze({...callOptions});
    this.#scoped=Object.freeze({endpoint:JSON.stringify({endpoint:client.endpoint,workspace}),
      call:(name,args,options)=>this.call(name,args,options)});
    Object.defineProperties(this,{workspace:{writable:false},endpoint:{writable:false}});
  }
  async call(name,args={},options){
    if(!supplierOrderPlain(args)||Object.hasOwn(args,'workspace'))
      fail('SUPPLIER_ORDER_CLIENT_ARGUMENTS','This client owns its selected workspace; pass only the remaining original fields.');
    const selected=validateSupplierOrderArguments(name,{workspace:this.workspace,...args});
    const result=await this.#client.call(name,selected,{...this.#options,...options});
    if(!supplierOrderPlain(result))fail('SUPPLIER_ORDER_CLIENT_REPLY_INVALID','The original supplier-order tool returned no structured result.');
    // FAILED/INTERRUPTED operations keep their actual details for exact-ID recovery.
    return result;
  }
  /** Yield complete pages and reject a changed selected order/draft during a line/history walk. */
  async *pages(method,args={},options){
    if(!SUPPLIER_ORDER_PAGED_METHODS.includes(method))
      fail('SUPPLIER_ORDER_CLIENT_PAGINATION','Choose an original paged order, document or draft method.');
    const selected={...args};let firstIdentity;
    while(true){
      const page=await this[method](selected,options);
      if(!Array.isArray(page.items)||!Number.isSafeInteger(page.total)||page.total<0||
          !Number.isSafeInteger(page.offset)||page.offset!==(selected.offset??0)||!Object.hasOwn(page,'nextOffset'))
        fail('SUPPLIER_ORDER_CLIENT_PAGINATION','The original page omitted its full record list or exact continuation.');
      if(pageIdentity[method]){
        const identity=JSON.stringify(Object.fromEntries(pageIdentity[method].map(key=>[key,page[key]])));
        if(firstIdentity===undefined)firstIdentity=identity;
        else if(firstIdentity!==identity)fail('SUPPLIER_ORDER_CLIENT_PAGE_CHANGED',
          'The selected original order or draft changed between pages. Reopen the selection before continuing this view.');
      }
      yield page;
      const next=page.nextOffset;
      if(next===null)return;
      if(!Number.isSafeInteger(next)||next<=page.offset||next!==page.offset+page.items.length)
        fail('SUPPLIER_ORDER_CLIENT_PAGINATION','The original page did not advance after its last complete record.');
      selected.offset=next;
    }
  }
  inspectExport(exportId){return downloads.inspect({client:this.#scoped,exportId});}
  downloadExport({exportId,directory,chunkSize,onProgress,expectedManifestSha256,signal}={}){
    return downloads.download({client:this.#scoped,exportId,directory,chunkSize,onProgress,expectedManifestSha256,signal});
  }
}
for(const [method,suffix]of Object.entries(SUPPLIER_ORDER_CLIENT_METHODS)){
  Object.defineProperty(SupplierOrderClient.prototype,method,{
    value:function(args={},options){return this.call(PREFIX+suffix,args,options);},writable:false,configurable:false
  });
}
/** Reuse a native operator client or the existing authenticated merchant HTTP transport. */
export async function createSupplierOrderClient({workspace,client,url,tokenEnv,environment,signal,callOptions}={}){
  if(client!==undefined&&url!==undefined)fail('SUPPLIER_ORDER_CLIENT_CONFIGURATION','Select one native client or one MCP endpoint.');
  const selected=client??await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'SUPPLIER_ORDER',clientName:'starforge-supplier-order-client'});
  return new SupplierOrderClient(selected,workspace,callOptions);
}
