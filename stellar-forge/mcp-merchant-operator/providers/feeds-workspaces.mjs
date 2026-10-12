// MIT. Original feeds-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { feedsWorkspaceTools } from "../catalog/feeds-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "feeds-workspaces", family: "feedsWorkspaces",
  title: "feeds workspaces merchant", order: 360, catalogOrder: 330,
  configKey: "feedsWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 16842752,
  configuration: { input: "feedsWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../feeds-workspace.mjs")).readFeedsWorkspaceConfiguration(hostPath(value)) },
  tools: feedsWorkspaceTools,
  instructions: [],
  load: () => import("../feeds-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantFeedWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeFeedsWorkspaceMerchant(options)
});
