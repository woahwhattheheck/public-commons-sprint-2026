// MIT. Original worldbank-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { worldbankWorkspaceTools } from "../catalog/worldbank-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "worldbank-workspaces", family: "worldbankWorkspaces",
  title: "worldbank workspaces merchant", order: 240, catalogOrder: 160,
  configKey: "worldbankWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "worldbankWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../worldbank-workspace.mjs")).readWorldBankWorkspaceConfiguration(hostPath(value)) },
  tools: worldbankWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_worldbank_",
      "text": "For World Bank workspaces, list declared aliases and open the original model. Save a source selection with its exact revision. Start or resume the same original capture ID, inspect its retained job until COMPLETE, and preserve its capture SHA256 for comparison, review and export. Original imported page receipts and handover packages require a host alias and inspected source hash. Merchant preparation uses a host profile; native publisher revisions, release generations and buyer intent/session IDs govern the full lifecycle. Browser and agent share the same model. Read original files in SHA-pinned chunks or use download-worldbank for durable complete receiving. Reopen the same original directory after interruption.",
      "order": 200
    }
  ],
  load: () => import("../worldbank-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantWorldBankWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeWorldBankWorkspaceMerchant(options)
});
