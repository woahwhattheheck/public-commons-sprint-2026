// MIT. Original FRED workspace metadata and lazy native owner hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { fredWorkspaceTools } from '../catalog/fred-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'fred-workspaces', family: 'fredWorkspaces',
  title: 'FRED economic editions', order: 0, catalogOrder: 10,
  configKey: 'fredWorkspaces', summary: true, dependencies: [],
  concurrency: 'host', concurrentTools: [], shutdown: 'drain',
  maxRequestBytes: 131072,
  configuration: {
    input: 'fredWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('../fred-workspace-client.mjs')).readFredWorkspaceConfiguration(hostPath(value)),
  },
  tools: fredWorkspaceTools,
  load: () => import('../fred-workspace.mjs'),
  create: (module, config, options) => new module.MerchantFredWorkspaces(config, {
    environment: options.environment, ...options.fredWorkspaces,
  }),
  initialize: async options =>
    (await import('../fred-workspace-setup.mjs')).initializeFredWorkspaceMerchant(options),
  instructions: [
    {
      "prefix": "merchant_fred_",
      "text": "For economic editions, attach the original FRED workspace and inspect its exact project/launch binding, current revision and declared source/payment profiles. Keep full original public-table text, publisher metadata, series frequencies/units, missing values and API real-time versus public retrieval-date semantics. Import complete host inputs, combine retained captures and save the exact projection review before publication. Follow original observation/comparison offsets and pinned record revisions through complete collections. Prepare each paid dataset page or advertised source file under its original intent; carry the exact returned snapshot and previous-page cursor metadata to the next page. Execute through the configured SF88 buyer and recover the same intent after an interrupted result. Download complete original source, project and customer files with their full SHA256 through retained chunks. Project receiving uses the maintained native receiver; reattach the current private connection record to the same original project after its owner restarts. Borrowed client closure preserves the original workspace owner.",
      "order": 0
    }
  ],
});
