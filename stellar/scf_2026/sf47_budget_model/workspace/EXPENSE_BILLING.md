# Customer expense recovery

Open **Grant Operations → Cash and accounts → Customer expense recovery** in the original case. This desk joins issued Buyer Expenses to the existing native Receivables account. A CUSTOMER cost allocation describes who funds a cost; the separate retained customer terms determine whether and how it is billed.

## Receive and review the original costs

Use Buyer Expenses to receive the complete original issued expense JSON or Accountant ZIP. Preserve its buyer workspace, source-line IDs, native integer units, accountant edition and full attachments. Review the current allocation and any USD valuation against the original work package. The new desk selects only an explicitly reviewed CUSTOMER portion. Original buyer credits remain visible in the charge review; they do not automatically authorize a customer credit or cash refund.

The catalog shows allocated, reserved and available native units. These are original expense units, separate from invoice currency. Select a positive portion for a new charge. Choose either an exact-cent share of the retained USD valuation, or an explicitly agreed customer amount supported by the original customer terms. The product never supplies an exchange rate or a markup. Currency is the native three-letter code with its explicit zero-to-six decimal scale; amounts stay decimal strings.

## Prepare and apply the customer's charge

1. Connect the original running Receivables API. Use its existing customer. The saved workspace and source identity pair stay fixed when the local service URL changes.
2. Select the original expense portions. Read their retained source, allocation and valuation. Enter each native quantity, invoice description and customer amount.
3. Select the actual source attachments for the customer's cost-recovery agreement or authorization. Record the interpreted terms, date, charge reason, buyer-credit review, invoice dates, purchase order and invoice note.
4. Preview the complete original source and exact native operations. Preparation retains that exact proposal, all source bytes, the original expense event/plan context and the original request.
5. Apply the retained native operations. A new charge creates the original native draft using its deterministic request ID.
6. Review the actual native invoice and explicitly issue it. A required credit-control decision must be selected from the native account; the desk preserves that existing decision and authority.
7. Refresh the original invoice and payment state. Receipts, allocations, refunds and customer correspondence remain with their native operating owners.

An uncertain response stays with the original request. **Resume same original request** sends the same retained financial intent. **Reconcile saved native outcome** reads the persisted charge journal. It releases the browser's pending editor only after an acknowledged outcome or a source-proven definitive refusal. Unknown transport outcomes never become new invoice requests.

## Corrections and amended expense allocations

Open the latest original charge and choose the supported continuation:

- **Correct unissued draft** updates the same original native draft with the reviewed source/customer terms.
- **Credit remaining amounts** retains the original line population and explicitly reduces the remaining customer amounts and reserved native portions. A removed current allocation can be reviewed as zero remaining units and zero remaining charge.
- **Void original invoice** retains the complete original source population at zero remaining units/amounts. The native account rejects an invoice with credits or effective payment allocations; inspect the original account or use a reviewed credit.
- **Credit / void and replace** preserves the original invoice disposition, then creates its linked replacement draft. Its issue is separate.

Read each current Buyer Expense edition and use **Review current expense edition** explicitly when it changed. A source correction never silently edits an issued invoice. Retain new customer authority and the interpretation of original buyer credits.

Pending CREDIT, VOID and REPLACE reviews preserve predecessor exposure until the correction completes. The reservation is the per-portion maximum across the latest applied and pending editions. For one original expense split across changing cost packages, the total is the largest edition total, rather than a sum of the per-portion maxima. Preparing a void therefore cannot release billed costs for another charge. Cancelling an unused preparation restores the predecessor without creating a second reservation. A copied-case cancellation cannot erase an ancestor that another retained successor depends on.

Definitively rejected native commands retain their original history. A draft or correction can refresh an unrelated native revision only after the current source and original invoice fingerprint are reconciled. A rejected invoice issue can receive a new explicit native preview/credit-control decision; its old command remains intact. A pending or acknowledged issue always resumes its existing request.

## Save, export and reopen

**Save complete working desk** preserves the original browser inputs, selected charge and exact pending request. Its storage is scoped to the case and current staff identity. The working desk is useful while editing; the full operating case and native account remain the financial source.

**Download full case and customer account** contains:

- The complete original Operations ZIP, including every retained charge chain and original expense history.
- Full immutable per-proposal source contexts, including a correction prepared in a different receiving copy.
- Expense-billing JSON, CSV and a readable HTML report.
- The actual native customer account archive for the selected charge's customer.
- Every linked original invoice and credit JSON, CSV, HTML and manifest, including future-dated issued invoices omitted by a dated customer statement.
- Exact file identities and export observations.

