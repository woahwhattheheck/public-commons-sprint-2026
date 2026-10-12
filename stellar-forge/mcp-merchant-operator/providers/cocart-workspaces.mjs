// MIT. Original cocart-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { cocartWorkspaceTools } from "../catalog/cocart-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "cocart-workspaces", family: "cocartWorkspaces",
  title: "cocart workspaces merchant", order: 450, catalogOrder: 450,
  configKey: "cocartWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "cocartWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../cocart-workspace.mjs")).readCocartWorkspaceConfiguration(hostPath(value)) },
  tools: cocartWorkspaceTools,
  instructions: [],
  load: () => import("../cocart-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantCocartWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeCocartWorkspaceMerchant(options)
});
