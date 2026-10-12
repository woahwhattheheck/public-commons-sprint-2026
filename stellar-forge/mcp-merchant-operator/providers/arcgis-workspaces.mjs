// MIT. Original arcgis-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { arcgisWorkspaceTools } from "../catalog/arcgis-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "arcgis-workspaces", family: "arcgisWorkspaces",
  title: "arcgis workspaces merchant", order: 410, catalogOrder: 420,
  configKey: "arcgisWorkspaces", summary: true, dependencies: ["publishers"],
  maxRequestBytes: 131072,
  configuration: { input: "arcgisWorkspaceConnection", privateExports: true,
    dependencies: ["publishers"],
    read: async (value, { base, config, hostPath }) => await (await import("../config.mjs")).readArcgisWorkspaceConfiguration(hostPath(value),
      { publishers: config.publishers, releaseStore: config.releaseStore }) },
  tools: arcgisWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_arcgis_",
      "text": "For ArcGIS source merchants, inspect merchant_arcgis_status and open the host-declared workspace. It borrows the existing MerchantPublisher and its one refresh scheduler; the browser uses the same original workbench. Inspect declared file bytes and SHA256 before uploading an alias. Prepare a source from selected host connection/profile and exact original inputs; retain workbenchId and request UUID for every change, then inspect the same saved request after a lost response. Complete capture before mapping an immutable source edition, and select it against the current source revision. Use merchant_publisher_* for the original plan, extraction, candidate review, publication, buyer preparation and refresh schedule. Export only a published run, stage with the host runtime, then use original merchant release digest/generation controls to inspect, select and start. Read all seven saved deployment files through exact hashes and offsets. Closing a borrowed browser leaves the publisher and scheduler open; closing its owner drains the workbench and retained reads before releasing the publisher. No source or deployment step purchases data.",
      "order": 130
    }
  ],
  load: () => import("../arcgis-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantArcgisWorkspaces(config, dependencies.publishers, options.arcgis),
  initialize: async options => (await import('../config.mjs')).initializeArcgisWorkspaceMerchant(options)
});
