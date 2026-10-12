// SPDX-License-Identifier: MIT
// Catalogue loading remains metadata-only; native/configuration hooks are lazy.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { migrationWorkspaceTools, MAX_MIGRATION_REQUEST_BYTES } from './tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'migration-workspaces',family:'migrationWorkspaces',
  title:'Native GIS migration workspaces',order:720,catalogOrder:720,
  configKey:'migrationWorkspaces',summary:true,dependencies:[],
  maxRequestBytes:MAX_MIGRATION_REQUEST_BYTES,
  configuration:{input:'migrationWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./client.mjs')).readMigrationWorkspaceConfiguration(hostPath(value))},
  tools:migrationWorkspaceTools,concurrency:'provider',shutdown:'provider',
  concurrentTools:['merchant_migration_cancel','merchant_migration_close','merchant_migration_task'],
  requestClose:provider=>provider.requestClose(),
  load:()=>import('./client.mjs'),
  create:(module,config,options)=>new module.MerchantMigrationWorkspaces(config,{environment:options.environment}),
  instructions:[{order:720,prefix:'merchant_migration_',text:
    'Use the original host-declared workspace and source aliases. Review the actual capture, exact mapping JSON and revision before native writes; keep the same request ID for recovery. The original Python/QGIS engine owns mapping, editions, cartographic publication and receiving. Native results preserve complete JSON in resultJson; value represents exact non-integer or large numeric tokens as {$number:lexeme}. For large results use task_file with its returned exact hash. Export retains one complete native handover, including its original source and history. Receive files with the installed migration-workspace consumer, then reopen through the selected original QGIS Python.'}]
});
