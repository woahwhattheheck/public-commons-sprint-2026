// MIT. Original Huwise source, merchant and customer workspace metadata.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { opendatasoftWorkspaceTools } from '../catalog/opendatasoft-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'opendatasoft-workspaces', family: 'opendatasoftWorkspaces',
  title: 'Huwise and Opendatasoft workspaces', order: 10, catalogOrder: 140,
  configKey: 'opendatasoftWorkspaces', summary: true, dependencies: [],
  maxRequestBytes: 4194304,
  configuration: {
    input: 'opendatasoftWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('../opendatasoft-workspace.mjs')).readOpendatasoftWorkspaceConfiguration(hostPath(value))
  },
  tools: opendatasoftWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_opendatasoft_",
      "text": "For Huwise / Opendatasoft, open a host-declared original workbench and retain its instance and operation IDs. Use original catalog queries and complete capture, then review exact fields, notes revisions and typed publication candidates. Inspect the same native operation after an interrupted reply. Merchant staging targets the same original seller-releases store controlled by this MCP host; use the existing merchant inspect/activate/start controls. Capture and notes identities bind complete analyst exports, and selected merchant and buyer files retain their original package relationship. Keep exportId and manifestFile.sha256, then use the maintained opendatasoft client or CLI to inspect, download, resume and reopen every complete file. Source-only tool discovery and closed-workbench manifest delivery remain available. The original workbench owns all capture, publisher and buyer state.",
      "order": 30
    }
  ],
  load: () => import('../opendatasoft-workspace.mjs'),
  create: (module, config, options) => new module.MerchantOpendatasoftWorkspaces(config, options.opendatasoft),
  initialize: async options =>
    (await import('../config.mjs')).initializeOpendatasoftWorkspaceMerchant(options)
});
