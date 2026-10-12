// MIT. Original tenderly-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { tenderlyWorkspaceTools } from "../catalog/tenderly-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "tenderly-workspaces", family: "tenderlyWorkspaces",
  title: "tenderly workspaces merchant", order: 300, catalogOrder: 250,
  configKey: "tenderlyWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "tenderlyWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../tenderly-workspace.mjs")).readTenderlyWorkspaceConfiguration(hostPath(value)) },
  tools: tenderlyWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_tenderly_",
      "text": "For Tenderly merchants, list declared workspace aliases and open their original browser/model. Review and save a profile, open it, issue the exact request with the original id, subject and expiry in Unix milliseconds, then start its seller explicitly. Browser and MCP share the original profile, operation generation and provider observations. Read a saved simulation with provider_lookup; default reopens retained observations and refresh explicitly reads the provider again. Review a MATCHED observation before provider_recover. Keep the original lookup ID, observation ID and expected generation after a lost response. Merchant and provider responses use exact file-read selection, SHA256 and resumable chunks. Stop the merchant before selecting another profile; close drains only this owned instance.",
      "order": 320
    }
  ],
  load: () => import("../tenderly-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantTenderlyWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeTenderlyWorkspaceMerchant(options)
});
