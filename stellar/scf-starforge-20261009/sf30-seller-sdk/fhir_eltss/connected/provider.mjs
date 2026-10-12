// MIT. Lazy eLTSS workspace tools in the maintained merchant provider registry.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {eltssMerchantTools} from './catalog.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'eltss-careplan-workspaces',family:'eltssCareplans',configKey:'eltssCareplans',
  title:'eLTSS care-plan workspaces',order:485,catalogOrder:485,summary:true,
  configuration:{input:'eltssConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./connection.mjs')).readEltssConfiguration(hostPath(value))},
  tools:()=>eltssMerchantTools,
  load:()=>import('./runtime.mjs'),
  create:(module,config)=>new module.MerchantEltss(config),
  initialize:async options=>(await import('./setup.mjs')).initializeEltssMerchant(options),
  maxRequestBytes:262144,concurrency:'provider',shutdown:'drain',
  instructions:[{order:485,prefix:'merchant_eltss_',text:
    'Select an original configured workspace. operator_open borrows the same native operator used by Applications, or starts its normal serve process when the host allows it. Read complete native state and saved operations. Keep the original request and operation IDs for advance, pause and resume; the native engine owns remote GETs, paging and retries. Field review, scoped decisions and corrections use their original immutable selections. Use input_apply with a host-declared JSON file for full requests beyond a small MCP envelope. Connection/input paths are private host configuration. All completed responses and binary downloads are retained as complete immutable files, exposed by manifest/file/file_release and the ordinary resumable receiver. receive_export can receive an existing full source/customer/workspace packet into another configured workspace. A borrowed Applications operator stays with its original owner after merchant shutdown.'}]
});
