// MIT. Original baserow-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { baserowWorkspaceTools } from "../catalog/baserow-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "baserow-workspaces", family: "baserowWorkspaces",
  title: "baserow workspaces merchant", order: 340, catalogOrder: 310,
  configKey: "baserowWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "baserowWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../baserow-workspace.mjs")).readBaserowWorkspaceConfiguration(hostPath(value)) },
  tools: baserowWorkspaceTools,
  instructions: [
    {
      "prefix": null,
      "text": "For Baserow, use the declared original source console. Preserve native field IDs, complete rows/files and stable source request UUIDs. Review the current source version before publisher changes; pin plan digest and run UUID for extraction. Recover the same native operation after interruption. Reviewed merchant terms and runtime profiles come from the host. Complete exports retain original packets and files; use download-baserow and receive-baserow for durable customer receiving.",
      "order": 80
    }
  ],
  load: () => import("../baserow-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantBaserowWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeBaserowWorkspaceMerchant(options)
});
