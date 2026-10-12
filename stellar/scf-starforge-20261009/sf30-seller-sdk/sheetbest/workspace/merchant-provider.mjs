// MIT. Source-owned Sheet Best merchant registration with the original provider lifetime.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { sheetbestWorkspaceTools } from './catalog.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'sheetbest-workspaces', family: 'sheetbestWorkspaces',
  title: 'Sheet Best source authoring', order: 460, catalogOrder: 460, configKey: 'sheetbestWorkspaces',
  summary: true, dependencies: ['publishers'], maxRequestBytes: 1048576,
  configuration: { input: 'sheetbestWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('./mcp.mjs')).readSheetBestWorkspaceConfiguration(hostPath(value)) },
  tools: sheetbestWorkspaceTools,
  instructions: [{ prefix: 'merchant_sheetbest_', order: 460,
    text: 'List host-declared Sheet Best workspaces, then open the original source model. Import an exact frozen source/private packet or intentionally read one declared connection. Inspect all source fields, save explicit public columns and extraction orders with the current draft revision, validate every row, review and freeze the exact source version. Use plan_input and the SAME borrowed publisher tools for candidate review/publication and original buyer handoff. Source deployment tools retain the original SF82 store, reviewed package, generation/digest/instance and uncertain-command observation. Private packet reads contain ALL original source records; publish customer-facing data through the original publisher and release controls. Close drains the owned browser, borrowed publisher/scheduler, pending requests and packet reads before releasing the original workspace.' }],
  load: () => import('./mcp.mjs'),
  create: (module, config, options, dependencies) => new module.MerchantSheetBestWorkspaces(config, dependencies.publishers),
});
