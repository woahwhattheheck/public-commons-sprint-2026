# Customer credit and order release

The Customer credit section of Receivables lets a merchant save customer policies, review the current account and retain an approval or decline for an original invoice draft. Issue uses the existing Receivables transaction: it retains the invoice document, assigns its original invoice number, consumes the selected approval and commits the account once.

## Operator workflow

1. Open the existing accounting workspace and choose **Receivables → Customer credit**. The desk shows current invoice drafts, customer policies and retained decisions. Search and customer filters apply to the complete registers; tables page through every matching record.
2. Choose **New customer policy**, select the customer and currency, and enter the policy owner and change reason. New policies start disabled. Select a credit limit, an overdue threshold, dispute review, review of every order, or a combination. Check **Enable these checks when issuing invoices** to activate the chosen rules.
3. Choose **Assess customer credit** on a saved draft. Review its original invoice lines, current issued balances, future issued obligations, overdue amounts, unresolved disputes, available receipts, invoice credits and other drafts. The account date is the current UTC date used by the ledger.
4. For an enabled policy, choose **Approve this invoice for issue** or **Decline this invoice for now**, enter the decision reason and save. The record retains the complete assessment, operator, policy edition and exact source basis.
5. Open the saved decision. **Issue this approved invoice** is available while the approval matches the current draft, policy, account and date. The original **Review and issue** invoice action also offers the current approval. A merchant rule that requires review opens the credit assessment.
6. Download **Printable decision**, **Complete decision JSON** or **File manifest**. The decision view shows its history, any current assessment that differs from the saved assessment, and the original issued invoice after release.

Policy editions and decision edits are retained through browser refresh. Closing an edit keeps it under **Retained edits**. A policy edit belongs to its original workspace, customer and currency; a decision edit belongs to its draft. Opening an original invoice parks an unsaved invoice editor so its contents can be resumed.

A new decision supersedes the current approval or decline for that draft. A current decision can be withdrawn with a reason. Issued invoices retain their consumed decision and cannot consume it again.

## Account calculations

Amounts use the original currency code and decimal scale and exact integer arithmetic.

| Account amount | Source and treatment |
| --- | --- |
| Current due | Original issued invoices effective on the assessment date, after their dated allocations and credits. |
| Future issued balance | Future-dated issued invoices, less payments and credits already effective on the assessment date. |
| Issued exposure | Current due plus future issued balance. |
| Selected draft | The complete original invoice preview total. |
| Exposure after issue | Issued exposure plus this selected draft. |
| Overdue balance | Original unpaid invoices whose due dates precede the account date. |
| Open disputed balance | Unresolved recorded disputes, limited to the relevant invoice's current amount due. Closing a follow-up case alone does not resolve its dispute. |
| Available receipts | Original customer receipts after allocations, refunds and reservations. These remain available for the operator to allocate. |
| Invoice credit balances | Credits that remain attached to their original invoices. |
| Other drafts | Informational draft register; these amounts are not issued obligations. |

A limit rule triggers when exposure after the selected draft is greater than the saved limit. An overdue rule triggers when an unpaid invoice is overdue by more than the selected number of days. Dispute review and review of every order follow the merchant's saved selections.

An absent or disabled policy leaves ordinary invoice issue available. An enabled policy applies only its selected checks. An enabled policy with no selected rule is rejected so the saved configuration is unambiguous.

An approval is bound to the draft, original customer and issuer details, policy edition, account date, issued invoices, receipts, allocations, credits, collections casework and refunds. Changes to those sources require a current assessment. Saving the approval itself does not alter its assessment hash. Other draft edits and unrelated customer accounts do not change the source basis.

## Recovery and concurrency

Every mutation retains the original workspace, revision, operator and request ID. Policy updates and withdrawals also retain the reviewed record version. Decision saves retain the assessment hash; invoice issue retains the original invoice preview hash and version.

If a response is interrupted, retry the same request and payload. The original request journal returns its retained result before attempting another mutation. If the server definitively rejects a stale source or revision, return to the retained form, review the current account and save a new operation. Policy edits offer **Review current saved policy** to compare both versions and explicitly adopt the latest version while retaining the edited terms.

