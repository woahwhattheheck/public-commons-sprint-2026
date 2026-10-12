// MIT. Original webdav-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { webDavWorkspaceTools } from "../catalog/webdav-tools.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "webdav-workspaces", family: "webdavWorkspaces",
  title: "webdav workspaces merchant", order: 200, catalogOrder: 160,
  configKey: "webdavWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "webdavWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../webdav-tools.mjs")).readWebDavWorkspaceConfiguration(hostPath(value)) },
  tools: webDavWorkspaceTools,
  instructions: [],
  load: () => import("../webdav-tools.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantWebDavWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeWebDavWorkspaceMerchant(options)
});
