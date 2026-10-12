// MIT. Original geocodio-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { geocodioWorkspaceTools } from "../catalog/geocodio-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "geocodio-workspaces", family: "geocodioWorkspaces",
  title: "geocodio workspaces merchant", order: 180, catalogOrder: 150,
  configKey: "geocodioWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "geocodioWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../geocodio-workspace.mjs")).readGeocodioWorkspaceConfiguration(hostPath(value)) },
  tools: geocodioWorkspaceTools,
  instructions: [],
  load: () => import("../geocodio-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantGeocodioWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeGeocodioWorkspaceMerchant(options)
});
