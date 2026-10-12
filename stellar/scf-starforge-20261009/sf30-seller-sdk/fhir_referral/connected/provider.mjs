// MIT. Source-owned Gravity actions in the maintained Merchant provider registry.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {gravityReferralMerchantTools} from './catalog.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'gravity-referral-workspaces',family:'gravityReferrals',configKey:'gravityReferrals',
  title:'Gravity referral workspaces',order:490,catalogOrder:490,summary:true,
  configuration:{input:'gravityReferralsConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./connection.mjs')).readGravityReferralConfiguration(hostPath(value))},
  tools:()=>gravityReferralMerchantTools,
  load:()=>import('./runtime.mjs'),
  create:(module,config)=>new module.MerchantGravityReferral(config),
  initialize:async options=>(await import('./setup.mjs')).initializeGravityReferralMerchant(options),
  maxRequestBytes:262144,concurrency:'provider',shutdown:'drain',
  instructions:[{order:490,prefix:'merchant_gravity_referral_',text:
    'Select the original host-declared Gravity workspace. operator_open borrows the actual Applications operator or starts its normal native serve process when the host allows it. All77 inherited source, graph, dataset, file and eLTSS actions remain available alongside the original Gravity topology,57-requirement/24-field review, assessment, correction, conditional exchange, monitoring and whole handoff actions. Retain original request IDs, operation IDs, preview hashes, receiving UUIDs and archive hashes. Read the same exchange operation after an uncertain response; native readback and selected ETags decide continuation. input_apply uses the unchanged complete host-declared native JSON body. Published examples retain the complete original ZIP with explicit source metadata. File tools retain successful JSON and binary payloads unchanged; ordinary full-file downloading resumes exact existing bytes. Gravity handoff and workspace receiving preserve the original UUID through the native outer-archive journal. A borrowed operator remains with its original owner when Merchant closes.'}]
});
