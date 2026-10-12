// MIT. Original opencage-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { opencageWorkspaceTools } from "../catalog/opencage-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "opencage-workspaces", family: "opencageWorkspaces",
  title: "opencage workspaces merchant", order: 310, catalogOrder: 260,
  configKey: "opencageWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "opencageWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../opencage-workspace.mjs")).readOpenCageWorkspaceConfiguration(hostPath(value)) },
  tools: opencageWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_opencage_",
      "text": "For OpenCage work, list declared aliases and open the same saved workspace and browser. query_review returns the exact normalized source/terms review; capture retains one stable request id. Import exact host-declared HTTP observations to reconcile an incomplete native attempt. Inspect request/candidates and select with the original response SHA256 and current decision revision. Export that same decision, open its read-only customer viewer and receive every original manifest file with SHA-pinned chunks. Package current or explicitly proposed terms, inspect the saved package and release diff, then stage/activate/start or rollback through the original generation. Adopt an existing Buyer intent using its configured client alias and actual selected package. Keep source, capture, decision, package and Buyer identities through lost replies; close only the owned workspace/customer instances.",
      "order": 310
    }
  ],
  load: () => import("../opencage-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantOpenCageWorkspaces(config, options.opencage),
  initialize: async options => (await import('../config.mjs')).initializeOpenCageWorkspaceMerchant(options)
});
