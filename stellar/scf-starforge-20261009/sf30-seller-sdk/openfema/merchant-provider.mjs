// MIT. OPENFEMA metadata and lazy hooks selected by its original source contribution.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { openFemaWorkspaceTools } from './mcp-protocol.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'openfema-workspaces',
  family: 'openFemaWorkspaces',
  title: 'Public Assistance portfolio operations',
  order: 450,
  catalogOrder: 450,
  configKey: 'openFemaWorkspaces',
  configuration: {
    input: 'openFemaWorkspaceConnection',
    privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('./mcp.mjs')).readOpenFemaWorkspaceConfiguration(hostPath(value))
  },
  tools: openFemaWorkspaceTools,
  load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantOpenFemaWorkspaces(config, options.openfema),
  initialize: async options =>
    (await import('./merchant-setup.mjs')).initializeOpenFemaWorkspaceMerchant(options),
  concurrency: 'provider',
  shutdown: 'drain',
  maxRequestBytes: 128 * 1024,
  instructions: [{
    prefix: 'merchant_openfema_',
    text: "Use the declared OpenFEMA workspace alias and its original UUID. Read the native schema and current revision before source, portfolio, analyst, publication or receiving actions. Keep every source edition, declaration-area/applicant/project identity and field-presence distinction. Preserve original decimal USD strings and negative adjustments; project cost, federal share, total obligation and mitigation are separate measures. Do not infer financial-reporting suitability or source coverage from portfolio totals. Read the exact source metadata and migration qualifications. After an interrupted reply, read the original operation and repeat the same ID and complete payload; never replace its identity. Source imports select host-declared immutable bundle bytes. Native SF30/SF82/SF88 operations own datasets, releases and customer receiving. Files use original manifest names, byte counts, SHA256 and held-read offsets; complete receiving and offline reopen use the maintained download journal."
  }]
});