Invoice document retention completes before the approval is marked consumed. The original account transaction commits the invoice and consumed decision together. Its existing recovery behavior restores the prior account state if the write fails.

## HTTP and JavaScript

The existing authenticated/local Receivables route is the entry point. Native application providers use the same request handler and workspace methods.

| Method | Route relative to the Receivables API | Client / workspace method |
| --- | --- | --- |
| GET | /credit-control?customerId=…&search=… | creditControl(query) |
| GET | /credit-control/policies/:id | creditPolicy(id) |
| POST | /credit-control/policies | saveCreditPolicy(value) |
| POST | /credit-control/invoices/:invoiceId/assessment | previewCreditAssessment(invoiceId, value) |
| POST | /credit-control/invoices/:invoiceId/decisions | saveCreditDecision(invoiceId, value) |
| GET | /credit-control/decisions/:id | creditDecision(id) |
| POST | /credit-control/decisions/:id/withdraw | withdrawCreditDecision(id, value) |
| GET | /credit-control/decisions/:id/files/:name | creditDecisionFile(id, name) |
| GET | /credit-control/operations/:requestId | creditControlOperation(requestId) |
| POST | /invoices/:invoiceId/issue | issue(invoiceId, value) |

The client file method returns a Response for the existing download flow. The native workspace file method returns name, type and bytes. Decision file names are decision.json, decision.html and manifest.json. The manifest identifies the version and hashes the complete JSON and printable HTML.

A policy request has the following shape. Use the real workspace and customer values and the merchant's selected terms.

~~~json
{
  "workspaceId": "ORIGINAL_WORKSPACE",
  "revision": 12,
  "requestId": "ORIGINAL_OPERATION_ID",
  "actor": "Accounts receivable operator",
  "customerId": "ORIGINAL_CUSTOMER",
  "currency": {"code": "USD", "scale": 2},
  "owner": "Accounts receivable",
  "terms": {
    "enabled": true,
    "creditLimit": "2500.00",
    "overdueDays": 30,
    "reviewDisputes": true,
    "reviewEveryOrder": false
  },
  "reason": "Customer terms selected by the merchant."
}
~~~

The amounts and threshold above demonstrate the format. The application does not supply default credit terms.

To assess, POST the original workspaceId to the selected invoice assessment route. The result includes revision, assessmentSha256, the full assessment and invoicePreview with expectedVersion and previewSha256.

To save the reviewed decision, retain workspaceId, revision and assessmentSha256, then add actor, requestId, outcome (APPROVE or DECLINE) and reason. Read the saved decision to obtain its current canRelease and invoicePreview.

To issue, call the original issue method with that current revision, a new requestId, actor, expectedVersion, previewSha256 and creditDecisionId. The result includes the issued invoice, creditRelease and consumed creditDecision.

Conflict responses place current assessment and preview information under error.details. The client exposes these fields through ReceivablesApiError.details. The command line includes them in its JSON error output.

## Command line

Use the installed starforge command and the existing private accounting directory.

~~~sh
starforge receivables credit-control --directory /private/accounting
starforge receivables credit-policy-save --directory /private/accounting --input /private/policy.json
starforge receivables credit-policy --directory /private/accounting --id POLICY_ID
starforge receivables credit-assess --directory /private/accounting --invoice INVOICE_ID --input /private/workspace.json --out /private/new-assessment.json
starforge receivables credit-decision-save --directory /private/accounting --invoice INVOICE_ID --input /private/reviewed-decision.json
starforge receivables credit-decision --directory /private/accounting --id DECISION_ID
starforge receivables apply --directory /private/accounting --action issue --id INVOICE_ID --input /private/reviewed-issue.json
starforge receivables credit-decision-file --directory /private/accounting --id DECISION_ID --name decision.html --out /private/new-decision.html
starforge receivables credit-control-operation --directory /private/accounting --request ORIGINAL_OPERATION_ID
~~~

To withdraw a current decision, use credit-withdraw with --id and a JSON --input containing workspaceId, revision, requestId, actor, expectedVersion and reason. File output creates a new destination exclusively and leaves an existing file intact.

The package contribution includes the domain and workspace modules, client declarations, this guide and the browser module. Reopening the original accounting directory restores policies, editions, decisions, release bindings and the existing request journal.
