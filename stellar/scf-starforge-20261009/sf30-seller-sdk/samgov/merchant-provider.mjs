// MIT. Source-owned SAM.gov provider for the maintained merchant registry.
import {defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA} from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import {samgovWorkspaceTools} from './mcp-catalog.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'samgov-workspaces', family: 'samgovWorkspaces',
  title: 'SAM.gov source review and customer receiving', order: 1010, catalogOrder: 1010,
  configKey: 'samgovWorkspaces', summary: true, dependencies: [],
  configuration: {
    input: 'samgovWorkspaceConnection', privateExports: true,
    read: async (value, {hostPath}) =>
      (await import('./mcp.mjs')).readSamWorkspaceConfiguration(hostPath(value)),
  },
  tools: samgovWorkspaceTools,
  load: () => import('./mcp.mjs'),
  create: (module, config) => new module.MerchantSamWorkspaces(config),
  initialize: async options => (await import('./setup.mjs')).initializeSamWorkspaceMerchant(options),
  maxRequestBytes: 512 * 1024 * 1024,
  concurrentTools: ['merchant_samgov_status', 'merchant_samgov_capture_status', 'merchant_samgov_capture_pause'],
  instructions: [{
    prefix: 'merchant_samgov_', order: 1010,
    text: 'SAM.gov tools attach to the same original listener launched by the SAM opportunity workspace in Applications. Start its saved application, inspect merchant_samgov_status, and connect its host-declared alias. Retain every native requestId, expectedRevision, capture ID, source edition and opportunity project ID before mutation. An interrupted response continues from that same retained source and operation; inspect it before repeating exact input. New acquisition runs only through the original capture controls. Host-declared SHA-bound inputs import original issued bytes or receive the complete native packet. Named handoffs and fixed-revision exports preserve full source/history; read their exact files with the retained SHA/offset reader. MCP disconnect or shutdown releases its attachment and file handles; the original Applications Stop owns the server, captures and seller drain. Private connection URLs stay in the selected operator session.',
  }],
});
