// MIT. Original STAC imagery host metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { stacWorkspaceTools } from '../catalog/stac-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'stac-workspaces', family: 'stacWorkspaces',
  title: 'STAC imagery merchant', order: 0, catalogOrder: 0,
  configKey: 'stacWorkspaces', summary: true, dependencies: [],
  configuration: { input: 'stacWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('../stac-workspace-client.mjs')).readStacWorkspaceConfiguration(hostPath(value)) },
  tools: stacWorkspaceTools,
  instructions: [],
  load: () => import('../stac-workspace.mjs'),
  create: (module, config) => new module.MerchantStacWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeStacWorkspaceMerchant(options)
});
