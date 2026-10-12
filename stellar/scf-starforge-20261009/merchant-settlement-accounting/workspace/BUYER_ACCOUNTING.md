# Buyer periods, accountant returns and Xero

The original SF36 buyer workspace can issue a source for the maintained accountant workspace. Expense and credit allocations keep their buyer identity, native network, asset, exact atomic amount, cost center, project, account code and recognition date. The existing accountant CSV return engine supplies the four editable bookkeeping fields. The existing Xero compiler, retained context, draft plans, native operations and response reconciliation supply the Xero path.

## Complete operator flow

1. In the buyer expense workspace, finish allocation and review, then issue the period. Open the issued edition and choose **Export source to accountant**. This exports `stellar-forge.buyer-accountant-source.v1`, containing the exact frozen close and original workspace identity. A later workspace change does not change this file.
2. Open the existing accountant workspace at `/accountant.html`. Choose the buyer-issued source type, load that file, inspect its hash, period, source context and native totals, then create the handoff with a name and operator. Its `original-buyer-source.json` is retained unchanged.
3. Use the normal accountant CSV process or continue to `/xero.html`. CSV editing is limited to `externalStatus`, `externalBookRef`, `externalAccountCode` and `externalNote`; the original parser keeps row identity, protected columns, partial returns and conflicts.
4. For Xero, load the exact saved handoff and original retained organisation/account context. Review every included expense or credit component, enter the fiat amount and date, select actual debit and credit account codes, and document the valuation. Explicitly exclude a component if it is outside the draft. Unknown values remain unknown.
5. Preview and save the original Xero plan. Its source retains the buyer workspace and issued close. The original operation controls manage draft creation, recovery, refresh and retained native responses. Review the original returned journal data before applying it to the accountant handoff.
6. Download `buyer-return.json` from the saved accountant return. In the original buyer issued edition, load it under **Bookkeeping returns**, inspect the source match and any existing handoff overlap, name the operator and acceptance, then save. The transaction retains the original file, complete return chain and accepted request identity.
7. Export the issued buyer source, original returned packet, or complete period plus bookkeeping references. Export the complete buyer project to move the same history and included return reader to another private machine.

The buyer receives references and review status. Its original expenses, returned units, allocations, recognition dates and closed-period snapshots remain the original issued facts. Corrections to a financial period continue through the existing reopen/review/close lifecycle.

## Source identity and scope

Buyer sources use their own schemas and `sourceLineId`; they do not manufacture merchant settlement event IDs. A handoff binds the original buyer source bytes, workspace, close, close context, coding edition and allocation line. Buyer credits retain the original purchase and returned-transfer identities.

Native atomic amounts and any merchant store-currency amounts remain different fields. Xero journal amounts are an explicit operator valuation in the retained organisation currency. There is no automatic token conversion, assumed exchange rate or inferred price.

The original Xero purpose rules continue to apply. A native demo-company context can exercise development and testnet sources. Organisation-books use requires the original operational, independently matched public-network source required by the existing compiler. A reviewed demo response is not represented as a production posting. The buyer's original data context is shown with the handoff and Xero plan.

A new period edition can contain the same economic purchase or return as its predecessor. Xero plans retain both the original allocation component and the economic event identity. An active plan for that economic event in the same buyer workspace and tenant prevents a second edition from silently reserving another posting. Use the original plan's recovery/history; a period correction is not authority to post the same event twice.

## HTTP composition

The existing accountant server delegates these routes to `AccountantWorkspace`:

| Operation | Route | Original request |
| --- | --- | --- |
| Preview buyer source | `POST /api/accountant/buyer-source/preview` | `buyerSource: {contentBase64, sha256, name?}` |
| Create handoff | `POST /api/accountant/handoffs` | Existing id, name, actor, revision and explicit `buyerSource` |
| Read handoff | `GET /api/accountant/handoffs/{id}` | Existing revision selection |
| Review CSV return | `POST /api/accountant/handoffs/{id}/preview` | Existing CSV, actor, name, id and parent |
| Save return | `POST /api/accountant/handoffs/{id}/returns` | Existing exact preview and expected revision |
| Download native return | `GET /api/accountant/handoffs/{id}/download/buyer-return.json?revisionId={returnId}` | Exact saved return |

The Xero routes and HTTP contract stay in [XERO.md](XERO.md). The company/tenant/consent controls remain in the original connection workspace. QuickBooks and other merchant-only adapters continue to validate their supported source type; this extension does not reinterpret a buyer source as merchant income.

## Existing accounting MCP host

Declare `buyerSources: {issued_period: "/absolute/private/issued-buyer-accountant-source.json"}` in the original accounting workspace connection. It uses the same private source-map contract as its other original inputs.

`merchant_accounting_accountant_buyer_prepare` takes the workspace alias, source alias and exact source SHA-256. `merchant_accounting_accountant_buyer_create` adds the existing revision, actor, name and stable handoff UUID. They call the same source preview and handoff factory used by the browser. The original accountant row/return and Xero tools then operate on that handoff. `merchant_accounting_file` can download its `original-buyer-source.json` and saved `buyer-return.json` with the original bounded retained-file contract.

The buyer-side return tools and this accounting-side source map belong to their existing separate workspace owners. No connection consent or platform credential is transferred by the handoff.

## Retained return

`buyer-return.json` contains the immutable buyer handoff and full original accountant revision chain. The receiving reader rebuilds the handoff from the buyer's own issued source, checks the original seals and row matching, and verifies each parent before accepting any external reference.

A later return must extend the previously accepted revision of that handoff. A different handoff covering the same issued lines requires an explicit supersession decision and reason. Earlier accepted packets remain downloadable.

The buyer complete-project package includes the exact fixed Node reader and dependencies as well as the original packets and native Store tables. Receiving validates the complete known table/source closure and preserves successful request responses. It opens without the original buyer ledger, signer or Xero credentials.

## Source ownership

The implementation composes `accountant/buyer-source.mjs`, `buyer-return.mjs`, the original accountant engine and Xero modules, and the existing SF36 `expense-workspace`. The merchant report source, shared connection lifecycle, Xero HTTP transport and current provider registrations retain their original owners and contracts.

See [the buyer operator guide](../../sf36-spend-governor/expense-workspace/BOOKKEEPING.md) for native API and machine operations.
