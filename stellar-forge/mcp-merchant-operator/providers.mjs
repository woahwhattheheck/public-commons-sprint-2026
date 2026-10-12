// MIT. Host-configured providers; importing this registry never imports a runtime.
export const MERCHANT_PROVIDERS = Object.freeze({
  clientExports: { configKey: null, summary: true, load: () => import("./client-exports.mjs"), create: (module, config, options) => new module.MerchantClientExports({ directory: config.exportsDirectory }) },
  discovery: { configKey: "catalog", summary: true, load: () => import("./discovery.mjs"), create: (module, config, options) => new module.MerchantDiscovery(config) },
  fleet: { configKey: "fleet", summary: true, load: () => import("./fleet.mjs"), create: (module, config, options) => new module.MerchantFleet(config.fleet) },
  accounting: { configKey: "accounting", summary: true, load: () => import("./accounting.mjs"), create: (module, config, options) => new module.MerchantAccounting(config) },
  support: { configKey: "support", summary: true, load: () => import("./support.mjs"), create: (module, config, options) => new module.MerchantSupport(config) },
  receiving: { configKey: "receiving", summary: true, load: () => import("./receiving.mjs"), create: (module, config, options) => new module.MerchantReceiving(config) },
  pythonWorkspaces: { configKey: "pythonWorkspaces", summary: true, load: () => import("./python-workspace.mjs"), create: (module, config, options) => new module.MerchantPythonWorkspaces(config) },
  s3Workspaces: { configKey: "s3Workspaces", summary: true, load: () => import("./s3-workspace.mjs"), create: (module, config, options) => new module.MerchantS3Workspaces(config) },
  opensearchWorkspaces: { configKey: "opensearchWorkspaces", summary: true, load: () => import("./opensearch-workspace.mjs"), create: (module, config, options) => new module.MerchantOpenSearchWorkspaces(config, options.opensearch) },
  socrataWorkspaces: { configKey: "socrataWorkspaces", summary: true, load: () => import("./socrata-workspace.mjs"), create: (module, config, options) => new module.MerchantSocrataWorkspaces(config) },
  geocodioWorkspaces: { configKey: "geocodioWorkspaces", summary: true, load: () => import("./geocodio-workspace.mjs"), create: (module, config, options) => new module.MerchantGeocodioWorkspaces(config) },
  webdavWorkspaces: { configKey: "webdavWorkspaces", summary: true, load: () => import("./webdav-tools.mjs"), create: (module, config, options) => new module.MerchantWebDavWorkspaces(config) },
  sheetsWorkspaces: { configKey: "sheetsWorkspaces", summary: true, load: () => import("./sheets-workspace.mjs"), create: (module, config, options) => new module.MerchantSheetsWorkspaces(config) },
  ckanWorkspaces: { configKey: "ckanWorkspaces", summary: true, load: () => import("./ckan-workspace.mjs"), create: (module, config, options) => new module.MerchantCkanWorkspaces(config) },
  tenderlyWorkspaces: { configKey: "tenderlyWorkspaces", summary: true, load: () => import("./tenderly-workspace.mjs"), create: (module, config, options) => new module.MerchantTenderlyWorkspaces(config) },
  redisWorkspaces: { configKey: "redisWorkspaces", summary: true, load: () => import("./redis-workspace.mjs"), create: (module, config, options) => new module.MerchantRedisWorkspaces(config) },
  usaSpendingWorkspaces: { configKey: "usaSpendingWorkspaces", summary: true, load: () => import("./usaspending-workspace.mjs"), create: (module, config, options) => new module.MerchantUSASpendingWorkspaces(config) },
  sourceWorkspaces: { configKey: "sourceWorkspaces", summary: true, load: () => import("./source-workspace.mjs"), create: (module, config, options) => new module.MerchantSourceWorkspaces(config) },
  harWorkspaces: { configKey: "harWorkspaces", summary: true, load: () => import("./har-workspace.mjs"), create: (module, config, options) => new module.MerchantHarWorkspaces(config) },
  publishers: { configKey: "publishers", summary: true, load: () => import("./publisher.mjs"), create: (module, config, options) => new module.MerchantPublisher(config) },
  facilitators: { configKey: "facilitators", summary: false, load: () => import("../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs"), create: (module, config, options) => module.createReleaseFacilitatorControl(config.releaseStore, config.facilitators) },
  pricing: { configKey: "pricing", summary: true, load: () => import("./pricing.mjs"), create: (module, config, options) => new module.MerchantPricing(config) },
  woocommerce: { configKey: "woocommerce", summary: true, load: () => import("./woocommerce.mjs"), create: (module, config, options) => new module.MerchantWooCommerce(config, options.woocommerce) },
  buyerExpenses: { configKey: "buyerExpenses", summary: true, load: () => import("./buyer-expenses.mjs"), create: (module, config, options) => new module.MerchantBuyerExpenses(config) },
  cache: { configKey: null, summary: false, load: () => import("./controls.mjs"), create: (module, config, options) => module }
});

export function merchantProviderConfigured(key, config) {
  const provider = MERCHANT_PROVIDERS[key];
  if (!provider) throw new RangeError('Unknown merchant provider: ' + key);
  return provider.configKey === null || config[provider.configKey] !== null && config[provider.configKey] !== undefined;
}
