// MIT. Original graphql-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { graphqlWorkspaceTools } from "../catalog/graphql-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "graphql-workspaces", family: "graphqlWorkspaces",
  title: "graphql workspaces merchant", order: 120, catalogOrder: 80,
  configKey: "graphqlWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 8388608,
  configuration: { input: "graphqlWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../graphql-workspace.mjs")).readGraphqlWorkspaceConfiguration(hostPath(value)) },
  tools: graphqlWorkspaceTools,
  instructions: [],
  load: () => import("../graphql-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantGraphqlWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeGraphqlWorkspaceMerchant(options)
});
