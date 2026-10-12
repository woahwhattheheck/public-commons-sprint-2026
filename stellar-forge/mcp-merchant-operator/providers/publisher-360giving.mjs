// MIT. Source-owned merchant provider for the original saved 360Giving publisher.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { publisher360GivingTools } from '../catalog/360giving-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'publisher-360giving', family: 'publisher360Giving',
  title: '360Giving publisher workspaces', order: 375, catalogOrder: 335,
  configKey: 'publisher360Giving', maxRequestBytes: 131072,
  configuration: { input: 'publisher360GivingConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('../360giving-workspace.mjs'))
      .read360GivingWorkspaceConfiguration(hostPath(value)) },
  tools: publisher360GivingTools,
  load: () => import('../360giving-workspace.mjs'),
  create: (module, config, options) => new module.Merchant360GivingWorkspaces(config, options.publisher360Giving),
  initialize: async options => (await import('../360giving-setup.mjs')).initialize360GivingPublisherMerchant(options),
  instructions: [{ order: 375, prefix: 'merchant_360giving_', text:
    'Use the saved publisher’s original source editions, named decisions and complete native builds. Upload declared files or complete UTF-8 text, then retain one requestId with its exact input. Intake, decisions, candidate, build, compare, export and receive return the original accepted request; read that request until complete, and use resume for its original interrupted work. Repeat a completed export with the same input and requestId to retain its complete ZIP. Continue inventory snapshots, every native query cursor and every changes page. Original JSON number tokens are represented as exact strings; keep grant amounts and source decision documents exact. Manifest/file tools and the shared retained downloader carry every byte through the same export and file hashes, including after publisher shutdown. Customer receiving selects a complete declared handoff or retained original export.' }]
});
