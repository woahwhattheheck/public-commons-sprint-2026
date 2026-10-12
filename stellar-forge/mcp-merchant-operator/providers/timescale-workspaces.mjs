// MIT. Source-owned Timescale provider using the original publisher lifecycle.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { timescaleWorkspaceTools } from '../catalog/timescale-workspace.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'timescale-workspaces',family:'timescaleWorkspaces',
  title:'Timescale operations and publication',order:1040,catalogOrder:1040,
  configKey:'timescaleWorkspaces',summary:true,dependencies:['publishers'],
  maxRequestBytes:8388608,concurrency:'provider',shutdown:'provider',
  configuration:{input:'timescaleWorkspaceConnection',privateExports:true,dependencies:['publishers'],
    read:async(value,{config,hostPath})=>(await import('../timescale-setup.mjs')).readTimescaleWorkspaceConfiguration(hostPath(value),{publishers:config.publishers})},
  tools:timescaleWorkspaceTools,
  load:()=>import('../timescale-workspace.mjs'),
  create:(module,config,_options,dependencies)=>new module.MerchantTimescaleWorkspaces(config,dependencies.publishers),
  initialize:async options=>(await import('../timescale-setup.mjs')).initializeTimescaleWorkspaceMerchant(options),
  instructions:[{order:1040,prefix:'merchant_timescale_',text:
    'Open a host-declared Timescale workspace and retain its persistent workspaceId. Its original MerchantPublisher owns one model and scheduler; browser and agent use that same owner. Capture complete native source editions, page exact string/null tables and compare complete editions before saving every change decision. Prepare native refresh/job/projection plans with exact source and plan digests. Every mutation uses its original request UUID and inspected version; inspect the same operation after an uncertain response. A native OUTCOME_UNKNOWN dispatch is never automatically replayed. Original Timescale refresh batches, read-only full verification, role identity and time-window semantics remain in the native model. Use merchant_publisher_* for candidate review, publication, buyer preparation and schedules. Export the complete retained project through merchant_timescale_export, inspect its manifest and receive EVERY original nested file through the maintained retained-file client; use the original Timescale receive command to relocate only runtime bindings. Closing this borrowed adapter/browser drains its own reads/listener; merchant_publisher_close closes the original workspace and scheduler. These operations do not purchase data.'}]
});
