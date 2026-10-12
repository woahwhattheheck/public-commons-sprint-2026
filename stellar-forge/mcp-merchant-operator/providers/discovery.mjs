// MIT. Original discovery merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { discoveryTools } from "../catalog/discovery.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "discovery", family: "discovery",
  title: "discovery merchant", order: 70, catalogOrder: 20,
  configKey: "catalog", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "catalogConnection", privateExports: false,
    read: async (value, { base, config, hostPath }) => await (await import("../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs")).readReleaseCatalogConfig(hostPath(value)) },
  tools: discoveryTools,
  instructions: [
    {
      "prefix": "merchant_discovery_",
      "text": "Use merchant_discovery_status and review before applying the returned reviewId to publish or withdraw offers; after an interrupted apply, inspect current discovery instead of replaying it.",
      "order": 200
    }
  ],
  load: () => import("../discovery.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantDiscovery(config)
});
