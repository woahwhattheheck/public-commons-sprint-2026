// MIT. Lazy registration with the maintained original Merchant provider owner.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { recordMasteringTools } from './mcp-tools.mjs';
export default defineMerchantProvider({
    schema: MERCHANT_PROVIDER_SCHEMA, id: 'record-mastering', family: 'recordMastering', title: 'Record mastering', order: 426, catalogOrder: 426,
    configKey: 'recordMastering', summary: true, dependencies: [], concurrency: 'host', concurrentTools: [], shutdown: 'provider', maxRequestBytes: 131072,
    configuration: { input: 'recordMasteringConnection', privateExports: true, read: async (value, { hostPath }) => (await import('./mcp.mjs')).readMasteringConfiguration(hostPath(value)) },
    tools: recordMasteringTools, load: () => import('./mcp.mjs'), create: (module, config) => new module.MerchantRecordMastering(config),
    instructions: [{ prefix: 'merchant_mastering_', order: 426, text: 'Use the original configured workspaces and file aliases. Retain exact CSV editions, stable source keys and explicit mappings. Matching groups suggest review; they never merge automatically. Inspect every selected master and original field candidates, then make explicit merges, splits or field decisions through the one revision-bound writer. Every change carries the observed expectedRevision and a stable requestId; replay identical input after a lost response. A refresh binds its original planSha256. Changed source-selected values need a new decision; they are not silently overwritten. Delivery editions contain exact text CSV, original seller configuration and field provenance. Large query results and full exports are retained as complete files: read all offsets, verify chunk and full digests, and parse the complete original JSON. Receiving creates a separately editable workspace. Keep private complete-workspace backups separate from customer delivery packets.' }]
});
