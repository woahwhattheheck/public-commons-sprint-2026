// MIT. Source-owned municipal field-work registration over maintained merchant workspace and file contracts.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { fieldDeskWorkspaceTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'open311-field-desk-workspaces',family:'open311FieldDeskWorkspaces',
  title:'Municipal field-work desks',order:389,catalogOrder:389,configKey:'open311FieldDeskWorkspaces',
  summary:true,dependencies:[],concurrency:'provider',concurrentTools:[],shutdown:'provider',maxRequestBytes:131072,
  configuration:{input:'open311FieldDeskWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp-client.mjs')).readFieldDeskWorkspaceConfiguration(hostPath(value))},
  tools:fieldDeskWorkspaceTools,load:()=>import('./mcp.mjs'),create:(module,config)=>new module.MerchantOpen311FieldDeskWorkspaces(config),
  initialize:async options=>(await import('./mcp-setup.mjs')).initializeFieldDeskMerchantWorkspace(options),
  instructions:[{prefix:'merchant_open311_field_desk_',order:389,text:'Receive the complete original approved Follow-through dispatch or editable source workspace through a host-selected file. Preserve request, order, relationship and approval identities while assigning named crews and visits. Issue selected offline field packages, retain original photos/files and explicit resource quantities, and import complete field returns. Review overlapping or partial proposals against their original visit versions, accept or reject named selections, and approve destination update packages explicitly. Keep field observations separate from municipal source status and operator approval. Download full customer packages and original attachments through the maintained retained-reader selection/hash/offset contract. Receive the full editable history into an empty selected desk. Preserve the original requestId, full file identity and selected workspace revision for recovery.'}]
});
