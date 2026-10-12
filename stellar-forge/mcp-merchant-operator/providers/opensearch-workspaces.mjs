// MIT. Original opensearch-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { openSearchWorkspaceTools } from "../catalog/opensearch-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "opensearch-workspaces", family: "opensearchWorkspaces",
  title: "opensearch workspaces merchant", order: 150, catalogOrder: 110,
  configKey: "opensearchWorkspaces", summary: true, dependencies: [],
  concurrentTools: Object.freeze(['merchant_opensearch_close']),
  maxRequestBytes: 2097152,
  configuration: { input: "opensearchWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../opensearch-workspace.mjs")).readOpenSearchWorkspaceConfiguration(hostPath(value)) },
  tools: openSearchWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_opensearch_",
      "text": "For OpenSearch, inspect merchant_opensearch_status and open only a host-declared workspace. Read the original draft or relevance-set revision before saving or judging, and retain its original requestId. Capture, preparation and native relevance evaluation use that same operation journal. After an interrupted response inspect merchant_opensearch_operation with the original request ID. Read the saved edition, compare actual query scope and judgments, then promote the selected evaluated variant into an original merchant draft for preparation. Full native results, reports, CSV and customer files use original SHA-pinned retained reads; resume with the same readId, file hash and byte offset. Close releases this process-owned workspace and temporary reads.",
      "order": 380
    },
    {
      "order": 410,
      "tool": "merchant_opensearch_deployment_status",
      "text": "OpenSearch deployment tools operate the original workspace deployment journal and store. Inspect the current original generation and digest before stage, activate, start, restart or rollback, and reconcile the same original request ID after interruption. Read generated customers through the original per-alias manifest, file, archive and handover tools."
    },
    {
      "order": 420,
      "tool": "merchant_opensearch_deployment_adopt_client",
      "text": "For an interrupted OpenSearch client export, inspect its original filesSha256 and use deployment_adopt_client with that exact exportId and expectedFilesSha256. Resume the original retained file reads."
    }
  ],
  load: () => import("../opensearch-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantOpenSearchWorkspaces(config, options.opensearch),
  initialize: async options => (await import('../config.mjs')).initializeOpenSearchWorkspaceMerchant(options)
});
