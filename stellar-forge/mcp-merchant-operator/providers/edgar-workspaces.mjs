// MIT. Original edgar-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { edgarWorkspaceTools } from "../catalog/sec-edgar-tools.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "edgar-workspaces", family: "edgarWorkspaces",
  title: "edgar workspaces merchant", order: 260, catalogOrder: 210,
  configKey: "edgarWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "edgarWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../sec-edgar-tools.mjs")).readEdgarWorkspaceConfiguration(hostPath(value)) },
  tools: edgarWorkspaceTools,
  instructions: [],
  load: () => import("../sec-edgar-tools.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantEdgarWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeEdgarWorkspaceMerchant(options)
});
