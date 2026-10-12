// MIT. Original usa-spending-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { usaSpendingWorkspaceTools } from "../catalog/usaspending-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "usa-spending-workspaces", family: "usaSpendingWorkspaces",
  title: "usa spending workspaces merchant", order: 350, catalogOrder: 300,
  configKey: "usaSpendingWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "usaSpendingWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../usaspending-workspace.mjs")).readUSASpendingWorkspaceConfiguration(hostPath(value)) },
  tools: usaSpendingWorkspaceTools,
  instructions: [],
  load: () => import("../usaspending-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantUSASpendingWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeUSASpendingWorkspaceMerchant(options)
});
