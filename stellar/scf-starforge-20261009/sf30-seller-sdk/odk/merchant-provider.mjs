// MIT. Source-owned Central provider for the maintained merchant registry.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA}
  from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {odkWorkspaceTools} from './mcp-catalog.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'odk-workspaces',family:'odkWorkspaces',
  title:'ODK Central field reporting and retained receiving',order:1020,catalogOrder:1020,
  configKey:'odkWorkspaces',summary:true,dependencies:[],
  configuration:{input:'odkWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./mcp.mjs')).readCentralWorkspaceConfiguration(hostPath(value))},
  tools:odkWorkspaceTools,load:()=>import('./mcp.mjs'),
  create:(module,config)=>new module.MerchantCentralWorkspaces(config),
  initialize:async options=>(await import('./setup.mjs')).initializeCentralWorkspaceMerchant(options),
  maxRequestBytes:64*1024*1024,
  concurrentTools:['merchant_odk_status','merchant_odk_capture_status','merchant_odk_capture_pause'],
  instructions:[{prefix:'merchant_odk_',order:1020,text:
    'ODK Central tools attach to the same original leased listener in Applications. Open its saved application, inspect merchant_odk_status and connect the configured alias. Source profiles retain native connection IDs, original Central URLs and existing authorization environment names; credentials stay on the host. Retain the exact plan/capture/report/export/archive ID and complete input before a mutation; after an interrupted response inspect that same original operation and repeat exact input. Native capture preserves root/repeat tables, published form generations, submission XML versions and available media with provider source receipts. A review records field interpretation and exact numeric indicator definitions before dataset publication. Original SF82 release generation governs prepare, activate and rollback. Stream exact source/export descriptors with their SHA-256 and byte count into merchant_odk_file_retain, then use the original SHA/offset reader; complete retained files remain readable after Applications stops. Restore the original full archive through Applications before opening the one writer. MCP disconnect and shutdown release only this attachment and read handles; Applications Stop drains the original HTTP/capture/workspace lifecycle. Private browser URLs belong to the selected operator session.'
  }],
});
