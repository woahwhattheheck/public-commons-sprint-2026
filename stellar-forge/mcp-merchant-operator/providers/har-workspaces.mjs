// MIT. Original har-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { harWorkspaceTools } from "../catalog/har-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "har-workspaces", family: "harWorkspaces",
  title: "har workspaces merchant", order: 400, catalogOrder: 400,
  configKey: "harWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "harWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../har-workspace.mjs")).readHarWorkspaceConfiguration(hostPath(value)) },
  tools: harWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_har_",
      "text": "For captured API sources, use merchant_har_workspaces, status and files to select the existing SF61 console and exact input hash. Ingest or adopt the original source, page every native group and review, then retain the complete decision document. Keep the immutable source selection and revision through native source, merchant preview and save. Later captures select the exact previous saved review; merchant_har_plan reuses the browser unchanged-route carry. Copy or receive the whole original source and use retained export manifests and SHA-pinned chunks after an interrupted reply. Closing HAR access drains only its calls and temporary reads; the existing source consoles retain their lifetimes.",
      "order": 390
    }
  ],
  load: () => import("../har-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantHarWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeHarWorkspaceMerchant(options)
});
