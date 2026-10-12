// MIT. Original dataset merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { datasetLifecycleTools } from "../catalog/dataset-lifecycle.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "dataset", family: "dataset",
  title: "dataset merchant", order: 540, catalogOrder: 410,
  configKey: null, summary: false, dependencies: [],
  maxRequestBytes: 131072,
  tools: datasetLifecycleTools,
  instructions: [],
  load: () => import("../dataset-lifecycle.mjs"),
  create: (module, config, options, dependencies) => module
});
