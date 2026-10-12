// MIT. GTFS owns its source provider; original merchant lifecycle owns execution.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { gtfsWorkspaceTools } from './catalog.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'gtfs-workspaces',family:'gtfsWorkspaces',
  title:'GTFS Schedule merchant workspaces',order:705,catalogOrder:705,
  configKey:'gtfsWorkspaces',summary:true,dependencies:['publishers'],
  configuration:{input:'gtfsWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./merchant.mjs')).readGtfsWorkspaceConfiguration(hostPath(value))},
  maxRequestBytes:1048576,concurrency:'provider',shutdown:'provider',
  concurrentTools:['merchant_gtfs_status','merchant_gtfs_operation','merchant_gtfs_workspaces',
    'merchant_gtfs_file_read','merchant_gtfs_file_release','merchant_gtfs_publisher_status',
    'merchant_gtfs_publisher_inspect','merchant_gtfs_publisher_cancel','merchant_gtfs_close'],
  requestClose:provider=>provider.close(),
  tools:gtfsWorkspaceTools,
  load:()=>import('./merchant.mjs'),
  create:(module,config,options,dependencies)=>new module.MerchantGtfsWorkspaces(config,dependencies.publishers),
  initialize:async options=>(await import('./merchant.mjs')).initializeGtfsMerchant(options),
  instructions:[{order:705,prefix:'merchant_gtfs_',
    text:'Open the host-declared original GTFS workspace once; MCP and its browser share the same publisher and scheduler. Retain the inspected complete original ZIP with exact bytes/hash. Page the source catalog and select actual service dates, agencies, routes and complete original tables. Save immutable editions, inspect all relevant rows, compare exact hashes and record decisions. Select a saved edition before a new original publisher plan. merchant_gtfs_publisher_* calls the same native publisher: preserve plan digests, run/review IDs, candidate hashes, target revisions and schedule policy. Saved source actions require one requestId and expectedRevision; recover the identical original request before choosing another ID. Export the complete workspace through its original external request journal and receive every exact manifest file with the maintained readId/SHA/offset contract. Archive receiving uses the original GTFS CLI on a host-declared new directory. Close only the current process-owned instance and preserve all original source and publication histories.'}],
});
