// MIT. Original paid-job merchant metadata and native ownership hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { paidJobWorkspaceTools } from '../catalog/paid-jobs.mjs';

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: 'paid-job-workspaces', family: 'paidJobWorkspaces',
  title: 'Paid job merchant workspaces', order: 60, catalogOrder: 450,
  configKey: 'paidJobWorkspaces', summary: true, dependencies: [],
  concurrency: 'provider', requestClose: provider => provider.cancel(),
  maxRequestBytes: 2097152,
  configuration: { input: 'paidJobWorkspaceConnection', privateExports: true,
    read: async (value, { hostPath }) => (await import('../paid-jobs.mjs')).readPaidJobWorkspaceConfiguration(hostPath(value)) },
  tools: paidJobWorkspaceTools,
  instructions: [
    {
      "prefix": "merchant_jobs_",
      "text": "For paid computation, inspect the configured original merchant alias and its current function/input policy, source, worker and job revisions. Browser, Applications and MCP share the same merchant. Prepare or renew using a stable request UUID; exact retries recover the same private customer claim. Declared uploaded files retain their original reference and claim. Inspect original input receiving and read the complete job before retry/cancel. For a settled customer case, read its current case and job revisions, review the original accounting preview before recording with that same request UUID, and recover the saved native operation after a lost response. Export at the selected job/case revisions; the complete immutable export retains every declared input, result, merchant case, buyer receipt and unchanged original accounting file. Use merchant-paid-jobs or merchant-mcp jobs inspect/download/reopen to receive all files into the same private directory with its selected manifest SHA256. Case receiving uses another configured source workspace and the exact export digest, then delegates to the target’s original resolution receiver. MCP closure drains its own calls and reads; the original merchant lifetime remains with Applications or its existing jobs serve owner.",
      "order": 20
    }
  ],
  load: () => import('../paid-jobs.mjs'),
  create: (module, config) => new module.MerchantPaidJobWorkspaces(config),
  initialize: async options => (await import('../paid-jobs-setup.mjs')).initializePaidJobWorkspaceMerchant(options)
});
