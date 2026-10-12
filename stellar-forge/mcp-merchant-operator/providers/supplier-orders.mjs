// MIT. Supplier-order tools use the maintained provider lifecycle and original workspace.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { supplierOrderTools } from '../catalog/supplier-orders.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'supplier-orders',family:'supplierOrders',
  title:'Supplier-order document desk',order:360,catalogOrder:360,
  configKey:'supplierOrderWorkspaces',summary:true,dependencies:[],maxRequestBytes:2097152,
  concurrentTools:Object.freeze(['merchant_supplier_order_close']),
  configuration:{input:'supplierOrderWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('../supplier-order-connection.mjs')).readSupplierOrderWorkspaceConfiguration(hostPath(value))},
  tools:supplierOrderTools,
  instructions:[{prefix:'merchant_supplier_order_',order:570,text:
    'Use one host-declared supplier-order alias and explicitly open its original workspace. Read exact order IDs, current revisions and state SHA-256 values before editing a complete confirmation, dispatch or invoice. Retain original line IDs, numeric strings, supplier and customer party trees, order/delivery references and typed serial remarks. Save the whole document with its original source selections, expected order revisions, expectedOrderStateSha256 and a reason; prepare that saved draft revision, then explicitly select its immutable XML when it should contribute to current order quantities. Keep the original requestId and reopen its operation after an interrupted response. Original XML, large native draft JSON and customer ZIP inputs are host-selected aliases with exact length/SHA. Follow every nextOffset; direct oversized records remain available through full original XML or the complete customer package. Inspect a retained file manifest then download every byte with the original file SHA and manifest SHA; resume the same endpoint, alias, exportId and private directory after interruption. Customer merge retains incoming history and preserves current customer work. Close drains accepted native work and this provider’s retained descriptors.'}],
  load:()=>import('../supplier-orders.mjs'),
  create:(module,config)=>new module.MerchantSupplierOrders(config),
  initialize:async options=>(await import('../supplier-order-connection.mjs')).initializeSupplierOrderMerchant(options)
});
