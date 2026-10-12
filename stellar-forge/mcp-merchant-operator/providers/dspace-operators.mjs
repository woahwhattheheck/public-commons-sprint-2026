// MIT. Original dspace-operators merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { dspaceOperatorTools } from "../catalog/dspace-operators.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "dspace-operators", family: "dspaceOperators",
  title: "dspace operators merchant", order: 30, catalogOrder: 380,
  configKey: "dspaceOperators", summary: true, dependencies: [],
  maxRequestBytes: 8388608,
  configuration: { input: "dspaceOperatorConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../../../stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/merchant-provider.mjs")).readDspaceOperatorConfiguration(hostPath(value)) },
  tools: dspaceOperatorTools,
  instructions: [
    {
      "prefix": "merchant_dspace_",
      "text": "For DSpace repository data, bind a host-declared original operator and retain its complete operator, instance, project and workspace scope for every source, edition, review, comparison, query and transfer. Read complete metadata arrays through original pages; retain all source UUIDs, object hashes and value properties. Save explicit projection and distribution rights, then approve the exact immutable edition before selection. Keep the same original operation ID, actor, revision and bytes after an interrupted reply. Project selection and native SQLite receiving return a new scope; reconnect explicitly after a process restart. Use the returned dataset.snapshot and page.nextCursor for complete native queries. Download the original project or export with its immutable manifest and complete-file SHA, including across merchant restart. Closing this borrowed client keeps its browser or managed Application owner.",
      "order": 50
    }
  ],
  load: () => import("../../../stellar/scf-starforge-20261009/sf30-seller-sdk/dspace/merchant-provider.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantDspaceOperators(config),
  initialize: async options => (await import('../config.mjs')).initializeDspaceOperatorMerchant(options)
});
