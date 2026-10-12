// MIT. Original source-owned WFS merchant registration and lazy owner.
import { defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { wfsWorkspaceTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'wfs-workspaces',family:'wfsWorkspaces',
  title:'WFS feature workspaces',order:366,catalogOrder:366,configKey:'wfsWorkspaces',summary:true,dependencies:[],
  concurrency:'host',concurrentTools:['merchant_wfs_cancel'],shutdown:'provider',maxRequestBytes:131072,
  configuration:{input:'wfsWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp-client.mjs')).readWfsWorkspaceConfiguration(hostPath(value))},
  tools:wfsWorkspaceTools,load:()=>import('./mcp.mjs'),
  create:(module,config)=>new module.MerchantWfsWorkspaces(config),
  initialize:async options=>(await import('./mcp-setup.mjs')).initializeWfsMerchantWorkspace(options),
  instructions:[{prefix:'merchant_wfs_',order:366,
    text:"Use the host-selected WFS project. Capture the actual service catalog and feature schema, save exact CRS spelling and explicit sort properties, then acquire complete original response pages under one order ID. Read the current revision and retain the same operation on interruption. Compare complete editions with explicit key treatment. Publish with the configured merchant terms, recover original Buyer intents and complete Dataset acquisitions, receive all source files through the existing SF100 engine, and reopen the original project offline. Full files use retained chunk reads with their original digest and offset. Closing this borrowed provider drains its own clients and file readers."}]
});
