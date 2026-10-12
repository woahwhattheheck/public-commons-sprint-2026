// MIT. Original support merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { supportTools } from "../catalog/support.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "support", family: "support",
  title: "support merchant", order: 130, catalogOrder: 70,
  configKey: "support", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "supportConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../config.mjs")).readSupportConfiguration(hostPath(value)) },
  tools: supportTools,
  instructions: [
    {
      "prefix": "merchant_support_",
      "text": "For support observation, inspect host profiles and the current configuration revision, start explicitly and retain the owned watcher instance. Recover notifications using their original event IDs and attempt counts.",
      "order": 280
    },
    {
      "prefix": "merchant_case",
      "text": "With a configured support connection, inspect source aliases or incidents, import exact original captures, and reopen the original case before changing owner terms. Case writes use its current revision; workorder and export use that exact saved revision. Inspect support export status after an interrupted reply.",
      "order": 290
    }
  ],
  load: () => import("../support.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantSupport(config)
});
