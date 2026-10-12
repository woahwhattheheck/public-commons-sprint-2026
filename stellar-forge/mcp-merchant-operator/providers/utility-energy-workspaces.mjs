// MIT. Source-owned Utility metadata and lazy original runtime hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { utilityEnergyWorkspaceTools } from '../catalog/utility-energy-workspace.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'utility-energy-workspaces',family:'utilityEnergyWorkspaces',
  title:'UtilityAPI and Green Button workspaces',order:585,catalogOrder:585,
  configKey:'utilityEnergyWorkspaces',summary:true,dependencies:[],maxRequestBytes:16*1024*1024+65536,
  configuration:{input:'utilityEnergyWorkspaceConnection',privateExports:true,
    read:async (value,{hostPath}) => (await import('../utility-energy-workspace.mjs'))
      .readUtilityEnergyWorkspaceConfiguration(hostPath(value))},
  tools:utilityEnergyWorkspaceTools,
  instructions:[{prefix:'merchant_utility_',order:95,text:
    'Attach the existing Utility console and inspect its original source binding and revision. Keep meter, channel, quantity, unit, currency, time and provenance fields in their original forms. Review the native preview and issues before saving a selection, building an edition or comparing corrected intervals. Use host-declared file, capture and buyer-workspace aliases. Every mutation supplies its reviewed integer revision and caller-retained request UUID; after an interrupted reply read that original operation before continuing. Reattach the same console after a managed restart. Prepare original complete files once, then resume retained downloads by their manifest and file hashes. Closing this MCP borrower drains its own requests and file handles while the original Python operator retains its workspace and publisher ownership.'}],
  load:() => import('../utility-energy-workspace.mjs'),
  create:(module,config) => new module.MerchantUtilityEnergyWorkspaces(config),
  initialize:async options => (await import('../utility-energy-setup.mjs')).initializeUtilityEnergyMerchant(options)
});
