// MIT. Original mpp merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { mppTools } from "../catalog/mpp-console.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "mpp", family: "mpp",
  title: "mpp merchant", order: 460, catalogOrder: 460,
  configKey: "mpp", summary: true, dependencies: [],
  maxRequestBytes: 3145728,
  configuration: { input: "mppConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../mpp-config.mjs")).readMppConfiguration(hostPath(value)) },
  tools: mppTools,
  instructions: [
    {
      "prefix": "merchant_mpp_",
      "text": "For native MPP, inspect merchant_mpp_consoles and status, retain a customer review from the original contract using a declared customer alias, then configure its exact review SHA256 and revision. Preview the exact offer/query/body before prepare and retain the original purchaseId and job ID. The existing console host runs original terminal approval, SF36 reservation, native MPP signing and SF86 accounting. Read original job/purchase state after interruption; retry preparation or resume the same saved purchase. Original response retrieval and handoff export use SHA-pinned chunks; merchant_mpp_export plus the maintained download-mpp receiver retains complete original files across MCP restart.",
      "order": 120
    }
  ],
  load: () => import("../mpp-console.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantMppConsole(config, options.mpp),
  initialize: async options => (await import('../config.mjs')).initializeMppMerchant(options)
});
