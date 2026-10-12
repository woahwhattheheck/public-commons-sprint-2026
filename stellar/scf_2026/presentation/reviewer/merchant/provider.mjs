// MIT. Source-owned purchase-reviewer metadata and lazy original-owner hooks.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {reviewerMerchantTools} from './catalog.mjs';
import {MAX_PACKET_BYTES} from './contracts.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'grant-reviewer-workbenches',family:'grantReviewers',
  title:'Original grant purchase reviewer',order:420,catalogOrder:420,configKey:'grantReviewers',
  maxRequestBytes:Math.ceil(MAX_PACKET_BYTES/3)*4+65536,
  configuration:{input:'grantReviewerConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./connection.mjs')).readReviewerConfiguration(hostPath(value))},
  tools:()=>reviewerMerchantTools,
  load:()=>import('./runtime.mjs'),
  create:(module,config)=>new module.MerchantGrantReviewers(config),
  initialize:async options=>(await import('./setup.mjs')).initializeReviewerMerchant(options),
  concurrency:'host',shutdown:'drain',
  instructions:[{order:420,prefix:'merchant_grant_reviewer_',
    text:'Use the host-declared original purchase-reviewer workbench. Explicitly open or borrow its current controller; preserve its workbench ID, selection revision and original action UUID. A borrowed Applications controller stays with its owner. Review and receive the original complete packet, open only its saved Buyer and read complete original quote/results. Export closes and drains that original Buyer before native history is read. Retained manifests, full-file download and independent receiving preserve original bytes and payments. After a lost reply, read the saved action UUID or replay its exact inputs. Do not connect a signer or create a new purchase. Private workbench and Buyer access codes stay in the host process and are never tool outputs.'}]
});
