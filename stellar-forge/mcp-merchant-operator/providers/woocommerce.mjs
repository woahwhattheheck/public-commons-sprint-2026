// MIT. Original woocommerce merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { woocommerceTools } from "../catalog/woocommerce.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "woocommerce", family: "woocommerce",
  title: "woocommerce merchant", order: 450, catalogOrder: 450,
  configKey: "woocommerce", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "woocommerceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../woocommerce.mjs")).readWooCommerceConfiguration(hostPath(value)) },
  tools: woocommerceTools,
  instructions: [
    {
      "prefix": "merchant_woo_",
      "text": "For Woo stores, inspect merchant_woo_stores and merchant_woo_store_status, select an actual order from merchant_woo_queue, then read its current original order. Inspect a host-declared native receipt, retain its recordSha256 and a stable reviewId, then review or resume that same native source. Release only with the exact review SHA256 and selected confirmOrder; after interruption use live review_status before another explicit release. For refunds, inspect the original accounting export and current Woo refund snapshot, then prepare the selected verified adjustment UUID with its exact export hash, explicit Woo amount and currency. Apply only the saved prepared review hash with the selected confirmOrder. Refund recovery reads the same original order without a POST; REFUND_SAVED_JOURNAL_PENDING requires explicit same-ID apply to reconcile its existing native child. Preserve all original operation IDs, and use export/status plus SHA-pinned file chunks for complete handoff. Full Woo refund status can affect download access.",
      "order": 170
    }
  ],
  load: () => import("../woocommerce.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantWooCommerce(config, options.woocommerce),
  initialize: async options => (await import('../config.mjs')).initializeWooCommerceMerchant(options)
});
