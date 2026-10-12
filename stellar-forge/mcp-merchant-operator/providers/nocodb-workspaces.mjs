// MIT. Original nocodb-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { nocodbWorkspaceTools } from "../catalog/nocodb-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "nocodb-workspaces", family: "nocodbWorkspaces",
  title: "nocodb workspaces merchant", order: 230, catalogOrder: 190,
  configKey: "nocodbWorkspaces", summary: true, dependencies: ["publishers"],
  maxRequestBytes: 1048576,
  configuration: { input: "nocodbWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../nocodb-workspace.mjs")).readNocoDBWorkspaceConfiguration(hostPath(value)) },
  tools: nocodbWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_nocodb_",
      "text": "For NocoDB authoring, list merchant_nocodb_workspaces and open the declared original model and browser. Inspect host input hashes or discover the actual table through its existing connection, then capture complete original pages with exact field IDs/types and native identity order. Save the draft with its current revision, preview all retained rows and review the source version against the current selection. Open its original publisher and use merchant_nocodb_publisher_* against the SAME publisher and scheduler; original run UUIDs, candidate/review hashes, target revisions and buyer handoffs remain authoritative. Deployment tools use that source model's original SF82 store and console, exact generation/digest/instance and uncertain-command observation. Receive private source packets with original version/capture/hash/offset and reopen the same request after lost replies. Close drains the original model, borrowed publisher calls and owned services.",
      "order": 60
    }
  ],
  load: () => import("../nocodb-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantNocoDBWorkspaces(config, dependencies.publishers),
  initialize: async options => (await import('../config.mjs')).initializeNocoDBWorkspaceMerchant(options)
});
