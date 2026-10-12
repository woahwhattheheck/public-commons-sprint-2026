// MIT. Original source-owned GDELT merchant registration and lazy owner.
import { defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { gdeltWorkspaceTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'gdelt-workspaces',family:'gdeltWorkspaces',
  title:'GDELT event desks',order:365,catalogOrder:365,configKey:'gdeltWorkspaces',summary:true,dependencies:[],
  concurrency:'host',concurrentTools:[],shutdown:'drain',maxRequestBytes:131072,
  configuration:{input:'gdeltWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp-client.mjs')).readGdeltWorkspaceConfiguration(hostPath(value))},
  tools:gdeltWorkspaceTools,load:()=>import('./mcp.mjs'),
  create:(module,config)=>new module.MerchantGdeltWorkspaces(config),
  initialize:async options=>(await import('./mcp-setup.mjs')).initializeGdeltMerchantWorkspace(options),
  instructions:[{prefix:'merchant_gdelt_',order:365,
    text:'Use the host-selected original event desk. Read the current project/revision and complete source/profile aliases. Discover an official update once, retain its discoveryId, and acquire both original ZIPs under one stable operation. GDELT code/date/decimal text, initial update counts, original EventTimeDate/DATEADDED joining, mention multiplicity and selected-source coverage remain explicit. Page full original records at expectedRevision and rows by offset; compare update membership without treating it as world-event start/stop. Save a complete customer projection and publish through the configured merchant profile. Prepare original SF88 paid intents or a bounded full Dataset with explicit page/atomic-unit limits; recover the same IDs after interruption. Deliver the complete SF100 rows, receive its full source-file dataset, reopen its saved review offline, and use the original customer application window. Read every complete source/project/purchase/delivery file through original retained chunks, keeping expectedSha256 and offset when a process-local read expires. This borrowed provider shares the existing browser owner; closing it drains its own clients and file readers.'}]
});
