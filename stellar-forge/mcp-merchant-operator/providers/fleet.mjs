// MIT. Original fleet merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { fleetControlTools } from "../catalog/fleet.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "fleet", family: "fleet",
  title: "fleet merchant", order: 110, catalogOrder: 50,
  configKey: "fleet", summary: true, dependencies: [],
  requestClose: provider => provider.cancelStaging(),
  maxRequestBytes: 131072,
  configuration: { input: "fleet", privateExports: false,
    read: async (value, { base, config, hostPath }) => await (await import("../config.mjs")).readFleetConfiguration(value, base, config.releaseStore) },
  tools: fleetControlTools,
  instructions: [
    {
      "prefix": "merchant_fleet_",
      "text": "For a configured fleet, inspect merchant_fleet_plan and start with its digest; stage/review/prepare/activate uses the original exact candidate and revision. Keep draining sessions until fleet_status reports canRetire, then retire their exact child instance. Rollback uses a fresh retained-revision review; stop/restart uses this process-owned managerId. After a lost response inspect current status before another change.",
      "order": 260
    }
  ],
  load: () => import("../fleet.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantFleet(config.fleet),
  initialize: async options => (await import('../config.mjs')).initializeFleetMerchant(options)
});