The local case, selected charge and billing rows come from one nesting-safe original aggregate snapshot. Native customer export and linked documents are bracketed by the same native revision; local history is checked again before delivery. These observations retain both authorities without inventing a cross-service transaction.

Cold receiving uses the original Operations import. The existing Buyer Expense validator replays each proposal's original expense source context, and billing validation checks terms, source quantities, exact native command order, acknowledgements and predecessor relationships. A receiving copy references the same charge identities and reservations. Original preparation and cancellation bodies replay from their retained history before deriving any new charge. A merged acknowledged draft restores its actual invoice ID even if the original process stopped before marking the whole review applied. Current native account identity is still required before any financial continuation.

The customer account archive is a customer export. To restore the complete native account to a new filesystem location, use its existing authenticated full-account backup and native relocation mechanism, then update only the saved connection's local URL after its identity is verified.

## HTTP, CLI and managed client

All routes use the original server's authenticated staff/case permissions. Lead and finance roles can operate this desk; contributor access remains with its original work/invoice desk. Existing commercial connection/customer routes are reused.

Root: `/api/operations/{caseId}/expense-billing`.

| Operation | Route |
| --- | --- |
| Catalog | GET root |
| Preview / prepare | POST root/preview or root/prepare |
| Reopen charge | GET root/{chargeId} |
| Apply / cancel | POST root/{chargeId}/apply or /cancel |
| Issue preview / issue | POST root/{chargeId}/preview-issue or /issue |
| Native refresh | POST root/{chargeId}/refresh |
| Full export | GET root/{chargeId}/export.zip |

The original CLI adds `expense-billing-catalog`, `-show`, `-refresh`, `-preview`, `-prepare`, `-apply`, `-cancel`, `-preview-issue`, `-issue` and `-export`. Use the original workspace/case flags, a complete JSON `--file` for writes, `--charge` for a retained charge and `--output` for the complete export. The same source-backed body and retained native request run through HTTP and CLI. No new accounting store is opened by the adapter.

The managed client exposes expenseBillingCatalog, expenseBilling, expenseBillingPreview, expenseBillingPrepare, expenseBillingApply, expenseBillingCancel, expenseBillingPreviewIssue, expenseBillingIssue and expenseBillingRefresh. Use the existing document download with kind `expense-billing`, caseId and chargeId. Corresponding Merchant grant tools preserve the same types, request identities and original native authority.

## Producing and receiving the whole product

Operate the complete outgoing source against a newly authenticated private receiving copy of the original saved native account. Preserve the input archive, original account identity, original paid milestone invoice, receipt/allocation and existing issuer/customer-send/settlement custody. Receive a real issued original Buyer Expense source and actual demo customer authorization into this private copy; do not substitute a manufactured Collections queue, current production tenant or new financial model.

Run the connected journey: original expense receive/review → explicit CUSTOMER portion → actual native draft → exact issue → same-request response-loss recovery → changed expense allocation → reviewed credit/void/replacement → full export → independent cold Operations receiving → original native account reopen. Include a pending void followed by another new-charge attempt and cancellation; original reserved exposure must persist. Include a costA-to-costB correction without doubling the original expense total. Include an acknowledged draft restored before apply.complete, original preparation/cancellation replay in the new receiving case, and a correction prepared in a second case copy. Preserve whole original source and resulting journals.

The producing peer must LOOK at the rendered outgoing desk and actual exported report/invoice attachments. Operate meaningful preparation, review, pending recovery, rejected correction, native issue, current history, export and reopened states at desktop and 390-pixel widths in both light and dark embedding contexts. Neutral foreground/background pairs are explicit for root, cards, fields, buttons and disabled labels. Inspect usable ZIP contents, each outgoing HTML/CSV and any original PDF pages. Repair actual source and rendering defects directly, keep the complete case and full source together, and retain the native output and screenshots in the original internal case.

## Review refusals and corrected continuation

The desk requires a cancellation reason and any required native credit decision before retaining a request. A source, version or credit-review race can still refuse a request at the server. Explicit EXPENSE_BILLING_APPLY_REVIEW, EXPENSE_BILLING_ISSUE_REVIEW and EXPENSE_BILLING_CANCEL_REVIEW responses identify only read-only review or rolled-back local preparation; native dispatch is outside those boundaries. The desk reads the current original charge journal, retains the full refused request and error, and allows correction only after no native command remains pending. Prior acknowledged financial operations stay in that same journal. Unknown outcomes continue with the exact original request.

In the actual receiving course, operate one empty-reason correction, a required-credit refusal and a changed-source refusal, then finish each corrected flow through the real desk. Keep the original saved request and financial command identities through export and cold receiving. Local saved-desk persistence failures retain the pending request in memory so its full body remains downloadable and replayable.
