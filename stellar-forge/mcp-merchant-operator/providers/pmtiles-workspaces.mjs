// MIT. Original PMTiles workspace metadata and lazy native ownership.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {pmtilesWorkspaceTools} from '../catalog/pmtiles-workspace.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'pmtiles-workspaces',family:'pmtilesWorkspaces',
  title:'PMTiles release operations',order:330,catalogOrder:330,
  configKey:'pmtilesWorkspaces',summary:true,dependencies:[],maxRequestBytes:2*1024*1024,
  configuration:{input:'pmtilesWorkspaceConnection',privateExports:true,
    read:async(value,{config,hostPath})=>(await import('../pmtiles-workspace.mjs')).readPMTilesWorkspaceConfiguration(hostPath(value),{exportsDirectory:config.exportsDirectory})},
  tools:pmtilesWorkspaceTools,
  instructions:[{order:330,prefix:'merchant_pmtiles_',text:
    'Use a configured original workspace and stable requestId for every durable PMTiles operation. Capture sources, save an immutable edition, inspect it with the selected native runtime, record its review, prepare and publish the same release. Reopen original requests and package_info after an interrupted response. The original controller owns the browser origin and Martin lifecycle. Complete package downloads use merchant_pmtiles_download_* and the retained client; receive uses a host-selected target.'}],
  load:()=>import('../pmtiles-workspace.mjs'),
  create:(module,config)=>new module.MerchantPMTilesWorkspaces(config),
  initialize:async options=>(await import('../pmtiles-workspace.mjs')).initializePMTilesWorkspaceMerchant(options),
  concurrency:'provider',shutdown:'provider',
  requestClose:provider=>provider.requestClose()
});
