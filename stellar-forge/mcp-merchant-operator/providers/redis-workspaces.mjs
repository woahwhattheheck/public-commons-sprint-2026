// MIT. Original redis-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { redisWorkspaceTools } from "../catalog/redis-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "redis-workspaces", family: "redisWorkspaces",
  title: "redis workspaces merchant", order: 340, catalogOrder: 290,
  configKey: "redisWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "redisWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../redis-workspace.mjs")).readRedisWorkspaceConfiguration(hostPath(value), { releaseStore: config.releaseStore }) },
  tools: redisWorkspaceTools,
  instructions: [],
  load: () => import("../redis-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantRedisWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeRedisWorkspaceMerchant(options)
});
