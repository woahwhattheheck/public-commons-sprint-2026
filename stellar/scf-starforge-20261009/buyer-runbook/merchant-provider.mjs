// MIT. Buyer runbook tools and configuration owned by the original component.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {buyerRunbookWorkspaceTools,BUYER_AGENT_PREFIX} from './agent-contract.mjs';

export default defineMerchantProvider({
 schema:MERCHANT_PROVIDER_SCHEMA,
 id:'buyer-runbook-workspaces',family:'buyerRunbookWorkspaces',title:'Buyer receiving workspaces',
 order:345,catalogOrder:345,configKey:'buyerRunbookWorkspaces',summary:true,dependencies:[],
 concurrency:'provider',shutdown:'provider',maxRequestBytes:24*1024*1024,
 configuration:{
  input:'buyerRunbookWorkspaceConnection',privateExports:true,
  read:async(value,{hostPath})=>(await import('./agent-connection.mjs')).readBuyerAgentConfiguration(hostPath(value))
 },
 tools:buyerRunbookWorkspaceTools,
 load:()=>import('./agent-client.mjs'),
 create:(module,config)=>new module.MerchantBuyerRunbookWorkspaces(config),
 initialize:async options=>(await import('./agent-setup.mjs')).initializeBuyerRunbookMerchant(options),
 instructions:[{
  prefix:BUYER_AGENT_PREFIX,order:345,
  text:'For Buyer receiving, select a configured original workspace alias and open its current launch. Use the original Local buyer setup, complete SDK and request/paid-file handoffs, saved draft revision and native intent. Retain one exact requestId before each mutation. On an interrupted reply, read operation, resume its original idempotent preparation, or reconcile the native postimage. The existing browser panel records live-term approval. Read approval for its run/execution/operation/intent binding; cancel the exact active execution. Recover the same original result and accounting. Capture complete customer, SDK, report and accounting files under one exportId, then use the common manifest/file/readId/SHA256/offset protocol or typed downloader. Client close drains its own requests and retained readers; Applications retains the original workspace lifecycle.'
 }]
});
