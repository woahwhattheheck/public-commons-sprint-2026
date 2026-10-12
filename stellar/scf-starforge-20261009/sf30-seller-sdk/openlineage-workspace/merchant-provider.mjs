// MIT. Source-owned OpenLineage merchant declaration; runtime owners load lazily.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from "../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs";
import { lineageWorkspaceTools, LINEAGE_MERCHANT_REQUEST_BYTES } from "./mcp-tools.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "openlineage-workspaces", family: "openlineageWorkspaces",
  title: "OpenLineage operations workspaces", order: 375, catalogOrder: 375,
  configKey: "openlineageWorkspaces", summary: true, dependencies: [],
  concurrency: "host", concurrentTools: ["merchant_lineage_cancel"], shutdown: "provider",
  maxRequestBytes: LINEAGE_MERCHANT_REQUEST_BYTES,
  configuration: {
    input: "openlineageWorkspaceConnection", privateExports: true,
    read: async (value, { hostPath }) => (await import("./mcp-client.mjs")).readLineageWorkspaceConfiguration(hostPath(value))
  },
  tools: lineageWorkspaceTools,
  load: () => import("./mcp.mjs"),
  create: (module, config) => new module.MerchantOpenLineageWorkspaces(config),
  initialize: async options => (await import("./mcp-setup.mjs")).initializeLineageMerchantWorkspace(options),
  instructions: [{
    prefix: "merchant_lineage_", order: 375,
    text: "Use the original configured OpenLineage workspace alias and its one running HTTP application. Read workspace metadata, retain its revision, and page complete native records using nextOffset and the same expectedRevision. Inspect exact jobs, datasets, runs, source facets, event attribution, and declared lineage. Import complete original JSON/NDJSON through a host-pinned input or complete native text/base64. Save named editions and reasoned reviews; attach complete existing results to their saved edition and original source reference. Use source/object/export identities and all returned byte ranges to retrieve complete files. On an interrupted mutation keep the identical operationId, expectedRevision, and input; the original workspace replays a completed operation. After a server restart inspect connection and explicitly reconnect to its expectedInstanceId within the same configured workspace, then recover the original mutation. A revision conflict requires reading the changed workspace and applying a separately reviewed request. Export the complete editable application, sources, review history, and results; the original receiving command reopens the package. Closing this borrowed provider cancels its own waits and drains clients while the original application continues."
  }]
});
