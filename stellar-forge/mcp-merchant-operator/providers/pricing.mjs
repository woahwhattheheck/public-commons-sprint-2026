// MIT. Original pricing merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { pricingTools } from "../catalog/pricing.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "pricing", family: "pricing",
  title: "pricing merchant", order: 480, catalogOrder: 480,
  configKey: "pricing", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "pricingConnection", privateExports: false,
    read: async (value, { base, config, hostPath }) => await (await import("../pricing.mjs")).readPricingConfiguration(hostPath(value)) },
  tools: pricingTools,
  instructions: [
    {
      "prefix": "merchant_pricing_",
      "text": "For pricing, inspect declared aliases and open the original SF97 model. Capture seller and native observations through merchant_pricing_source; use captureSha256 to page the same source. Save merchant pricing reviews with the current original revision and a stable requestId. Repricing starts from a saved version and complete ordered options: preview explicit atomic edits, retain its exact reviewSha256, and save with the current price-decision revision. Inspect the saved manifest after an interrupted reply. Stage a retained original API package by its decision and review hash, then use the original release digest/generation controls for activation and startup. Each alias reports whether its staging store is this operator release store. Download original files through SHA-pinned chunks.",
      "order": 400
    }
  ],
  load: () => import("../pricing.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantPricing(config),
  initialize: async options => (await import('../config.mjs')).initializePricingMerchant(options)
});
