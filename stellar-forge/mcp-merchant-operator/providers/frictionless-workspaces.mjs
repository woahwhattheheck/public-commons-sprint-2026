// SPDX-License-Identifier: MIT
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {frictionlessWorkspaceTools} from '../catalog/frictionless-workspace.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'frictionless-workspaces',family:'frictionlessWorkspaces',title:'Frictionless source workbench',
 order:1075,catalogOrder:1075,configKey:'frictionlessWorkspaces',summary:true,dependencies:['publishers'],
 maxRequestBytes:8388608,concurrency:'provider',shutdown:'provider',
 configuration:{input:'frictionlessWorkspaceConnection',privateExports:true,dependencies:['publishers'],
  read:async(value,{config,hostPath})=>(await import('../frictionless-workspace-config.mjs')).readFrictionlessWorkspaceConfig(hostPath(value),{publishers:config.publishers})},
 tools:frictionlessWorkspaceTools,load:()=>import('../frictionless-workspace.mjs'),
 create:(module,config,options,dependencies)=>new module.MerchantFrictionlessWorkspaces(config,dependencies.publishers,{environment:options?.environment??process.env}),
 instructions:[{order:1075,prefix:'merchant_frictionless_',text:
  'Use one existing Frictionless publisher and its scheduler. Capture only an explicitly selected host input; current reuses the exact selected original source through native export/receive. Keep original descriptors/resources/references and all field, type, physical/logical representation and missing-value semantics. Suggested physical string projections remain drafts until reviewed; schema overrides require references already retained by the original capture. Run the full native review, retain reviewer/note and exact source SHA, then select under the original publisher compare-and-swap. Selecting promotes that publisher workspace to its maintained v2 reader so an old runtime cannot silently reopen the former source. Saved publication plans, extraction, candidate review, schedules, release and customer work stay with merchant_publisher_* and the existing original customer tools. Source mutations retain exact UUID/input/order; inspect unknown requests and explicitly resume only the same record. Capture comparisons describe file/schema/dialect changes, not row counts or outcomes. The complete source export contains the original portable source archive and frozen source-review history, not a publisher store or customer warehouse. Receive every declared file through the original retained downloader, use original frictionless source-receive, then review/select it in a receiving publisher. Close this borrowed child before the original owner; never start a second publisher or payment engine.'}]
});
