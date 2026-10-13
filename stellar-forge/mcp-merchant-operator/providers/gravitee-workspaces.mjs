// SPDX-License-Identifier: MIT
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {graviteeWorkspaceTools} from '../catalog/gravitee-workspace.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'gravitee-workspaces',family:'graviteeWorkspaces',title:'Gravitee API commissioning workspaces',
 order:620,catalogOrder:620,configKey:'graviteeWorkspaces',summary:true,dependencies:[],shutdown:'provider',
 concurrentTools:['merchant_gravitee_export_file_release'],maxRequestBytes:256*1024*1024,
 configuration:{input:'graviteeWorkspaceConnection',privateExports:true,
  read:async(value,{hostPath,base})=>(await import('../gravitee-workspace.mjs')).readGraviteeWorkspaceConfiguration(hostPath(value,base))},
 tools:graviteeWorkspaceTools,
 instructions:[{prefix:'merchant_gravitee_',order:620,text:
  'Use the host-declared original Gravitee workspace. Import the complete original API contract and supporting Mule source files, then save the full native v4 HTTP proxy definition and source behavior dispositions. '+
  'Capture every provider page and preserve all plan statuses. Native definition imports use group names and can remove omitted plans; read their saved current-target comparison before executing the original plan SHA. '+
  'Use stable request IDs for source, capture, preparation and commissioning. Reopen the saved operation after a disconnected response; reconcile its real native effect before advancing the same sequence. '+
  'A deployment 202 is accepted work. Inspect the current deployment and actual configured-gateway observations separately. The bundled 4.12.21 deployment verification uses the implementation’s GET route. '+
  'Create a complete handover, download the saved original object, inspect each export manifest and read every file range through EOF. Large tool results are retained whole as original exports.'}],
 load:()=>import('../gravitee-workspace.mjs'),
 create:(module,config,options)=>new module.MerchantGraviteeWorkspaces(config,options.gravitee),
});
