// MIT. Source-owned ERDDAP metadata and lazy original HTTP-owner hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { erddapTools } from './mcp-catalog.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'erddap-workspaces', family: 'erddapWorkspaces',
  title: 'Ocean and environmental data editions', order: 410, catalogOrder: 410,
  configKey: 'erddapWorkspaces', summary: true, concurrency: 'host', shutdown: 'drain',
  maxRequestBytes: 1024 * 1024,
  configuration: { input: 'erddapWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('./mcp-client.mjs')).readErddapConfiguration(hostPath(value)) },
  tools: erddapTools, load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantErddapWorkspaces(config, {
    environment: options.environment, ...options.erddapWorkspaces }),
  initialize: options => import('./mcp-setup.mjs').then(module => module.initializeErddapMerchant(options)),
  instructions: [{ prefix: 'merchant_erddap_', order: 150,
    text: 'Operate the original host-configured ERDDAP workspace. Review the separate ERDDAP route and scientific publisher IDs, full original metadata, dimensions, units, quality flags and source license. Save fixed grid axes in original index order or complete table constraints before acquiring the same saved operation. After a lost response, operation returns the exact original queryId and label; use them without reconstructing an old request. Preserve destination number lexemes, source nulls and empty strings. No rescaling, interpolation or quality filtering is automatic. Review explicit native types and edition keys, build and compare through the original SF30 engine, and page complete inventories with their current view SHA256. Receive exact source members, complete customer packets and native seller dataset exports through file_read with full SHA256 and offsets. Host-pinned packet imports use the original independent source/mapping/native reconstruction. Merchant and Dataset customer commands use the same exported snapshot and original SF30/SF88 lifecycle. This adapter borrows the original HTTP owner; disconnect and MCP shutdown retain the native workspace and server.' }],
});
