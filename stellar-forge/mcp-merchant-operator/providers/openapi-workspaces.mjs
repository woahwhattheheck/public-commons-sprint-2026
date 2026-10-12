// MIT. Original openapi-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { openapiWorkspaceTools } from "../catalog/openapi-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "openapi-workspaces", family: "openapiWorkspaces",
  title: "openapi workspaces merchant", order: 380, catalogOrder: 380,
  configKey: "openapiWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "openapiWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../openapi-workspace.mjs")).readOpenApiWorkspaceConfiguration(hostPath(value)) },
  tools: openapiWorkspaceTools,
  instructions: [],
  load: () => import("../openapi-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantOpenApiWorkspaces(config, options.openapi),
  initialize: async options => (await import('../config.mjs')).initializeOpenApiWorkspaceMerchant(options)
});
