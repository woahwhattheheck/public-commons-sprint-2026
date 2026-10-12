// MIT. Original receiving merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { receivingTools } from "../catalog/receiving.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "receiving", family: "receiving",
  title: "receiving merchant", order: 140, catalogOrder: 80,
  configKey: "receiving", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "receivingConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../receiving.mjs")).readReceivingConfiguration(hostPath(value)) },
  tools: receivingTools,
  instructions: [
    {
      "prefix": "merchant_receiving_",
      "text": "For receiving, inspect host source aliases, open the original saved workspace, and retain prepare/import/review IDs with exact source and plan digests. Read saved review status before retrying; replay uses the original capture. Close receiving to hand the same directory to its browser.",
      "order": 360
    }
  ],
  load: () => import("../receiving.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantReceiving(config),
  initialize: async options => (await import('../config.mjs')).initializeReceivingMerchant(options)
});
