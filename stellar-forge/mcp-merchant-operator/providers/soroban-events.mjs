// MIT. Source-owned native Stellar RPC event merchant declaration.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../provider-contract.mjs';
import {sorobanEventsTools} from '../catalog/soroban-events.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'soroban-events',family:'sorobanEvents',
  title:'Soroban event workspaces',order:910,catalogOrder:910,
  configKey:'sorobanEvents',summary:true,dependencies:[],maxRequestBytes:2*1024*1024,
  concurrency:'provider',shutdown:'provider',
  configuration:{input:'sorobanEventsConnection',privateExports:true,
    read:async(value,{hostPath})=>value==null?null:
      (await import('../soroban-events/connection.mjs')).readSorobanEventsConfiguration(hostPath(value))},
  tools:sorobanEventsTools,
  instructions:[{prefix:'merchant_soroban_events_',order:910,
    text:'List and open the configured original Soroban workspace. Save complete getEvents plans with original request IDs and expected revisions. Start or resume the same native capture, inspect its fixed ledger interval and retained RPC cursor, then freeze its completed event edition. Export and download every original source file through the retained manifest/file methods; event pages preserve original RPC event objects. Receive an exact export through a configured receiver alias using that receiving workspace revision. Close the workspace before its same directory is opened in the native browser or Applications.'}],
  load:()=>import('../soroban-events/provider.mjs'),
  create:(module,config,options)=>new module.MerchantSorobanEvents(config,options.sorobanEvents),
  initialize:async options=>(await import('../soroban-events/setup.mjs')).initializeSorobanEventsMerchant(options)
});
