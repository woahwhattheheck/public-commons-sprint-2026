// MIT. Source-owned agent controls attach the original authenticated native operator.
import {defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {nativeOperatorTools, nativeOperatorToolPrefix} from './merchant-tools.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA, id:'native-facilitator-operators',
  family:'nativeFacilitatorOperators', title:'Native Stellar facilitator operators',
  configKey:'nativeFacilitatorOperators', order:220, catalogOrder:220, summary:true,
  dependencies:[], concurrency:'provider', shutdown:'drain',
  configuration:{input:'nativeFacilitatorOperatorConnection', privateExports:true,
    read:async(value,{hostPath})=>(await import('./merchant-connection.mjs'))
      .readNativeOperatorConfiguration(hostPath(value))},
  tools:nativeOperatorTools,
  load:()=>import('./merchant-runtime.mjs'),
  create:(module,config,options)=>new module.MerchantNativeFacilitatorOperators(config,options),
  initialize:async options=>(await import('./merchant-setup.mjs')).initializeNativeFacilitatorMerchant(options),
  instructions:[{prefix:nativeOperatorToolPrefix+'_',order:220,text:
    'Use the configured native operator alias. Read status and retain its original workspace instance, runtimeId, '+
    'profile name and file SHA256 before a mutation. Review a complete configuration and save the returned '+
    'normalized configuration with its expected review SHA256. Start a saved profile by its original file SHA256; '+
    'after an interrupted start or drain, reconcile status on the same operator. Catalog pages and exports select '+
    'that original runtimeId and observed resource version. Capture a complete profile or catalog under one stable '+
    'exportId, retain the manifest SHA256, then receive its exact files with the original retained-download client. '+
    'A repeated completed export ID returns its retained original files; an unfinished identical request resumes '+
    'its own receiving operation. Disconnect drains this alias’s accepted client work and file reads. The native '+
    'operator and its original backend lifecycle remain available through the same host operation.'}],
});
