// MIT. Source-owned WQX metadata; the original managed host keeps scientific runtime ownership.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { wqxWorkspaceTools } from '../catalog/wqx-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'wqx-water-quality', family: 'wqxWorkspaces',
  title: 'WQX scientific review and complete receiving', order: 405, catalogOrder: 365,
  configKey: 'wqxWorkspaces', summary: true, dependencies: [], concurrency: 'provider',
  maxRequestBytes: 2 * 1024 * 1024,
  configuration: { input: 'wqxWorkspaceConnection', privateExports: true,
    read: async (value, { base, hostPath }) =>
      (await import('../wqx-workspace-connection.mjs')).readWqxWorkspaceConfiguration(hostPath(value, base)) },
  tools: wqxWorkspaceTools,
  instructions: [{
    prefix: 'merchant_wqx_', order: 145,
    text: 'Use the configured WQX workspace alias to operate the original managed project. Status follows its saved binding after Applications restarts. Page complete inventories with their snapshot and original target cohorts with sourcePlanSha256; use attentionOnly:false for a complete field cohort. Preserve scientific source identities, exact values, units and receiving explanations. Use concentration_units for the full original unit groups and supported blank-result limit-only cohort. concentration_prepare selects one exact source group or explicit result IDs and retains every paired quantity and independent reported limit; only a PREPARED result exposes documentRef for native table/preview/save. Its full proposal and reportCsvFile preserve the complete source context. Reopen saved concentrations with concentration_report and receive the original complete decision bundle. Upload complete CSV, TSV, decision JSON or bundles with input_begin/append/finish, using the same inputId, full SHA256 and authoritative receivedBytes after interruption. Native request/inputRef and document/documentRef are exclusive alternatives. Preview the full decision document before saving the same reviewId/newPlanId/previewSha256; reopen those original identifiers after an uncertain response. Large native results return an exact retained file with a compact result; receive every byte through file_read and verify its full hash. The installed WQX client resumes uploads and downloads across process and managed-host restarts. Receive the complete decision bundle into the selected original project and reopen every native export. Seller and buyer operations use the managed host configuration and original purchase intent. MCP shutdown drains accepted calls and file reads while the shared managed application retains its own lifecycle.',
  }],
  load: () => import('../wqx-workspace.mjs'),
  create: (module, config) => new module.MerchantWqxWorkspaces(config),
  initialize: options => import('../wqx-workspace-setup.mjs').then(module => module.initializeWqxWorkspaceMerchant(options)),
});
