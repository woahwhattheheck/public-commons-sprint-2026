// SPDX-License-Identifier: MIT
import { defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { gleifMerchantTools } from './operator-tools.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'gleif-research',family:'gleifResearch',configKey:'gleifWorkspaces',
  title:'GLEIF company research',order:1470,catalogOrder:1470,summary:true,dependencies:[],
  configuration:{input:'gleifConnection',privateExports:true,read:async(value,{hostPath})=>(await import('./operator.mjs')).readGleifOperatorConfiguration(hostPath(value))},
  tools:gleifMerchantTools,maxRequestBytes:16777216,concurrency:'provider',concurrentTools:['merchant_gleif_pause','merchant_gleif_disconnect'],
  shutdown:'provider',requestClose:runtime=>runtime.close(),load:()=>import('./operator.mjs'),create:(module,config)=>new module.MerchantGleif(config.gleifWorkspaces),
  instructions:[{order:1470,prefix:'merchant_gleif_',text:'Use the host-selected GLEIF company research project. Preserve original capture and request IDs and source URLs; resume completed pages within their original query. The legal entity status and the LEI registration status are distinct. Entity names, jurisdiction, registered identifiers and all parent or successor references retain their source meaning. A legal-name search returns candidates for research. Save reviewer decisions against exact original resources and retain changed sources for review. Absence from a later search is only absence from that selected result. Full project receiving carries original response bytes, research history, reports and native datasets. Applications owns the listener and workspace lifecycle.'}]
});
