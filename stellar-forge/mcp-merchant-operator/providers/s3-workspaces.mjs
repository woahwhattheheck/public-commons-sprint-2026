// MIT. Original s3-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { s3WorkspaceTools } from "../catalog/s3-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "s3-workspaces", family: "s3Workspaces",
  title: "s3 workspaces merchant", order: 170, catalogOrder: 110,
  configKey: "s3Workspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "s3WorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../s3-workspace.mjs")).readS3WorkspaceConfiguration(hostPath(value), { releaseStore: config.releaseStore }) },
  tools: s3WorkspaceTools,
  instructions: [],
  load: () => import("../s3-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantS3Workspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeS3WorkspaceMerchant(options)
});
