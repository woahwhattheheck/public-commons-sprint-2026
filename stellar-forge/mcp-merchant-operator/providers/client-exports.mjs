// MIT. Original client-exports merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "client-exports", family: "clientExports",
  title: "client exports merchant", order: 50, catalogOrder: 490,
  configKey: null, summary: true, dependencies: [],
  maxRequestBytes: 131072,
  tools: () => [],
  instructions: [
    {
      "prefix": null,
      "text": "Customer client export reads original metadata and retains its completion receipt. After a lost response, inspect merchant_client_export_status; legacy exports require explicit adoption of the inspected complete files digest. File delivery reads the original five payloads and receipt without running the seller or generated code.",
      "order": 320
    }
  ],
  load: () => import("../client-exports.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantClientExports({ directory: config.exportsDirectory })
});
