// MIT. Source-owned EDR CoverageJSON metadata and lazy original HTTP-owner hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { edrTools } from './mcp-catalog.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'edr-workspaces', family: 'edrWorkspaces',
  title: 'EDR CoverageJSON cell editions', order: 480, catalogOrder: 480,
  configKey: 'edrWorkspaces', summary: true, concurrency: 'host', shutdown: 'drain',
  maxRequestBytes: 1024 * 1024,
  configuration: { input: 'edrWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('./mcp-client.mjs')).readEdrConfiguration(hostPath(value)) },
  tools: edrTools, load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantEdrWorkspaces(config, {
    environment: options.environment, ...options.edrWorkspaces }),
  initialize: options => import('./mcp-setup.mjs').then(module => module.initializeEdrMerchant(options)),
  instructions: [{ prefix: 'merchant_edr_', order: 180,
    text: 'Operate the original host-configured EDR workspace. Use explicit endpoint origins and only the NAME of an existing host authorization variable; never send credentials or commands. Save the collection, actual advertised query type/URL, ordered original parameters and page/cell/byte/linked-document bounds before acquiring one stable operation. No format, CRS, coordinate, datetime or parameter-name value is inserted automatically. Retain complete CoverageJSON domain/range/tile closure, parameter definitions, units, CRS, calendars, time strings, categories, nulls and source rights. One native row is one source parameter cell in the original declared range order, with exact axis coordinates and explicit rational values when necessary. No interpolation, timezone repair, regridding, rescaling, deduplication or quality filtering is automatic. Preserve sourceIssues and incomplete coverage explicitly. Read the original operation after a lost response and retry its exact query and label; a completed retained HTTP attempt is adopted before another GET. Page full record collections with viewSha256. Build/query/compare through the original SF30 engine, and receive every original document, source member, comparison, native dataset and exact project with file_read offsets and hashes. Explicit seller terms and buyer selections stay in the original SF30/SF88 lifecycle. Disconnect drains this borrowed client while retaining its actual workspace/server owner.' }],
});
