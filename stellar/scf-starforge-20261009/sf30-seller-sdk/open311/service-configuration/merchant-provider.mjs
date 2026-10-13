// MIT. Complete service configuration over maintained merchant workspace and file contracts.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { serviceConfigurationWorkspaceTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'open311-service-configuration-workspaces',family:'open311ServiceConfigurationWorkspaces',
  title:'Municipal service configuration',order:390,catalogOrder:390,configKey:'open311ServiceConfigurationWorkspaces',
  summary:true,dependencies:[],concurrency:'provider',concurrentTools:[],shutdown:'provider',maxRequestBytes:131072,
  configuration:{input:'open311ServiceConfigurationWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp-client.mjs')).readServiceConfigurationWorkspaceConfiguration(hostPath(value))},
  tools:serviceConfigurationWorkspaceTools,load:()=>import('./mcp.mjs'),create:(module,config)=>new module.MerchantOpen311ServiceConfigurationWorkspaces(config),
  initialize:async options=>(await import('./mcp-setup.mjs')).initializeServiceConfigurationMerchantWorkspace(options),
  instructions:[{prefix:'merchant_open311_service_configuration_',order:390,text:'Retain the complete original request register and select its exact array. Save complete named configurations with agency, departments, staff, roles, groups, categories, custom fields, message templates, routing and rollout. Page the original requests and every saved routing result at one revision. Create source-bound previews with the exact saved profile version, explicit record overrides and any declared deployed baseline. Keep resident-facing wording distinct from internal field notes and retain the exact rendered messages. Review the selected profile and preview as a complete implementation handover. Download full original files, routing CSV, release JSON/print report and editable workspaces through the maintained file selection/hash/offset contract. Preserve the original request ID, complete host input identity and selected workspace revision when recovering an interrupted action.'}]
});
