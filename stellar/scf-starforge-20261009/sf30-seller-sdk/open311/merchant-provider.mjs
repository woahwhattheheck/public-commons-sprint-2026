// MIT. Source-owned Open311 merchant registration with lazy native ownership.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { open311WorkspaceTools } from './mcp-tools.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'open311-workspaces', family: 'open311Workspaces',
  title: 'Open311 municipal service desks', order: 385, catalogOrder: 385,
  configKey: 'open311Workspaces', summary: true, dependencies: [],
  concurrency: 'host', concurrentTools: [], shutdown: 'provider', maxRequestBytes: 131072,
  configuration: {
    input: 'open311WorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('./mcp-client.mjs')).readOpen311WorkspaceConfiguration(hostPath(value)),
  },
  tools: open311WorkspaceTools, load: () => import('./mcp.mjs'),
  create: (module, config) => new module.MerchantOpen311Workspaces(config),
  initialize: async options =>
    (await import('./mcp-setup.mjs')).initializeOpen311MerchantWorkspace(options),
  instructions: [{
    prefix: 'merchant_open311_', order: 385,
    text: 'Use the host-selected municipal desk and its source profiles. Read its workspace ID and revision, then apply a complete profile and capture the official service catalog or an exact service-request query. Preserve the same requestId, expectedRevision and inputs when recovering an operation. Keep civic status, case-sensitive service codes, original fields and internal review distinct. Use the provider-declared statuses and extensions; GeoReport v2 defaults to at most 1000 rows from a moving 90-day window, while Helsinki declares 200 and READY/PROCESSING. Page stored collections at one revision and retain the selected capture ID. Compare original captures without interpreting missing rows in moving or saturated windows as completion. Assign, review and report cases in the same durable workspace used by the browser and CLI. Deliver complete original source bytes, JSON, CSV, print reports and whole workspace bundles through retained chunks. Receive host-selected complete bundles into a new empty desk and reopen the existing application. File continuation keeps the original selection, expectedSha256 and byte offset. This provider owns only its SQLite handles and retained readers; closing it drains its admitted work.',
  }],
});
