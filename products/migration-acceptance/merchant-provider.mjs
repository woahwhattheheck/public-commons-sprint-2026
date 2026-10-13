// SPDX-License-Identifier: MIT
// Additive source registration; native application ownership stays with Applications.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {migrationTools} from './tools.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,
  id:'migration-acceptance',family:'migrationAcceptance',configKey:'migrationAcceptance',
  title:'Migration Acceptance Workbench',order:1180,catalogOrder:1180,summary:true,dependencies:[],
  configuration:{input:'migrationAcceptanceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp.mjs')).readMigrationAcceptanceConfiguration(hostPath(value))},
  tools:migrationTools,load:()=>import('./mcp.mjs'),
  create:(module,config)=>new module.MerchantMigrationWorkspaces(config),
  initialize:async options=>(await import('./setup.mjs')).initializeMigrationAcceptanceMerchant(options),
  // Preserve a complete original 32 MiB action/source JSON plus MCP framing.
  maxRequestBytes:32*1024*1024+65536,
  instructions:[{prefix:'merchant_migration_',order:1180,text:
    'Migration Acceptance tools attach to the original Applications-owned customer listener. Read status and connect a host-declared alias; never infer a source-host path or supply a bearer token. Inspect the complete installation, current project, source, native plan and acceptance state before acting. Project creation and every action retain the exact actor, request ID, expected revision and full payload before dispatch. After any uncertain response, inspect requests and replay that exact original request; do not generate a replacement ID or interpret a transport error as an uncommitted action. Use upload_input for complete host-declared files or resume the original upload with its selected SHA, byte count and committed offset. MCP inline chunks are at most 196608 bytes; declared local inputs stream through original 8 MiB chunks. Native extraction, normalization, loading, retries, abort and verification use the existing application jobs and original runtime. An acceptance report is evidence, not permission: required parity, keys and relationships remain blocking, reviewable exceptions require the original explicit actor-bound decision, and cutover binds the latest complete verify job, report and decision. Consumer reads carry the actual selected cutover or rollback binding and must page every stream to its complete observed row count. Retain full original artifacts with their declared byte count and SHA; never substitute a preview for the customer output. Retained responses expose JSON pointers and full immutable byte reads, including after the application stops. Keep the returned read ID and exact SHA on continuation; release only that read when done. Named complete NDJSON handoffs retain source, history, native files and acceptance decisions; private authentication, connections and host runtime bindings remain outside customer exports. Fresh or forward receiving uses the original handoff.receive action and explicit receiving-host runtime selection. Disconnect releases this client attachment; Applications Stop owns the original process and its drain. The product is authored by TJLabs using original dlt/DuckDB sources; its company-specific reference identity does not imply third-party endorsement.'
  }]
});
