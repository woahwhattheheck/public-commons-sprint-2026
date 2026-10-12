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
  instructions: [],
  load: () => import("../odata-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantODataWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeODataWorkspaceMerchant(options)
});
