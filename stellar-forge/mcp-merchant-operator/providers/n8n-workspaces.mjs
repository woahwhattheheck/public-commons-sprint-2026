// MIT. Original n8n-workspaces merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { n8nWorkspaceTools } from "../catalog/n8n-workspace.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "n8n-workspaces", family: "n8nWorkspaces",
  title: "n8n workspaces merchant", order: 50, catalogOrder: 440,
  configKey: "n8nWorkspaces", summary: true, dependencies: [],
  maxRequestBytes: 2097152,
  configuration: { input: "n8nWorkspaceConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../n8n-workspace.mjs")).readN8nWorkspaceConfiguration(hostPath(value)) },
  tools: n8nWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_n8n_",
      "text": "For n8n merchants, use the configured workspace alias and inspect merchant_n8n_status for the original automation definitions and current worker. Prepare with a retained request UUID and the complete input; the exact retry recovers the same private claim handoff. Review the full job and dispatch before changing their selected revisions. Renew claims with the original UUID, reason and revision; inspect the same job after uncertain cancel, retry or execution recovery. Reconcile an uncertain dispatch against its actual configured workflow and job input before explicitly authorizing a rerun. Export at both current job and dispatch revisions with a stable request UUID; retain exportId and manifestFile.sha256. Use inspect-n8n, download-n8n and reopen-n8n to receive all original files with the same alias, endpoint, manifest digest and private directory across interruption. The original merchant remains the sole job and dispatch owner shared with Applications and its browser.",
      "order": 70
    }
  ],
  load: () => import("../n8n-workspace.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantN8nWorkspaces(config),
  initialize: async options => (await import('../config.mjs')).initializeN8nWorkspaceMerchant(options)
});
