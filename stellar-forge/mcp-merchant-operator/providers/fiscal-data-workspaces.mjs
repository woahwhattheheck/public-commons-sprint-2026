// MIT. Original fiscal-data-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { fiscalDataWorkspaceTools } from "../catalog/fiscaldata-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "fiscal-data-workspaces", family: "fiscalDataWorkspaces",
  title: "fiscal data workspaces merchant", order: 180, catalogOrder: 150,
  configKey: "fiscalDataWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "fiscalDataWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../fiscaldata-workspace.mjs")).readFiscalDataWorkspaceConfiguration(hostPath(value)) },
  tools: fiscalDataWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_fiscaldata_",
      "text": "For Fiscal Data, list declared workspaces and explicitly open the original model. Review exact source revisions, fields, units, scales and stock-series notes before building native CSV editions. The browser and MCP share the same model and host operator identity. Keep original request IDs, reviewed offer digests and release generations. Checkpoint drains the original source model into a complete retained source/review package; receive only into an empty closed declared alias and resume unfinished captures explicitly. Source pages, native delivery archives and portable packages use SHA-pinned retained chunks. The original publisher, SF82 seller and SF88 buyer own every payment and approval.",
      "order": 370
    }
  ],
  load: () => import("../fiscaldata-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantFiscalDataWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeFiscalDataWorkspaceMerchant(options)
});
