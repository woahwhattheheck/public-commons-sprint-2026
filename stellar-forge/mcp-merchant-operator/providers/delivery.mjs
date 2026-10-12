// MIT. Source-owned single-release SF98 delivery provider.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { deliveryTools } from '../catalog/delivery.mjs';
export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'delivery', family: 'delivery',
  title: 'Single-merchant settlement delivery', order: 115, catalogOrder: 55,
  configKey: null, summary: true, dependencies: [],
  maxRequestBytes: 131072,
  concurrentTools: ['merchant_delivery_stop'],
  requestClose: provider => provider.cancelDeliveryOperations(),
  tools: deliveryTools,
  instructions: [{
    prefix: 'merchant_delivery_', order: 265,
    text: 'Delivery uses the existing configured releaseStore and original SF98 journal. Read status, enroll an HTTPS receiver with its environment reference, then explicitly sync/drain or start the original worker. Review exact revisions before pause/requeue. Capture a reviewed source fingerprint under one transfer ID; after a lost response inspect or replay that same ID. The release-delivery download CLI resumes verified files from these tools and the original SF98 receiver opens its exchange subdirectory.',
  }],
  load: () => import('../delivery.mjs'),
  create: (module, config, options) => new module.MerchantDelivery(config, options),
});
