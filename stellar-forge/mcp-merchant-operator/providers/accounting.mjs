// MIT. Original accounting merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { accountingTools } from "../catalog/accounting.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "accounting", family: "accounting",
  title: "accounting merchant", order: 120, catalogOrder: 60,
  configKey: "accounting", summary: true, dependencies: [],
  maxRequestBytes: 32 * 1024 * 1024,
  configuration: { input: "accounting", privateExports: false,
    read: async (value, { base, config, hostPath }) => value == null ? null : (await import("../accounting.mjs")).normalizeAccountingConfig(value, base) },
  tools: accountingTools,
  instructions: [
    {
      prefix: 'merchant_accounting_portfolio_',
      text: 'For a client portfolio, open the original coordinator and its configured client aliases. Commission exact client procedure editions and real source revisions, preview named staff capacity, then retain the complete prepared coordinator request before execute. A command save retains a separate original child UUID; read the complete saved command before execute_command and reconcile that same client operation after an uncertain reply. Responsibility changes use the original assignment digest and a complete handover note. Capture full selected client periods, receive their separate packets into their original destination workspaces, and adopt explicit local aliases before creating the next period. Close the coordinator and all explicitly opened client sessions before starting the same complete selection in Applications.',
      order: 43
    },
    {
      prefix: 'merchant_accounting_buyer_',
      text: 'For a declared sourceMode buyer alias, preview the exact original buyer source and keep its SHA256 before explicit initialization. Initialization and first-handoff recovery reuse the original retained source and handoff UUID. Use buyer_startup and buyer_prepare after reopening, retain the complete first-handoff request before submission, and use the existing accountant and Xero operations for returned bookkeeping references. Read original source bytes with file kind buyer-source. Close MCP before opening the same directory in the original browser or managed Applications; the native maintenance workflow retains its original complete operating state.',
      order: 35
    },
    {
      prefix: 'merchant_accounting_runbooks_',
      text: 'For client runbooks, open the original accounting workspace, choose its actual client files or a retained accountant handoff and exact return revision, and save the complete prepared request before execute. Recover that same request after a lost response. Freeze procedures for the selected period; retain preparation, returned corrections, reviewer decisions and complete lead-to-backup assignment handovers. Read full original packet, print and task files through the accounting reader, receive the complete packet into its chosen second workspace, then start the next local period from those received procedures and its actual local close source.',
      order: 45
    },
    {
      "prefix": "merchant_accounting_cryptoworth_",
      "text": "For Cryptoworth receiving, open the declared original accounting workspace and inspect the actual template alias, original handoff and explicit accountant revision. Preserve the complete normalized preview, source alias hashes, native request ID, workspace ID/revision and preview hash for profile, plan, capture and accountant-return saves. Reconcile the saved native ID before rereading changed input aliases after an uncertain response. PREPARED retains the same staged accountant request; COMMITTED and SUPERSEDED retain terminal history. Record a whole native import-unit rollback only with its actual completed vendor reference. Packet receiving binds both input and sealed packet SHA256s; complete retained files use the original accounting file reader. Close the original MCP workspace before launching its same directory in Applications.",
      "order": 40
    },
    {
      "prefix": "merchant_accounting_",
      "text": "For accounting, list declared sources and explicitly open their original workspace. Review a recovery request before importing its retained preview, follow jobs and refresh the current revision, then capture and inspect the original report. File retrieval returns SHA-pinned chunks of the saved response or original report/archive; it never purchases again. Close the accounting workspace to release its original lease.",
      "order": 380
    }
  ],
  load: () => import("../accounting.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantAccounting(config, options.accounting),
  initialize: async options => (await import('../config.mjs')).initializeAccountingMerchant(options)
});
