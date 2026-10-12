// MIT. Original Census geocoder merchant metadata and lazy native owner hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { censusGeocoderWorkspaceTools } from '../catalog/census-geocoder-workspace.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA,
  id: 'census-geocoder-workspaces', family: 'censusGeocoderWorkspaces',
  title: 'Census address operations', order: 230, catalogOrder: 190,
  configKey: 'censusGeocoderWorkspaces', summary: true, dependencies: [],
  concurrency: 'provider', shutdown: 'provider', maxRequestBytes: 131072,
  configuration: {
    input: 'censusGeocoderWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) =>
      (await import('../census-geocoder-workspace.mjs'))
        .readCensusGeocoderWorkspaceConfiguration(hostPath(value)),
  },
  tools: censusGeocoderWorkspaceTools,
  load: () => import('../census-geocoder-workspace.mjs'),
  create: (module, config) => new module.MerchantCensusGeocoderWorkspaces(config),
  initialize: async options =>
    (await import('../config.mjs')).initializeCensusGeocoderWorkspaceMerchant(options),
  instructions: [
    {
      "prefix": "merchant_census_geocoder_",
      "text": "For Census address operations, select the declared workspace and retain its original workspaceId and current instanceId. Inspect or import its exact official benchmark/vintage and complete HTTP capture before choosing a match review bound to batchId, attemptId and responseSha256. Build the original typed edition with visible host merchant terms. The same original publisher owns draft review, release generation and SF88 customer sessions; use the existing terminal approval and retained buyer/session IDs. The borrowed browser shares this writer. Receive complete edition and customer files through retained reads and exact hashes. Cancel only the active metadata/batch request. Close drains accepted publication/customer work; retry an incomplete close with the same instance instead of opening another writer. CENSUS_GEOCODER_WORKSPACE.md documents the complete workflow.",
      "order": 10
    }
  ],
});
