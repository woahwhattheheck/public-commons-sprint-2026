// MIT. Source-owned metadata; native application ownership is loaded lazily.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {carbonCustomerTools} from './catalog.mjs';
export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,id:'carbon-customer-workspaces',family:'carbonCustomerWorkspaces',
 title:'Carbon customer and GiveCredit donor workspaces',order:395,catalogOrder:395,
 configKey:'carbonCustomerWorkspaces',summary:true,dependencies:[],
 maxRequestBytes:8*1024*1024,concurrency:'provider',shutdown:'provider',
 concurrentTools:['merchant_carbon_capture','merchant_carbon_close'],
 configuration:{input:'carbonCustomerConnection',privateExports:true,
  read:async(value,{hostPath})=>(await import('./configuration.mjs')).readCarbonCustomerConfiguration(hostPath(value))},
 tools:carbonCustomerTools,
 instructions:[{prefix:'merchant_carbon_',order:395,text:
  'Operate configured original Stellarcarbon and GiveCredit workspaces. Open the returned exact instance and read current state/source IDs before saving. Managed mode attaches to an existing loopback Applications listener; owned mode starts the maintained native server and owns only that service. Customer/project assignments are operator records; project IDs or wallet addresses do not identify a named customer by themselves. Receipt payment hashes anchor source transactions; original successful network, envelope, operation/event, asset and atomic amount identify a transfer. Preview and save funding capacity, source order, exact payout classification and frozen bridge allocation revisions through the native engine. Preserve original decimal strings and TOIDs. Statement periods include fromDate and exclude beforeDate; registry creation, ledger close and retirement dates remain separate. Later certificate allocations are known at the retained source edition, not necessarily period end. Compare only covered source tables and keep unavailable metadata explicit. Use stable request IDs, observed workspace revision and record expectedVersion. After an uncertain return inspect and resume the same saved request. Complete sources, capture options and API keys stay in configured private files; existing source captures run through the native collector with original checkpoints. A capture restart is an explicit resume of its original selection. Download complete original files, saved statement HTML/JSON/CSV and whole editable handover, retaining export ID/SHA/offset. Independent receiving uses a configured destination and the original workspace constructor; open its returned alias and verify preserved versions before editing. Original accounting invoices require the selected maintained accounting binding and agreed service terms. Closing managed mode detaches; closing owned mode drains its own native capture and workspace. Keep a current receiver process/source selection intact when adding this provider to a later source edition.'}],
 load:()=>import('./merchant.mjs'),
 create:(module,config,options={})=>new module.MerchantCarbonCustomerWorkspaces(config,options),
 requestClose:runtime=>runtime.requestClose(),
 initialize:async options=>(await import('./merchant-setup.mjs')).initializeCarbonCustomerMerchant(options)
});
