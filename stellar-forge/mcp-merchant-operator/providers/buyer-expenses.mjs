// MIT. Original buyer-expenses merchant metadata and lazy source hooks.
import { defineMerchantProvider, MERCHANT_PROVIDER_SCHEMA } from '../provider-contract.mjs';
import { buyerExpenseTools } from "../catalog/buyer-expenses.mjs";

export default defineMerchantProvider({
  schema: MERCHANT_PROVIDER_SCHEMA, id: "buyer-expenses", family: "buyerExpenses",
  title: "buyer expenses merchant", order: 480, catalogOrder: 480,
  configKey: "buyerExpenses", summary: true, dependencies: [],
  maxRequestBytes: 131072,
  configuration: { input: "buyerExpenseConnection", privateExports: true,
    read: async (value, { base, config, hostPath }) => await (await import("../buyer-expenses.mjs")).readBuyerExpenseConfiguration(hostPath(value)) },
  tools: buyerExpenseTools,
  instructions: [
    {
      "prefix": "merchant_buyer_expense_",
      "text": "For buyer expenses, open only a declared workspace and ledger alias. Inspect the current original revision and retain an exact requestId/payload before each change. Recover merchant_buyer_expense_request after an interrupted reply before retrying that same request. Capture and accept original statement editions, supply exact allocations and explicit outstanding dispositions, then use current period review before close. Reopen preserves issued editions. Export a project at its reviewed revision and use the existing manifest-pinned download and trusted receive commands.",
      "order": 150
    }
  ],
  load: () => import("../buyer-expenses.mjs"),
  create: (module, config, options, dependencies) => new module.MerchantBuyerExpenses(config),
  initialize: async options => (await import('../config.mjs')).initializeBuyerExpenseMerchant(options)
});
