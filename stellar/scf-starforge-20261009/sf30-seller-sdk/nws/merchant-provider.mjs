// MIT. NWS metadata and lazy hooks selected by its original source contribution.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { nwsWorkspaceTools } from './mcp-protocol.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'nws-workspaces',
  family: 'nwsWorkspaces',
  title: 'NWS site weather operations',
  order: 405,
  catalogOrder: 405,
  configKey: 'nwsWorkspaces',
  configuration: {
    input: 'nwsWorkspaceConnection',
    privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('./mcp.mjs')).readNwsWorkspaceConfiguration(hostPath(value))
  },
  tools: nwsWorkspaceTools,
  load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantNwsWorkspaces(config, options.nws),
  initialize: async options =>
    (await import('./merchant-setup.mjs')).initializeNwsWorkspaceMerchant(options),
  concurrency: 'provider',
  shutdown: 'drain',
  maxRequestBytes: 128 * 1024,
  instructions: [{
    prefix: 'merchant_nws_',
    text: "For site-weather work, select a host-declared NWS workspace and its original UUID. Read the current schema and revision before changing a site, capture, station, annotation, dataset or merchant. Keep the same operationId and exact request after an interrupted reply; inspect the original journal before continuing. Source import uses an exact host-selected package alias and hash. Preserve point mappings, station selection, provider times, unit codes, nulls, coverage and original response bytes. Distinguish cached response bodies from actual wire responses when downloading revalidated source. Query the native dataset with its original URL-encoded query string. Receive only the ordered completed original page intents and retain all five original customer files. Use SHA-pinned byte chunks and the maintained nws-transfer.json receiver to continue a download and reopen the full original files offline."
  }]
});
