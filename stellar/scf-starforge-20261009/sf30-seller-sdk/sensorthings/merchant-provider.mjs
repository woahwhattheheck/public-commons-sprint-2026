// MIT. Pure source-owned SensorThings provider metadata and lazy native hooks.
import {defineMerchantProvider,MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {sensorThingsWorkspaceTools} from './mcp-protocol.mjs';
export default defineMerchantProvider({
  schema:MERCHANT_PROVIDER_SCHEMA,id:'sensorthings-workspaces',family:'sensorthingsWorkspaces',
  title:'SensorThings observation operations',order:420,catalogOrder:420,configKey:'sensorthingsWorkspaces',
  configuration:{input:'sensorthingsWorkspaceConnection',privateExports:false,
    read:async(value,{hostPath})=>(await import('./mcp.mjs')).readSensorThingsWorkspaceConfiguration(hostPath(value))},
  tools:sensorThingsWorkspaceTools,load:()=>import('./mcp.mjs'),
  create:(module,config,options)=>new module.MerchantSensorThingsWorkspaces(config,options.sensorthings),
  concurrency:'provider',shutdown:'drain',maxRequestBytes:2*1024*1024,
  instructions:[{prefix:'merchant_sensorthings_',text:
    'Select an original host-declared SensorThings workspace and its immutable UUID. Read its schema and current revision. All source discovery, stream/query plans, capture/resume, analyst decisions, comparisons, native datasets, releases and customer operations use its original writer. Use one stable operationId and exact payload; after a lost response inspect that operation before repeating. Keep provider nextLinks opaque, every original response body and request receipt, and distinct phenomenonTime, resultTime, validTime, result types, units, resultQuality and missing/null states. A completed selected query is not a provider snapshot, provider quality approval, historical completeness, continuous availability or station uptime. Source edition imports preserve complete source identities and original review history as evidence; the receiving operator makes its own decision. Native SF30/SF82 and SF88/SF100 remain the sole dataset, release, payment and customer engines. Original file reads use manifest-bound selections and complete SHA256 identities; continue the same selector/readId/expectedSha256/offset, or resume the same SHA and offset after restart without an old readId. Never choose an arbitrary server path or a new payment journal.'}]
});
