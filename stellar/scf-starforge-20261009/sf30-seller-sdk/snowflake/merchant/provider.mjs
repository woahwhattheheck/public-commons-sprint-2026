// MIT. Source-owned merchant provider; native resources stay behind lazy hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/provider-contract.mjs';
import { snowflakeMerchantTools } from './catalog.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'snowflake-workspaces', family: 'snowflakeWorkspaces',
  title: 'Snowflake retained editions and merchant publications', order: 910, catalogOrder: 910,
  configKey: 'snowflakeWorkspaces', summary: true, dependencies: [], maxRequestBytes: 2 * 1024 * 1024,
  configuration: {
    input: 'snowflakeWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('./runtime.mjs')).readSnowflakeWorkspaceConfiguration(hostPath(value)),
  },
  tools: snowflakeMerchantTools,
  load: () => import('./runtime.mjs'),
  create: (module, config, options) => new module.MerchantSnowflakeWorkspaces(config, { environment: options.environment, ...options.snowflake }),
  requestClose: owner => owner.requestClose(),
  initialize: async options => (await import('./setup.mjs')).initializeSnowflakeWorkspaceMerchant(options),
  instructions: [{
    order: 910, prefix: 'merchant_snowflake_',
    text: 'Choose a declared Snowflake workspace and retain its original workspace UUID, request UUID, publication UUID and process instance. Capture and resume use the saved SQL API body and original statement handle; follow operations, observations, rows and edition histories through nextOffset. Receive every original partition through receive_begin, receive_chunk and receive_commit; resume at receivedBytes with the same transfer ID. Accept the exact edition before preparing its merchant publication. Complete deliveries use export, manifest and file: retain the manifest digest and read each selected file until nextOffset is null. The typed client resumes original downloads across MCP process restarts and reopens every delivered file offline. The original Snowflake browser and native SQLite writer own these operations.',
  }],
});
