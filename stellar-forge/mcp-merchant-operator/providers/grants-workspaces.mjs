// MIT. Original grants-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { grantsWorkspaceTools } from "../catalog/grantsgov-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "grants-workspaces", family: "grantsWorkspaces",
  title: "grants workspaces merchant", order: 310, catalogOrder: 280,
  configKey: "grantsWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 524288,
  configuration: { input: "grantsWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../grantsgov-workspace.mjs")).readGrantsWorkspaceConfiguration(hostPath(value)) },
  tools: grantsWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_grants_",
      "text": "For Grants.gov opportunity research, list merchant_grants_workspaces and open the original host alias. The returned browser shares its native writer. Save original query revisions, capture the complete provider page/detail chain or import a declared original packet, and inspect capture status after lost replies. Create immutable complete or selected editions, page every original notice with the returned snapshot, retain full qualification/workshare revisions and compare source editions. Prepare the original SF30 dataset and follow its complete native cursor. Existing publisher tools operate the original draft, reviewed snapshot/revision, SF82 release and SF88 buyer intent/session; continue their own saved operations after interruption. Save the original export SHA, inspect its receiving manifest and use grants-download or grantsgov-receive to retain every byte across MCP restart, then restore the original complete source workspace or selected edition. Close the exact owned instance returned by status.",
      "order": 100
    }
  ],
  load: () => import("../grantsgov-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantGrantsWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeGrantsWorkspaceMerchant(options)
});
