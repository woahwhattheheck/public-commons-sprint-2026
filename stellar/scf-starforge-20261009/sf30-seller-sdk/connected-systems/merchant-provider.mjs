// MIT. Source-owned Connected Systems metadata and lazy original HTTP-owner hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { connectedSystemsTools } from './mcp-catalog.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'connected-systems-workspaces', family: 'connectedSystemsWorkspaces',
  title: 'Connected Systems observation editions', order: 430, catalogOrder: 430,
  configKey: 'connectedSystemsWorkspaces', summary: true, concurrency: 'host', shutdown: 'drain',
  maxRequestBytes: 1024 * 1024,
  configuration: { input: 'connectedSystemsWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('./mcp-client.mjs')).readConnectedSystemsConfiguration(hostPath(value)) },
  tools: connectedSystemsTools, load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantConnectedSystemsWorkspaces(config, {
    environment: options.environment, ...options.connectedSystemsWorkspaces }),
  initialize: options => import('./mcp-setup.mjs').then(module => module.initializeConnectedSystemsMerchant(options)),
  instructions: [{ prefix: 'merchant_csapi_', order: 170,
    text: 'Operate the original host-configured Connected Systems workspace. Use explicit endpoint origins and only the NAME of an existing host authorization variable; never send credentials or commands. Retain original system/datastream IDs, result schemas, units, quality/nil definitions and source rights. Save exact JSON observation URLs, ordered filters and page/row/byte limits before acquiring one stable operation. A capped next chain stays partial and needs an explicit reviewed allow-partial mapping. Original numbers, absent/null fields, result links and repeated/conflicting IDs remain retained; no rescaling, deduplication or quality filtering is automatic. Read the original operation after a lost response and retry its exact query and label. Page complete record collections with viewSha256. Build/query/compare through the original SF30 engine, and receive every original document, source member, comparison, native dataset or exact customer packet with file_read offsets and full hashes. Merchant publication and the Dataset buyer use the original SF30/SF88 lifecycle. Disconnect drains this borrowed client while retaining the actual workspace and server owner.' }],
});
