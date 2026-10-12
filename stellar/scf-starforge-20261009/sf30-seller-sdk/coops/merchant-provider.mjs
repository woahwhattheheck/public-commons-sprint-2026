// MIT. COOPS metadata and lazy hooks selected by its original source contribution.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { coopsWorkspaceTools } from './mcp-protocol.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'coops-workspaces',
  family: 'coopsWorkspaces',
  title: 'NOAA coastal source operations',
  order: 407,
  catalogOrder: 407,
  configKey: 'coopsWorkspaces',
  configuration: {
    input: 'coopsWorkspaceConnection',
    privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('./mcp.mjs')).readCoopsWorkspaceConfiguration(hostPath(value))
  },
  tools: coopsWorkspaceTools,
  load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantCoopsWorkspaces(config, options.coops),
  initialize: async options =>
    (await import('./merchant-setup.mjs')).initializeCoopsWorkspaceMerchant(options),
  concurrency: 'provider',
  shutdown: 'drain',
  maxRequestBytes: 512 * 1024,
  instructions: [{
    prefix: 'merchant_coops_',
    text: "Select an explicitly host-declared coastal workspace and its original UUID. Read the native schema, station profile and current revision before any source action. Review explicit NOAA product, dates, units, time basis and datum. Preserve preliminary/verified flag meanings, nulls and separately selected predictions. Historical studies reuse bounded annual source editions. Retry the exact original operation ID after uncertainty; never create a replacement identity. Import only a host-selected source package whose bytes match its declared digest. Inspect a selected mapping JSON before saving; imported IDs remain provenance and the original file follows each mapping revision. Model-input mappings select original fields and headings without datum or unit conversion. Use native SF30/SF82 publication and original completed SF88/SF100 customer receipts. Read retained files by their exact SHA and byte offsets; the shared file reader streams verified original files with bounded memory."
  }]
});
