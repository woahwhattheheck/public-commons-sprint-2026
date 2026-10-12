// MIT. Lazy FHIR workspace tools in the maintained merchant provider registry.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {fhirMerchantTools} from './catalog.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'fhir-bulk-workspaces',family:'fhirBulk',configKey:'fhirBulk',
  title:'FHIR Bulk Data workspaces',order:480,catalogOrder:480,summary:true,
  configuration:{input:'fhirBulkConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./connection.mjs')).readFhirConfiguration(hostPath(value))},
  tools:()=>fhirMerchantTools,
  load:()=>import('./runtime.mjs'),
  create:(module,config)=>new module.MerchantFhirBulk(config),
  initialize:async options=>(await import('./setup.mjs')).initializeFhirMerchant(options),
  maxRequestBytes:262144,concurrency:'provider',shutdown:'drain',
  instructions:[{order:480,prefix:'merchant_fhir_bulk_',text:
    'Select an original configured workspace. operator_open borrows the same native operator used by Applications, or starts its normal serve process when the host allows it. Read complete native state and saved operations. Keep the original acquisition operation ID for advance, status recovery and cancellation; the native engine owns remote polling and retries. Connection/input paths are private host configuration. All completed responses and binary downloads are retained as complete immutable files, exposed by manifest/file/file_release and the ordinary resumable receiver. receive_export can receive an existing full source/customer/workspace packet into another configured workspace. A borrowed Applications operator stays with its original owner after merchant shutdown.'}]
});
