// MIT. Original publishers merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { publisherTools } from "../catalog/publisher.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "publishers", family: "publishers",
  title: "publishers merchant", order: 400, catalogOrder: 410,
  configKey: "publishers", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "publisherConnection", privateExports: false,
    read: async (value, { base, config, hostPath }) => await (await import("../config.mjs")).readPublisherConfiguration(hostPath(value)) },
  tools: publisherTools,
  instructions: [
    {
      "prefix": "merchant_publish",
      "text": "For a publisher connection, list merchant_publishers and explicitly open its declared workspace; saved enabled refreshes resume. Inspect native source, plan, candidate and target before review/publication. Use original run UUIDs, review IDs and schedule revisions; reopen buyer files by the recorded handoff UUID. Close only the exact owned publisher instance.",
      "order": 340
    }
  ],
  load: () => import("../publisher.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantPublisher(config),
  initialize: async options => (await import('../config.mjs')).initializePublisherMerchant(options)
});
