// MIT. Source-owned follow-through merchant registration over the installed workspace and file contracts.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { followThroughWorkspaceTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'open311-follow-through-workspaces',family:'open311FollowThroughWorkspaces',
  title:'Municipal follow-through desks',order:388,catalogOrder:388,configKey:'open311FollowThroughWorkspaces',
  summary:true,dependencies:[],concurrency:'provider',concurrentTools:[],shutdown:'provider',maxRequestBytes:131072,
  configuration:{input:'open311FollowThroughWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp-client.mjs')).readFollowThroughWorkspaceConfiguration(hostPath(value))},
  tools:followThroughWorkspaceTools,load:()=>import('./mcp.mjs'),create:(module,config)=>new module.MerchantOpen311FollowThroughWorkspaces(config),
  initialize:async options=>(await import('./mcp-setup.mjs')).initializeFollowThroughMerchantWorkspace(options),
  instructions:[{prefix:'merchant_open311_follow_through_',order:388,text:'Use the original host-selected source and metadata files. Import exact request and work-order editions with separate source series, save explicit identity/status/date/relationship mappings, and build a named follow-through edition. A request-only edition remains usable. Search original orders for manual relationship review; do not infer service references equal work-order IDs. Assign internal work and approve selected actions against their exact source versions. Preserve original projected points until a named interpretation is chosen. Export editable reviewer files, inspect source/preimage conflicts and accept or reject selected changes. Download complete reviewed dispatch JSON, CSV or GeoJSON and printable operating reports. Receive full workspace history into an empty selected desk. Preserve the original requestId and full file identity for replay; all downloads use the maintained retained-reader selection/hash/offset contract.'}]
});
