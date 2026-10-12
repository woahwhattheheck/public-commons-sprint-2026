// MIT. Source-owned GIS merchant registration over the installed workspace and file contracts.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { gisWorkspaceTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'open311-gis-workspaces',family:'open311GISWorkspaces',
  title:'Open311 GIS handoff desks',order:387,catalogOrder:387,configKey:'open311GISWorkspaces',
  summary:true,dependencies:[],concurrency:'provider',concurrentTools:[],shutdown:'provider',maxRequestBytes:131072,
  configuration:{input:'open311GISWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp-client.mjs')).readGISWorkspaceConfiguration(hostPath(value))},
  tools:gisWorkspaceTools,load:()=>import('./mcp.mjs'),create:(module,config)=>new module.MerchantOpen311GISWorkspaces(config),
  initialize:async options=>(await import('./mcp-setup.mjs')).initializeGISMerchantWorkspace(options),
  instructions:[{prefix:'merchant_open311_gis_',order:387,text:'Use the host-selected GIS workspace and original file aliases. Read its workspace identity and revision, inspect a complete collection/report source, then save a named handoff with explicit filters and analyst defaults. Download the full GeoPackage, GeoJSON, CSV or JSON; geometry, team, asset, work-order, priority, action, due date and analyst note are separate from immutable city source fields. Retain returned files, inspect proposals/conflicts/missing rows, and review selected proposals against the current source-linked handoff edition. A dispatch includes rows with a saved accepted decision and action dispatch; choose its actual recipient-system column names. Preserve all source statuses, closure notes, timestamps and original projected coordinates. Receive whole packages into a new empty GIS desk and reopen the same editable workflow. Recover uncertain actions using the original requestId and inputs. All file downloads use the maintained retained-reader selection/hash/offset contract.'}]
});
