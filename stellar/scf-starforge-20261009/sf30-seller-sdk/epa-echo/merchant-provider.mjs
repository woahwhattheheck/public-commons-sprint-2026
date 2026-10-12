// MIT. EPA ECHO metadata and lazy hooks selected by its original source contribution.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { echoWorkspaceTools } from './mcp-protocol.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'epa-echo-workspaces',
  family: 'echoWorkspaces',
  title: 'EPA ECHO facility portfolio operations',
  order: 405,
  catalogOrder: 405,
  configKey: 'echoWorkspaces',
  configuration: {
    input: 'echoWorkspaceConnection',
    privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('./mcp.mjs')).readEchoWorkspaceConfiguration(hostPath(value))
  },
  tools: echoWorkspaceTools,
  load: () => import('./mcp.mjs'),
  create: (module, config, options) => new module.MerchantEchoWorkspaces(config, options.echo),
  initialize: async options =>
    (await import('./merchant-setup.mjs')).initializeEchoWorkspaceMerchant(options),
  concurrency: 'provider',
  shutdown: 'drain',
  maxRequestBytes: 128 * 1024,
  instructions: [{
    prefix: 'merchant_echo_',
    text: "Select a host-declared EPA ECHO portfolio workspace and its original UUID. Read the current schema and revision before editing portfolios, source captures, reviews, datasets or releases. Preserve the same operationId and exact request after a lost reply; inspect the original journal before continuing. Import and complete workspace receiving use host-selected original package aliases and hashes. Retain FRS facility identity, source program and permit identifiers, each program's own reporting dates, source nulls, actual capture coverage and complete response bytes. Display compliance labels as the original source reports them. Query original datasets through their declared field/filter/sort/cursor contract. Receive the ordered original completed page intents and all five original customer files. The full workspace package preserves source, original editions, reviews and working records for readonly receiving. Use SHA256-bound chunks and the original retained echo-transfer.json receiver to resume files across an authenticated listener restart and verify all completed bytes offline."
  }]
});
