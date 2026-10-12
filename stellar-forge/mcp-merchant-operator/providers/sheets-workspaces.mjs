// MIT. Original sheets-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { sheetsWorkspaceTools } from "../catalog/sheets-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "sheets-workspaces", family: "sheetsWorkspaces",
  title: "sheets workspaces merchant", order: 270, catalogOrder: 220,
  configKey: "sheetsWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "sheetsWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../sheets-workspace.mjs")).readSheetsWorkspaceConfiguration(hostPath(value)) },
  tools: sheetsWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_sheets_",
      "text": "For Sheets authoring, list host-declared workspaces and explicitly open the original source model and its borrowed browser. Browser and agent edits share the same original draft revision, capture and source-version IDs. Inspect declared input hashes or choose an existing Google connection and exact tab/range. Save the explicit projection, preview the same draft revision, then review and save its source version against the current selection. Retain the original request UUID and inspect/resume that same operation after an uncertain reply; never repeat an uncertain Google read under a fresh ID. Open the original publisher explicitly. Only currentPublisher reports its live URL; a historical receipt may contain an expired URL. Private source packets use their original version, verified SHA256 and retained chunk-read identity. Closing drains this owned browser/model/publisher and releases its native lease; reopen the same directory through its alias and reconcile original receipts.",
      "order": 330
    }
  ],
  load: () => import("../sheets-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantSheetsWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeSheetsWorkspaceMerchant(options)
});
