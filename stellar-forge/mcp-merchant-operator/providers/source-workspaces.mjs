// MIT. Original source-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { sourceWorkspaceTools } from "../catalog/source-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "source-workspaces", family: "sourceWorkspaces",
  title: "source workspaces merchant", order: 330, catalogOrder: 300,
  configKey: "sourceWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "sourceWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../source-workspace.mjs")).readSourceWorkspaceConfiguration(hostPath(value)) },
  tools: sourceWorkspaceTools,
  instructions: [],
  load: () => import("../source-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantSourceWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeSourceWorkspaceMerchant(options)
});
