// MIT. Original grant-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { grantWorkspaceTools } from "../catalog/grant-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "grant-workspaces", family: "grantWorkspaces",
  title: "grant workspaces merchant", order: 10, catalogOrder: 350,
  configKey: "grantWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 33554432,
  configuration: { input: "grantWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../grant-workspace.mjs")).readGrantWorkspaceConfiguration(hostPath(value)) },
  tools: () => grantWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_grant_",
      "text": "For SF47 planning and delivery, select the declared grant workspace and read its original schema, plans and case versions. Use the exact original request ID, revision, actor, reviewed plan content and forecast input hashes for changes. Inspect a retained request after a lost reply. Reuse the original planner, cash model, evidence files, outcome register and grant Application writer. Page snapshots with the returned pointers and offsets; retain the complete immutable files and SHA-pinned input transfers. The explicit open tool may start only a host-authorized original workspace; a borrowed running Application stays with its owner when this merchant closes.",
      "order": 10
    }
  ],
  load: () => import("../grant-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantGrantWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeGrantWorkspaceMerchant(options)
});
