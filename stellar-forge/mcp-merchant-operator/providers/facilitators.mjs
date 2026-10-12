// MIT. Original facilitators merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "facilitators", family: "facilitators",
  title: "facilitators merchant", order: 430, catalogOrder: 490,
  configKey: "facilitators", summary: false, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "facilitatorConnection", privateExports: false,
    read: async (value, { base, config, hostPath }) => await (await import("../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs")).readFacilitatorProfiles(hostPath(value)) },
  tools: () => [],
  coreToolNames: ["merchant_facilitators", "merchant_facilitator_review", "merchant_facilitator_stage"],
  instructions: [
    {
      "prefix": "merchant_facilitator",
      "text": "For a retained facilitator change, use merchant_facilitators and merchant_facilitator_review, inspect every generated native payment alternative, then stage the exact reviewId. Its complete review remains in merchant_inspect/compare and must match at native startup. After a lost stage reply inspect the proposed release ID.",
      "order": 180
    }
  ],
  load: () => import("../../../stellar/scf-starforge-20261009/sf82-seller-pilot/release-facilitator.mjs"),
  create: (module, config, options, dependencies) => module.createReleaseFacilitatorControl(config.releaseStore, config.facilitators)
});
