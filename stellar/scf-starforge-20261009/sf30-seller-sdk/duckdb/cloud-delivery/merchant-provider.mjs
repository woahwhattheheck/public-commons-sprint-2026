// MIT. Cloud metadata and lifecycle remain owned by the original DuckDB workspace.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {cloudWorkspaceTools} from './catalog.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'coinmetrics-cloud-workspaces',family:'cloudWorkspaces',
 title:'Cloud Delivery source editions, DuckDB and customer receiving',order:720,catalogOrder:720,
 configKey:'cloudWorkspaces',summary:true,dependencies:[],
 configuration:{input:'cloudWorkspaceConnection',privateExports:true,
  read:async(value,{hostPath})=>(await import('./managed.mjs')).readCloudWorkspaceConfiguration(hostPath(value))},
 tools:cloudWorkspaceTools,maxRequestBytes:3*1024*1024,concurrency:'provider',
 concurrentTools:['merchant_cloud_operation','merchant_cloud_runtime','merchant_cloud_close','merchant_cloud_artifact_release'],
 shutdown:'provider',requestClose:runtime=>runtime.close(),
 load:()=>import('./managed.mjs'),create:(module,config)=>new module.MerchantCloudWorkspaces(config),
 initialize:async options=>(await import('./managed.mjs')).initializeCloudMerchant(options),
 instructions:[{order:720,prefix:'merchant_cloud_',text:
  'Choose an original host-configured Cloud/DuckDB workspace alias, open it once, and retain workspaceId and workspaceInstanceId. '+
  'The browser, native source, query authoring, packages, seller and remote tools share that same owner. '+
  'Retain exact manifests and source bytes; upload bounded chunks at their immutable offset and SHA256, then commit every original source. '+
  'Cloud revisions and merchant draft revisions are separate. Use the current revision and an immutable operation ID for each declared action. '+
  'After a missing response inspect the same native operation, saved draft or package; do not invent a replacement request or payment identity. '+
  'An explicit retry of an unchanged resumable action retains its payload and operation ID. Seller start/stop require original package/runtime inspection, not automatic replay. '+
  'Comparison keys, native types, timestamp units, nullable cells, absence and tolerances are explicit; coverage and source rights are retained separately. '+
  'Public Community API input does not establish licensed Cloud entitlement. This source workspace does not acquire requester-pays objects. '+
  'Receive the original handover archive, select its retained edition, reopen its original editable draft, and save reviewed edits against the current source. '+
  'Original package, delivery and commercial history remain provenance; received data does not start a seller. '+
  'Download original artifacts through their exact SHA256/readId/offset and release descriptors. After a read expires, reopen only the same immutable selection/hash. '+
  'Close the same owner to abort/drain its native operation and stop only its owned seller/browser. Failed cleanup remains available for same-instance retry.'
 }]
});
