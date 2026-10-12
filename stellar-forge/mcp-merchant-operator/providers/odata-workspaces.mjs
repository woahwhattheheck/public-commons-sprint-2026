// MIT. Original odata-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { odataWorkspaceTools } from "../catalog/odata-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "odata-workspaces", family: "odataWorkspaces",
  title: "odata workspaces merchant", order: 200, catalogOrder: 150,
  configKey: "odataWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "odataWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../odata-workspace.mjs")).readODataWorkspaceConfiguration(hostPath(value)) },
  tools: odataWorkspaceTools,
  instructions: [{
    prefix: "merchant_odata_",
    text: "Open a declared original OData workspace and retain its connection, query, edition, service and collection IDs. Receive original saved responses before selecting their complete ordered cursor chain. For large collection chains select the declared complete collectionSelections file. Inspect full row/page counts, source/query identity and every paginated inventory. Original Analysis source discovery returns the complete document and exact file references; transfer all of them with their hashes and relative paths, register that document in the existing AnalysisWorkspace, then use its actual source name/revision for the original mapping. Continue the original native Analysis jobs, SQL/report/workbook and complete workspace receiving. Restore collections using a pinned host source document or an inspected source collection under a declared workspace. Reuse original job, collection and transfer IDs after interrupted replies; close drains this workspace's existing operations and file reads.",
    order: 380
  }],
  load: () => import("../odata-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantODataWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeODataWorkspaceMerchant(options)
});
