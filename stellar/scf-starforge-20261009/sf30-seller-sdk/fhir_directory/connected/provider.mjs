// MIT. Directory operations in the maintained Merchant provider registry.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {humanServicesDirectoryMerchantTools} from './catalog.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'human-services-directory-workspaces',
  family:'humanServicesDirectory',configKey:'humanServicesDirectory',
  title:'Human services directory workspaces',order:495,catalogOrder:495,summary:true,
  configuration:{input:'humanServicesDirectoryConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./connection.mjs')).readHumanServicesDirectoryConfiguration(hostPath(value))},
  tools:()=>humanServicesDirectoryMerchantTools,load:()=>import('./runtime.mjs'),
  create:(module,config)=>new module.MerchantHumanServicesDirectory(config),
  initialize:async options=>(await import('./setup.mjs')).initializeHumanServicesDirectoryMerchant(options),
  maxRequestBytes:4*1024*1024+65536,concurrency:'provider',shutdown:'drain',
  instructions:[{order:495,prefix:'merchant_human_services_directory_',text:
    'Select the host-declared Human Services Directory workspace. operator_open borrows its Applications operator or starts the original native server when configured. Keep each original acquisition ID, saved import profile, complete source file, edition, reviewed mapping and service selection. Follow the exact native pagination and provider Retry-After while continuing that same acquisition. Review all source identity, linkage, schedule, capacity and mapping findings before selecting a referral destination. Task/ServiceRequest joins use explicit original resource bindings. Original Gravity and eLTSS actions remain available in the same workspace. input_apply receives the complete host-declared native JSON. Every completed action retains its complete original response, and file receiving resumes the original manifest and bytes. Whole directory workspace and handoff receiving preserve the same UUID and all source/selection history. Closing a borrowed connection leaves its original owner running.'}]
});
