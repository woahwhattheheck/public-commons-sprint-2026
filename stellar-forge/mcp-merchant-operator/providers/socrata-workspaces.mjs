// MIT. Original socrata-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { socrataWorkspaceTools } from "../catalog/socrata-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "socrata-workspaces", family: "socrataWorkspaces",
  title: "socrata workspaces merchant", order: 160, catalogOrder: 120,
  configKey: "socrataWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "socrataWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../socrata-workspace.mjs")).readSocrataWorkspaceConfiguration(hostPath(value)) },
  tools: socrataWorkspaceTools,
  instructions: [],
  load: () => import("../socrata-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantSocrataWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeSocrataWorkspaceMerchant(options)
});
