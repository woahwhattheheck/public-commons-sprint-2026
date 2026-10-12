// MIT. Original research-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { researchWorkspaceTools } from "../catalog/research-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "research-workspaces", family: "researchWorkspaces",
  title: "research workspaces merchant", order: 80, catalogOrder: 310,
  configKey: "researchWorkspaces", summary: true, dependencies: [],
  concurrency: 'provider',
  maxRequestBytes: 2097152,
  configuration: { input: "researchWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../research-workspace.mjs")).readResearchWorkspaceConfiguration(hostPath(value)) },
  tools: researchWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_research_",
      "text": "For Research, list host-declared aliases and attach to the original authenticated Research application. The host-selected startup file follows the same managed listener after restart. Read its original dossier revision, selected question and complete paged source/finding records before writing. Keep saved Crossref request and operation IDs through prepare, review, start/resume, stop and reviewed receive; after an uncertain reply read the same original dossier and operation. Complete portable, report, raw-edition and comparison exports retain their source identities and hashes. Page the durable export inventory after reattachment; resume file reads with the same kind/exportId/hash and byte offset, then verify all decoded bytes. Reopen a host-declared portable source or that exact retained export through the original streaming importer. Detach with this attachment ID to drain its calls/readers; Applications keeps ownership of the original listener and saved acquisitions.",
      "order": 100
    }
  ],
  load: () => import("../research-workspace.mjs"),
  create: (module, config) => new module.MerchantResearchWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeResearchWorkspaceMerchant(options)
});
