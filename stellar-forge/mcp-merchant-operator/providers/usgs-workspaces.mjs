// MIT. Original usgs-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { usgsWorkspaceTools } from "../catalog/usgs-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "usgs-workspaces", family: "usgsWorkspaces",
  title: "usgs workspaces merchant", order: 360, catalogOrder: 330,
  configKey: "usgsWorkspaces", summary: true, dependencies: [],
  concurrentTools: Object.freeze(['merchant_usgs_capture_cancel', 'merchant_usgs_close']), shutdown: 'provider',
  maxRequestBytes: 2097152,
  configuration: { input: "usgsWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../usgs-workspace.mjs")).readUSGSWorkspaceConfiguration(hostPath(value)) },
  tools: usgsWorkspaceTools,
  instructions: [
    {
      "prefix": null,
      "text": "For USGS water, list declared workspace aliases and open the original Water console. Browser and agent share saved project revisions, capture IDs, reviews, editions and native DSS jobs. Page source inventories with the returned snapshot. Review the complete original mapping and exact plan hash before starting a native DSS export; reopen its retained ID after interruption. Prepare the complete native handover, then retain a customer delivery ID and use the maintained manifest-pinned downloader and original Water receiving command. An unchanged completed export reopens without another native write. Close cancels and drains original jobs and reads before the same project reopens.",
      "order": 100
    }
  ],
  load: () => import("../usgs-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantUSGSWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeUSGSWorkspaceMerchant(options)
});
