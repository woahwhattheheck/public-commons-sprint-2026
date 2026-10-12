import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from "../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs";
import { haystackWorkspaceTools, HAYSTACK_MERCHANT_REQUEST_BYTES } from "./merchant-tools.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "haystack-workspaces", family: "haystackWorkspaces",
  title: "Haystack building-turnover workspaces", order: 395, catalogOrder: 395,
  configKey: "haystackWorkspaces", summary: true, dependencies: [],
  concurrency: "host", concurrentTools: ["merchant_haystack_cancel"], shutdown: "provider",
  maxRequestBytes: HAYSTACK_MERCHANT_REQUEST_BYTES,
  configuration: {
    input: "haystackWorkspaceConnection", privateExports: true,
    read: async (value, { hostPath }) => (await import("./merchant-client.mjs")).readHaystackWorkspaceConfiguration(hostPath(value))
  },
  tools: haystackWorkspaceTools,
  load: () => import("./merchant.mjs"),
  create: (module, config) => new module.MerchantHaystackWorkspaces(config),
  initialize: async options => (await import("./merchant-setup.mjs")).initializeHaystackMerchantWorkspace(options),
  instructions: [{
    prefix: "merchant_haystack_", order: 395,
    text: "Choose the configured original Haystack workspace alias. Read status and keep its exact reviewed revision while paging records, source-local relations, diagnostics and editions. Import complete JSON v4 grids through original host-pinned file aliases or complete base64. Preserve native typed values, original source bytes and exact row identities. A ref ID resolves only inside its selected source. Save a complete typed tag proposal, inspect its before/after cells and review it explicitly. Save immutable editions and pair changed source exports explicitly when comparing different originals. Keep the same operationId, expectedRevision and full original arguments after an interrupted response; operation.read returns the original saved mutation or completed delivery. A restarted server requires inspection and deliberate reconnection to its selected instance in the same workspace. Deliver the complete editable application and all original sources/history, or complete JSON/CSV/HTML registers and native grid exports; read every returned byte range until complete. Closing this borrowed adapter cancels its local waits and drains clients while the original application continues."
  }]
});
