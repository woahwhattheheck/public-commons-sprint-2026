// MIT. Original stellar-expert-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { stellarExpertWorkspaceTools } from "../catalog/stellar-expert-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "stellar-expert-workspaces", family: "stellarExpertWorkspaces",
  title: "stellar expert workspaces merchant", order: 270, catalogOrder: 230,
  configKey: "stellarExpertWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "stellarExpertWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../stellar-expert-workspace.mjs")).readStellarExpertWorkspaceConfiguration(hostPath(value)) },
  tools: stellarExpertWorkspaceTools,
  instructions: [
    {
      "prefix": null,
      "text": "For Stellar asset workspaces, discover the host-declared alias and original workspaceId, then read schema/view before actions. Every original action requires operationId and expectedRevision; repeat the identical action identity after an unknown response, and preserve actual errors and revisions. Use retained file reads or stellar-expert-mcp to receive complete original sources, exports and customer receipts with their hashes. The original browser remains the workspace writer.",
      "order": 70
    }
  ],
  load: () => import("../stellar-expert-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantStellarExpertWorkspaces(config, options.stellarExpert),
  initialize: async options => (await import('../config.mjs')).initializeStellarExpertWorkspaceMerchant(options)
});
