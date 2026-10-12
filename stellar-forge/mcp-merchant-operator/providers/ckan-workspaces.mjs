// MIT. Original ckan-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { ckanWorkspaceTools } from "../catalog/ckan-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "ckan-workspaces", family: "ckanWorkspaces",
  title: "ckan workspaces merchant", order: 250, catalogOrder: 210,
  configKey: "ckanWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "ckanWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../ckan-workspace.mjs")).readCkanWorkspaceConfiguration(hostPath(value)) },
  tools: ckanWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_ckan_",
      "text": "For CKAN authoring, list host-declared workspaces and open the original saved project. Read its current operation before every mutation and pass that exact expectedOperationId. Capture, source review, publication, export and staging return the original operation ID immediately; inspect its saved completion before continuing. After a lost reply read the same native state. Stage into the project store bound to this operator, then use the original merchant inspect, compare, activate and start tools. Customer downloads retain the original file hash and byte offset. Close the owned model to release its original lease.",
      "order": 300
    }
  ],
  load: () => import("../ckan-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantCkanWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeCkanWorkspaceMerchant(options)
});
