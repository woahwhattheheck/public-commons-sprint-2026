// SPDX-License-Identifier: MIT
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {localDatasetWorkspaceTools} from '../catalog/local-dataset-workspace.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'local-dataset-workspaces',family:'localDatasetWorkspaces',title:'Local dataset customer receiving',
 order:1070,catalogOrder:1070,configKey:'localDatasetWorkspaces',summary:true,dependencies:['publishers'],
 maxRequestBytes:8388608,concurrency:'provider',shutdown:'provider',
 configuration:{input:'localDatasetWorkspaceConnection',privateExports:true,dependencies:['publishers'],
  read:async(value,{config,hostPath})=>(await import('../local-dataset-workspace-config.mjs')).readLocalDatasetWorkspaceConfig(hostPath(value),{publishers:config.publishers})},
 tools:localDatasetWorkspaceTools,load:()=>import('../local-dataset-workspace.mjs'),
 create:(module,config,_options,dependencies)=>new module.MerchantLocalDatasetWorkspaces(config,dependencies.publishers),
 instructions:[{order:1070,prefix:'merchant_local_dataset_',text:
  'Use the host-declared original Frictionless publisher and existing Python DuckDB customer. merchant_publisher_* retains source plans, extraction and candidate review; the local tools borrow that SAME publisher and scheduler. Prepare a local operator scope from the exact reviewed candidate, then receive every original cursor page through SF100. These preview/customer operations are not signed purchases. Preserve original source/quality/timestamp/value text unless a reviewed lossless conversion is explicit; mapping covers every original field, and keys may be empty to retain duplicate observations. Review/import content identities, saved view/query revisions and complete ordered expected_views remain the native customer contract. Keep parameters_text literal; precision-sensitive decimal parameters should be quoted strings with explicit SQL casts because Python retains its existing numeric semantics. All mutations use stable UUIDs; inspect uncertain requests and explicitly resume their original input. Full exports are selected explicitly. Create the complete package only after the whole source-handoff and desired reports complete; it includes original source, SF100, customer warehouse and history. Receive every declared original file through the maintained retained-file downloader and reopen a distinct warehouse working copy, preserving the immutable received package. Closing this child never stops the original Python service or another publisher owner.'}]
});
