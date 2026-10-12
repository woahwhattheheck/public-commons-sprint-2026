// MIT. Original cache merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { cacheControlTools } from "../catalog/controls.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "cache", family: "cache",
  title: "cache merchant", order: 530, catalogOrder: 40,
  configKey: null, summary: false, dependencies: [],
  maxRequestBytes: 131072,
  tools: cacheControlTools,
  instructions: [
    {
      "prefix": "merchant_cache_",
      "text": "Cache invalidation requires the current owned instance and an explicit route or all:true.",
      "order": 250
    }
  ],
  load: () => import("../controls.mjs"),
  create: (module, config, options, dependencies) => module
});
