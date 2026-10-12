// MIT. Source-owned Kafka merchant metadata and lazy runtime hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { kafkaWorkspaceTools } from './merchant-catalog.mjs';

export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'kafka-workspaces',family:'kafkaWorkspaces',
  title:'Kafka merchant workspaces',order:385,catalogOrder:385,
  configKey:'kafkaWorkspaces',summary:true,dependencies:[],maxRequestBytes:1048576,
  configuration:{
    input:'kafkaWorkspaceConnection',privateExports:true,
    read:async(value,{hostPath})=>(await import('./merchant-tools.mjs')).readKafkaWorkspaceConfiguration(hostPath(value))
  },
  tools:kafkaWorkspaceTools,
  load:()=>import('./merchant-tools.mjs'),
  create:(module,config,options)=>new module.MerchantKafkaWorkspaces(config,options.kafka),
  initialize:async options=>(await import('./merchant-setup.mjs')).initializeKafkaWorkspaceMerchant(options),
  concurrency:'provider',shutdown:'provider',
  concurrentTools:['merchant_kafka_cancel_capture'],
  requestClose:owner=>owner.requestClose(),
  instructions:[{
    order:385,prefix:'merchant_kafka_',
    text:'Use a host-declared existing Kafka workspace. Save exact-topic connection revisions with credential environment names, inspect the original cluster/topic identity and committed bounds, then select explicit partition ranges with decimal-string offsets. Keep capture IDs and revisions through run, cancellation and resume. Project the retained capture revisions with explicit decoding, latest-key and tombstone semantics; the original NDJSON writer owns plans, builds, comparisons and merchant packages. Reuse operation names to recover the same native mutation or export. Kafka message values and unsafe numeric tokens remain exact; JSON answers represent noncanonical numbers as {$kafkaNumber:source}, while planJson accepts complete exact native JSON text. Receive full raw messages, projects, query results and merchant files through exports and file_read with the original artifact SHA and offset. Host-declared input aliases select complete imports. Closing this MCP client drains its requests and retained descriptors; Applications continues to own the original server and capture. MCP.md and CLIENT.md document the complete workflow.'
  }]
});
