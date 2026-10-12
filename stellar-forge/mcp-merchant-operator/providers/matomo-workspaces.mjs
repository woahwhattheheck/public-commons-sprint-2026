// MIT. Source-owned Matomo tools, configuration and original runtime lifecycle.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {matomoWorkspaceTools} from '../catalog/matomo-workspace.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,
  id:'matomo-workspaces',
  family:'matomoWorkspaces',
  title:'Matomo reports, merchant and customer receiving',
  order:700,catalogOrder:700,
  configKey:'matomoWorkspaces',summary:true,dependencies:[],
  configuration:{
    input:'matomoWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('../matomo-workspace.mjs'))
      .readMatomoWorkspaceConfiguration(hostPath(value))
  },
  tools:matomoWorkspaceTools,
  maxRequestBytes:131072,
  concurrency:'provider',
  concurrentTools:['merchant_matomo_cancel','merchant_matomo_close','merchant_matomo_artifact_release'],
  shutdown:'provider',
  requestClose:runtime=>runtime.close(),
  load:()=>import('../matomo-workspace.mjs'),
  create:(module,config)=>new module.MerchantMatomoWorkspaces(config),
  initialize:async options=>(await import('../matomo-workspace.mjs')).initializeMatomoWorkspaceMerchant(options),
  instructions:[{
    order:700,prefix:'merchant_matomo_',
    text:'Matomo tools own the original configured report workspace and its browser together. Choose a host alias, open it once, and retain its current workspace instance UUID. Mutations require the exact current revision and an immutable operation ID; after a lost response read that original operation before choosing its native resume/recovery. Discovery/capture contacts only the configured source. A processed report and complete returned archive traversal do not establish the raw-event population or source rights. Keep native parameter variants, hierarchy, null/absence and number values. Review exact edition/publication hashes before exporting or publishing. Seller stop uses its separate actual seller instance. Customer receiving preserves the native SF100 payment status and all source-file/operator evidence. Retained artifact reads use the original hash/read ID/offset; reopen by the same hash and offset after process restart. Close/cancel target the same original owner, cancel and drain accepted work, and preserve unfinished handles for same-instance close retry.'
  }]
});
